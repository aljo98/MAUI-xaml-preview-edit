"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MauiXamlPreviewProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const fast_xml_parser_1 = require("fast-xml-parser");
class MauiXamlPreviewProvider {
    constructor(extensionUri) {
        this._currentPlatform = 'android';
        this._elementMap = new Map();
        this._resourceDictionary = new Map();
        this._themeColors = new Map();
        this._styleCache = new Map();
        this._extensionUri = extensionUri;
    }
    setElementHighlightDecoration(decoration) {
        this._elementHighlightDecoration = decoration;
    }
    setPropertiesProvider(provider) {
        this._propertiesProvider = provider;
    }
    updateElementProperty(property, newValue) {
        // Update the property in the current document
        if (this._currentPanel) {
            this._currentPanel.webview.postMessage({
                type: 'updateProperty',
                property: property.key,
                value: newValue
            });
        }
        // Update in properties provider
        if (this._propertiesProvider) {
            this._propertiesProvider.refresh();
        }
    }
    async deserializeWebviewPanel(webviewPanel, state) {
        this._currentPanel = webviewPanel;
        this._configureWebview(webviewPanel.webview);
    }
    openPreview(document) {
        this._currentDocument = document;
        if (this._currentPanel) {
            this._currentPanel.reveal(vscode.ViewColumn.Beside);
            this.updatePreview(document);
            return;
        }
        this._currentPanel = vscode.window.createWebviewPanel(MauiXamlPreviewProvider.viewType, `MAUI Preview: ${document.fileName.split('/').pop()}`, vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [this._extensionUri]
        });
        this._configureWebview(this._currentPanel.webview);
        this.updatePreview(document);
        // Zagotovimo da se properties prikažejo
        setTimeout(() => {
            this._sendPropertiesDataToSidebar();
        }, 200);
        this._currentPanel.onDidDispose(() => {
            this._currentPanel = undefined;
        }, null);
    }
    updatePreview(document) {
        if (!this._currentPanel) {
            return;
        }
        console.log('[Preview] Updating preview for:', document.fileName);
        const xamlContent = document.getText();
        // Load related resources and styles
        this._loadResourceDictionaries(document);
        this._initializeThemeColors();
        this._buildElementMap(xamlContent);
        const htmlContent = this._generatePreviewHtml(xamlContent);
        this._currentPanel.webview.html = htmlContent;
        // Update properties panel with current document structure
        this._sendPropertiesDataToSidebar();
        console.log('[Preview] Preview updated successfully');
    }
    _configureWebview(webview) {
        webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'elementSelected':
                    this._handleElementSelection(message.elementId, message.elementType, message.properties);
                    break;
                case 'propertyChanged':
                    this._handlePropertyChange(message.elementId, message.property, message.value);
                    break;
                case 'platformChanged':
                    this._handlePlatformChange(message.platform);
                    break;
                case 'elementMoved':
                    this._handleElementMove(message.elementId, message.position);
                    break;
                case 'elementResized':
                    this._handleElementResize(message.elementId, message.size);
                    break;
                case 'elementRotated':
                    this._handleElementRotation(message.elementId, message.rotation);
                    break;
                case 'requestPropertiesData':
                    this._sendPropertiesDataToSidebar();
                    break;
            }
        });
    }
    _sendPropertiesDataToSidebar() {
        if (!this._currentDocument || !this._propertiesProvider)
            return;
        const xamlContent = this._currentDocument.getText();
        const parsedXaml = this._parseXaml(xamlContent);
        if (parsedXaml) {
            const elements = this._extractElementsFromParsedXaml(parsedXaml);
            this._propertiesProvider.setElements(elements);
        }
    }
    _extractElementsFromParsedXaml(node, parentId) {
        const elements = [];
        if (typeof node !== 'object' || node === null) {
            return elements;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('@_'))
                continue;
            const elementId = `element_${Math.random().toString(36).substr(2, 9)}`;
            const attributes = this._extractAttributes(value);
            const properties = this._buildPropertiesFromAttributes(key, attributes);
            const element = {
                id: elementId,
                type: key,
                name: attributes.Name || attributes['x:Name'] || key,
                properties: properties,
                children: []
            };
            // Recursively extract child elements
            if (typeof value === 'object' && value !== null) {
                const childElements = this._getChildElements(value);
                for (const child of childElements) {
                    element.children.push(...this._extractElementsFromParsedXaml(child, elementId));
                }
            }
            elements.push(element);
        }
        return elements;
    }
    _buildPropertiesFromAttributes(elementType, attributes) {
        const properties = [];
        // Common layout properties
        properties.push({ key: 'Width', value: attributes.Width || '', type: 'string', section: 'layout' }, { key: 'Height', value: attributes.Height || '', type: 'string', section: 'layout' }, { key: 'Margin', value: attributes.Margin || '', type: 'string', section: 'layout' }, { key: 'Padding', value: attributes.Padding || '', type: 'string', section: 'layout' }, { key: 'HorizontalOptions', value: attributes.HorizontalOptions || '', type: 'select', options: ['Start', 'Center', 'End', 'Fill', 'StartAndExpand', 'CenterAndExpand', 'EndAndExpand', 'FillAndExpand'], section: 'layout' }, { key: 'VerticalOptions', value: attributes.VerticalOptions || '', type: 'select', options: ['Start', 'Center', 'End', 'Fill', 'StartAndExpand', 'CenterAndExpand', 'EndAndExpand', 'FillAndExpand'], section: 'layout' });
        // Common appearance properties
        properties.push({ key: 'BackgroundColor', value: attributes.BackgroundColor || '', type: 'color', section: 'appearance' }, { key: 'Opacity', value: attributes.Opacity || '1', type: 'number', section: 'appearance' }, { key: 'IsVisible', value: attributes.IsVisible || 'True', type: 'boolean', section: 'appearance' });
        // Element-specific properties
        switch (elementType) {
            case 'Label':
                properties.push({ key: 'Text', value: attributes.Text || '', type: 'string', section: 'appearance' }, { key: 'TextColor', value: attributes.TextColor || '', type: 'color', section: 'appearance' }, { key: 'FontSize', value: attributes.FontSize || '', type: 'number', section: 'appearance' }, { key: 'FontAttributes', value: attributes.FontAttributes || '', type: 'select', options: ['None', 'Bold', 'Italic', 'Bold,Italic'], section: 'appearance' });
                break;
            case 'Button':
                properties.push({ key: 'Text', value: attributes.Text || '', type: 'string', section: 'appearance' }, { key: 'TextColor', value: attributes.TextColor || '', type: 'color', section: 'appearance' }, { key: 'FontSize', value: attributes.FontSize || '', type: 'number', section: 'appearance' }, { key: 'CornerRadius', value: attributes.CornerRadius || '', type: 'number', section: 'appearance' });
                break;
            case 'Entry':
            case 'Editor':
                properties.push({ key: 'Text', value: attributes.Text || '', type: 'string', section: 'appearance' }, { key: 'Placeholder', value: attributes.Placeholder || '', type: 'string', section: 'appearance' }, { key: 'PlaceholderColor', value: attributes.PlaceholderColor || '', type: 'color', section: 'appearance' }, { key: 'TextColor', value: attributes.TextColor || '', type: 'color', section: 'appearance' });
                break;
            case 'Frame':
            case 'Border':
                properties.push({ key: 'BorderColor', value: attributes.BorderColor || '', type: 'color', section: 'appearance' }, { key: 'CornerRadius', value: attributes.CornerRadius || '', type: 'number', section: 'appearance' }, { key: 'HasShadow', value: attributes.HasShadow || 'False', type: 'boolean', section: 'appearance' });
                break;
            case 'Image':
                properties.push({ key: 'Source', value: attributes.Source || '', type: 'string', section: 'appearance' }, { key: 'Aspect', value: attributes.Aspect || '', type: 'select', options: ['AspectFit', 'AspectFill', 'Fill'], section: 'appearance' });
                break;
            case 'Grid':
                properties.push({ key: 'RowDefinitions', value: attributes.RowDefinitions || '', type: 'string', section: 'layout' }, { key: 'ColumnDefinitions', value: attributes.ColumnDefinitions || '', type: 'string', section: 'layout' }, { key: 'RowSpacing', value: attributes.RowSpacing || '', type: 'number', section: 'layout' }, { key: 'ColumnSpacing', value: attributes.ColumnSpacing || '', type: 'number', section: 'layout' });
                break;
            case 'StackLayout':
                properties.push({ key: 'Orientation', value: attributes.Orientation || 'Vertical', type: 'select', options: ['Vertical', 'Horizontal'], section: 'layout' }, { key: 'Spacing', value: attributes.Spacing || '', type: 'number', section: 'layout' });
                break;
        }
        // Add any additional attributes that weren't covered
        for (const [key, value] of Object.entries(attributes)) {
            if (!properties.some(p => p.key === key)) {
                properties.push({
                    key: key,
                    value: value,
                    type: 'string',
                    section: 'structure'
                });
            }
        }
        return properties.filter(p => p.value !== ''); // Only include properties with values
    }
    _buildXamlElementForId(id, type, properties) {
        const props = [
            { key: 'Width', value: '', type: 'number', section: 'layout' },
            { key: 'Height', value: '', type: 'number', section: 'layout' },
            { key: 'X', value: '', type: 'number', section: 'layout' },
            { key: 'Y', value: '', type: 'number', section: 'layout' },
            { key: 'Background', value: '', type: 'color', section: 'appearance' },
            { key: 'Opacity', value: '1', type: 'number', section: 'appearance' }
        ];
        if (properties) {
            for (const [k, v] of Object.entries(properties)) {
                props.push({ key: k, value: String(v), type: 'string', section: 'appearance' });
            }
        }
        return {
            id: id,
            type: type,
            name: type,
            properties: props,
            children: []
        };
    }
    _generatePreviewHtml(xamlContent) {
        const parsedXaml = this._parseXaml(xamlContent);
        const mobilePreview = this._generateMobilePreview(parsedXaml);
        const elementStructure = this._generateElementStructure(parsedXaml);
        return `<!DOCTYPE html>
        <html lang="sl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>MAUI XAML Preview</title>
            <!-- Removed external icon CSS to avoid network dependency in webview -->
            <style>
                * { box-sizing: border-box; }

                body {
                    margin: 0;
                    padding: 0;
                    background: #1e1e1e;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    overflow: hidden;
                    height: 100vh;
                }

                .app-container {
                    display: flex;
                    height: 100vh;
                    flex-direction: column;
                }

                .main-toolbar {
                    background: #2d2d30;
                    padding: 8px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #3c3c3c;
                    flex-shrink: 0;
                    gap: 16px;
                }

                .zoom-controls {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    background: #383838;
                    border-radius: 4px;
                    padding: 4px;
                }

                .zoom-btn {
                    background: #4a4a4a;
                    border: none;
                    color: #fff;
                    padding: 4px 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 11px;
                    transition: background 0.2s;
                    min-width: 28px;
                    text-align: center;
                }

                .zoom-btn:hover {
                    background: #5a5a5a;
                }

                .zoom-btn.active {
                    background: #0078d4;
                }

                .zoom-level {
                    color: #ccc;
                    font-size: 11px;
                    min-width: 45px;
                    text-align: center;
                    background: #2d2d30;
                    padding: 4px 6px;
                    border-radius: 3px;
                }

                .toolbar-left {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                }

                .toolbar-right {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                }

                .mode-selector {
                    display: flex;
                    background: #3c3c3c;
                    border-radius: 6px;
                    overflow: hidden;
                }

                .mode-btn {
                    background: transparent;
                    border: none;
                    color: #ccc;
                    padding: 8px 16px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .mode-btn:hover {
                    background: #404040;
                    color: #fff;
                }

                .mode-btn.active {
                    background: #0078d4;
                    color: white;
                }

                .platform-selector {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                }

                .platform-btn {
                    background: #3c3c3c;
                    border: 1px solid #555;
                    color: #fff;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-size: 11px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .platform-btn:hover {
                    border-color: #0078d4;
                    background: #404040;
                }

                .platform-btn.active {
                    background: #0078d4;
                    border-color: #0078d4;
                    color: white;
                }

                .toolbar-controls {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .control-group {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                    padding: 0 8px;
                    border-left: 1px solid #555;
                }

                .control-group:first-child {
                    border-left: none;
                    padding-left: 0;
                }

                .toolbar-btn {
                    background: #3c3c3c;
                    border: 1px solid #555;
                    color: #fff;
                    padding: 6px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    transition: all 0.2s ease;
                }

                .toolbar-btn:hover {
                    background: #404040;
                    border-color: #0078d4;
                }

                .toolbar-btn.active {
                    background: #0078d4;
                    border-color: #0078d4;
                }

                .workspace {
                    display: flex;
                    flex: 1;
                    height: calc(100vh - 60px);
                }

                .side-panel-header {
                    padding: 12px 16px;
                    background: #2d2d30;
                    border-bottom: 1px solid #3c3c3c;
                    font-size: 13px;
                    font-weight: 600;
                    color: #4fc3f7;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .side-panel-tabs {
                    display: flex;
                    background: #2d2d30;
                    border-bottom: 1px solid #3c3c3c;
                }

                .side-panel-tab {
                    flex: 1;
                    padding: 8px 12px;
                    text-align: center;
                    cursor: pointer;
                    font-size: 11px;
                    background: transparent;
                    border: none;
                    color: #ccc;
                    transition: all 0.2s ease;
                }

                .side-panel-tab:hover {
                    background: #3c3c3c;
                    color: #fff;
                }

                .side-panel-tab.active {
                    background: #0078d4;
                    color: white;
                }

                .side-panel-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                }

                .element-tree {
                    font-size: 12px;
                }

                .tree-item {
                    padding: 4px 8px;
                    margin: 2px 0;
                    border-radius: 3px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s ease;
                }

                .tree-item:hover {
                    background: rgba(79, 195, 247, 0.1);
                }

                .tree-item.selected {
                    background: rgba(255, 152, 0, 0.2);
                    border-left: 3px solid #ff9800;
                }

                .tree-item-icon {
                    width: 16px;
                    text-align: center;
                    color: #4fc3f7;
                }

                .tree-item-name {
                    font-weight: 500;
                    color: #fff;
                }

                .tree-item-type {
                    font-size: 10px;
                    color: #888;
                    margin-left: auto;
                }

                .tree-children {
                    margin-left: 20px;
                    border-left: 1px solid #404040;
                    padding-left: 8px;
                }

                .properties-section {
                    margin-bottom: 20px;
                }

                .properties-section h4 {
                    margin: 0 0 10px 0;
                    color: #81c784;
                    font-size: 13px;
                    font-weight: 600;
                    border-bottom: 1px solid #404040;
                    padding-bottom: 6px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .property-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                    padding: 6px;
                    border-radius: 3px;
                    transition: background 0.2s ease;
                }

                .property-row:hover {
                    background: #2d2d30;
                }

                .property-row label {
                    font-size: 12px;
                    color: #cccccc;
                    font-weight: 500;
                    width: 80px;
                    flex-shrink: 0;
                }

                .property-row input,
                .property-row select {
                    background: #3c3c3c;
                    border: 1px solid #555;
                    color: #fff;
                    padding: 4px 8px;
                    border-radius: 3px;
                    font-size: 11px;
                    width: 120px;
                    outline: none;
                    transition: border-color 0.2s ease;
                }

                .property-row input:focus,
                .property-row select:focus {
                    border-color: #0078d4;
                }

                .preview-container {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    background: #2d2d30;
                    position: relative;
                }

                .preview-header {
                    padding: 8px 16px;
                    background: #333336;
                    border-bottom: 1px solid #3c3c3c;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 12px;
                }

                .zoom-controls {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                }

                .zoom-btn {
                    background: #3c3c3c;
                    border: 1px solid #555;
                    color: #fff;
                    width: 24px;
                    height: 24px;
                    border-radius: 3px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                }

                .zoom-level {
                    color: #ccc;
                    font-size: 11px;
                    min-width: 40px;
                    text-align: center;
                }

                .preview-viewport {
                    flex: 1;
                    overflow: auto;
                    position: relative;
                    background:
                        linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px),
                        linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px);
                    background-size: 20px 20px;
                    transform-origin: center top;
                    transition: transform 0.3s ease;
                }

                .device-wrapper {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100%;
                    padding: 40px;
                    transform-origin: center top;
                    transition: transform 0.3s ease;
                }

                .device-frame {
                    position: relative;
                    transition: all 0.3s ease;
                    background: #000;
                    box-shadow: 0 10px 50px rgba(0,0,0,0.5);
                    transform-origin: center;
                }

                .device-frame.android {
                    width: 360px;
                    height: 640px;
                    border-radius: 25px;
                    padding: 15px;
                }

                .device-frame.ios {
                    width: 375px;
                    height: 812px;
                    border-radius: 40px;
                    padding: 20px;
                }

                .device-frame.windows {
                    width: 1024px;
                    height: 768px;
                    border-radius: 8px;
                    padding: 8px;
                    background: #f0f0f0;
                }

                .device-frame.macos {
                    width: 1280px;
                    height: 800px;
                    border-radius: 12px;
                    padding: 12px;
                    background: #1c1c1e;
                }

                .device-screen {
                    width: 100%;
                    height: 100%;
                    border-radius: inherit;
                    overflow: hidden;
                    position: relative;
                    background: #fff;
                }

                .android .device-screen {
                    border-radius: 20px;
                    background: #fafafa;
                }

                .ios .device-screen {
                    border-radius: 25px;
                    background: #f2f2f7;
                }

                .windows .device-screen {
                    border-radius: 4px;
                    background: #ffffff;
                    border: 1px solid #e1e1e1;
                }

                .macos .device-screen {
                    border-radius: 8px;
                    background: #ffffff;
                }

                .status-bar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 15px;
                    font-size: 14px;
                    font-weight: 500;
                }

                .android .status-bar {
                    height: 24px;
                    background: #0078d4;
                    color: white;
                }

                .ios .status-bar {
                    height: 44px;
                    background: transparent;
                    color: #000;
                    font-weight: 600;
                }

                .windows .status-bar {
                    height: 32px;
                    background: #0078d4;
                    color: white;
                }

                .macos .status-bar {
                    height: 28px;
                    background: #f6f6f6;
                    color: #000;
                    border-bottom: 1px solid #e1e1e1;
                }

                .content-area {
                    height: calc(100% - var(--status-bar-height));
                    position: relative;
                    overflow: auto;
                }

                .android .content-area { --status-bar-height: 24px; }
                .ios .content-area { --status-bar-height: 44px; }
                .windows .content-area { --status-bar-height: 32px; }
                .macos .content-area { --status-bar-height: 28px; }

                .grid-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    opacity: 0.3;
                    z-index: 1000;
                    background-image:
                        linear-gradient(rgba(0,100,255,0.3) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0,100,255,0.3) 1px, transparent 1px);
                    background-size: 16px 16px;
                    display: none;
                }

                .grid-overlay.visible {
                    display: block;
                }

                .alignment-guides {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 1001;
                }

                .guide-line {
                    position: absolute;
                    background: #ff6b00;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }

                .guide-line.vertical {
                    width: 2px;
                    height: 100%;
                }

                .guide-line.horizontal {
                    width: 100%;
                    height: 2px;
                }

                .guide-line.active {
                    opacity: 0.8;
                }

                .xaml-element {
                    position: relative;
                    border: 2px solid transparent;
                    transition: all 0.2s ease;
                    min-width: 20px;
                    min-height: 20px;
                    cursor: default;
                }

                .mode-select .xaml-element {
                    cursor: pointer;
                }

                .mode-move .xaml-element {
                    cursor: move;
                }

                .xaml-element:hover {
                    border-color: #4fc3f7;
                    box-shadow: 0 0 8px rgba(79, 195, 247, 0.3);
                }

                .xaml-element.selected {
                    border-color: #ff9800;
                    box-shadow: 0 0 12px rgba(255, 152, 0, 0.4);
                }

                .xaml-element.dragging {
                    z-index: 1002;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
                }

                .element-handles {
                    position: absolute;
                    top: -8px;
                    left: -8px;
                    right: -8px;
                    bottom: -8px;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    pointer-events: none;
                }

                .xaml-element.selected .element-handles {
                    opacity: 1;
                    pointer-events: all;
                }

                .resize-handle {
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    background: #ff9800;
                    border: 1px solid #fff;
                    border-radius: 2px;
                    cursor: pointer;
                }

                .resize-handle.nw { top: 0; left: 0; cursor: nw-resize; }
                .resize-handle.n { top: 0; left: 50%; transform: translateX(-50%); cursor: n-resize; }
                .resize-handle.ne { top: 0; right: 0; cursor: ne-resize; }
                .resize-handle.e { top: 50%; right: 0; transform: translateY(-50%); cursor: e-resize; }
                .resize-handle.se { bottom: 0; right: 0; cursor: se-resize; }
                .resize-handle.s { bottom: 0; left: 50%; transform: translateX(-50%); cursor: s-resize; }
                .resize-handle.sw { bottom: 0; left: 0; cursor: sw-resize; }
                .resize-handle.w { top: 50%; left: 0; transform: translateY(-50%); cursor: w-resize; }

                .rotation-handle {
                    position: absolute;
                    top: -20px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 12px;
                    height: 12px;
                    background: #4caf50;
                    border: 1px solid #fff;
                    border-radius: 50%;
                    cursor: grab;
                }

                .rotation-handle:active {
                    cursor: grabbing;
                }

                .element-info {
                    position: absolute;
                    top: -32px;
                    left: 0;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 4px 8px;
                    border-radius: 3px;
                    font-size: 10px;
                    white-space: nowrap;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 1003;
                }

                .xaml-element:hover .element-info,
                .xaml-element.selected .element-info {
                    opacity: 1;
                }

                /* MAUI Element Styles with proper rendering */
                .maui-button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 12px 24px;
                    border: none;
                    border-radius: 6px;
                    font-size: 16px;
                    font-weight: 500;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.2s ease;
                    background: #0078d4;
                    color: white;
                    margin: 4px;
                    min-height: 40px;
                }

                .android .maui-button {
                    border-radius: 4px;
                    text-transform: uppercase;
                    font-weight: 600;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }

                .ios .maui-button {
                    border-radius: 10px;
                    font-weight: 600;
                }

                .windows .maui-button {
                    border-radius: 2px;
                    border: 1px solid #0078d4;
                }

                .macos .maui-button {
                    border-radius: 6px;
                    background: #007aff;
                }

                .maui-label {
                    padding: 8px;
                    color: #333;
                    font-size: 16px;
                    line-height: 1.4;
                    margin: 2px;
                    background: transparent;
                    word-wrap: break-word;
                }

                .android .maui-label {
                    font-family: 'Roboto', sans-serif;
                }

                .ios .maui-label {
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                }

                .windows .maui-label {
                    font-family: 'Segoe UI', sans-serif;
                }

                .macos .maui-label {
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                }

                .maui-entry {
                    border: 1px solid #ccc;
                    padding: 12px 16px;
                    border-radius: 6px;
                    font-size: 16px;
                    background: white;
                    margin: 4px;
                    width: 250px;
                    outline: none;
                    min-height: 40px;
                }

                .android .maui-entry {
                    border-bottom: 2px solid #0078d4;
                    border-radius: 4px 4px 0 0;
                    background: transparent;
                }

                .ios .maui-entry {
                    border-radius: 10px;
                    background: #f2f2f7;
                    border: 1px solid #e5e5ea;
                }

                .windows .maui-entry {
                    border-radius: 2px;
                    border: 2px solid #0078d4;
                }

                .maui-stacklayout {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    padding: 8px;
                    background: transparent;
                    min-height: 50px;
                }

                .maui-stacklayout.horizontal {
                    flex-direction: row;
                    align-items: center;
                }

                .maui-grid {
                    display: grid;
                    gap: 8px;
                    padding: 8px;
                    background: transparent;
                    min-height: 100px;
                    border: 1px dashed #ccc;
                }

                .maui-frame {
                    padding: 16px;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    margin: 8px;
                    border: 1px solid #e0e0e0;
                }

                .maui-image {
                    max-width: 200px;
                    height: auto;
                    border-radius: 6px;
                    margin: 4px;
                    background: #f5f5f5;
                    min-height: 100px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #888;
                    font-size: 12px;
                }

                .no-selection {
                    text-align: center;
                    color: #888;
                    margin-top: 60px;
                    font-style: italic;
                }

                .collapse-btn {
                    background: transparent;
                    border: none;
                    color: #ccc;
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 2px;
                }

                .collapse-btn:hover {
                    background: #404040;
                    color: #fff;
                }

                .status-info {
                    color: #888;
                    font-size: 11px;
                }

                .resize-corner {
                    position: absolute;
                    bottom: 0;
                    right: 0;
                    width: 12px;
                    height: 12px;
                    background: #555;
                    cursor: se-resize;
                    opacity: 0.7;
                }

                .resize-corner:hover {
                    background: #0078d4;
                    opacity: 1;
                }
            </style>
        </head>
        <body>
            <div class="app-container">
                <div class="main-toolbar">
                    <div class="toolbar-left">
                        <div class="mode-selector">
                            <button class="mode-btn active" id="selectMode">Select</button>
                            <button class="mode-btn" id="moveMode">Move</button>
                        </div>

                        <div class="platform-selector">
                            <button class="platform-btn active" data-platform="android">Android</button>
                            <button class="platform-btn" data-platform="ios">iOS</button>
                            <button class="platform-btn" data-platform="windows">Windows</button>
                            <button class="platform-btn" data-platform="macos">macOS</button>
                        </div>
                    </div>

                    <div class="toolbar-right">
                        <div class="zoom-controls">
                            <button class="zoom-btn" id="zoomOut" title="Zoom Out">−</button>
                            <span class="zoom-level" id="zoomLevel">100%</span>
                            <button class="zoom-btn" id="zoomIn" title="Zoom In">+</button>
                            <button class="zoom-btn" id="zoomFit" title="Fit to Window">Fit</button>
                            <button class="zoom-btn" id="zoomActual" title="Actual Size">1:1</button>
                        </div>
                        
                        <div class="control-group">
                            <button class="toolbar-btn" id="gridToggle">Grid</button>
                            <select class="toolbar-btn" id="gridSize" style="padding: 4px 6px;">
                                <option value="8">8px</option>
                                <option value="16" selected>16px</option>
                                <option value="24">24px</option>
                            </select>
                        </div>

                        <div class="control-group">
                            <button class="toolbar-btn" id="snapToggle">Snap</button>
                        </div>

                        <div class="control-group">
                            <button class="toolbar-btn" id="panelToggle">Sidebar</button>
                        </div>
                    </div>
                </div>

                <div class="workspace">
                    <!-- Properties panel moved to VS Code sidebar -->

                    <div class="preview-container">
                        <div class="preview-header">
                            <div class="status-info">
                                <span id="currentMode">Select Mode</span> |
                                <span id="currentPlatform">Android</span> |
                                <span id="elementCount">0 elements</span>
                            </div>

                            <div class="zoom-controls">
                                <button class="zoom-btn" id="zoomOut">-</button>
                                <span class="zoom-level" id="zoomLevel">100%</span>
                                <button class="zoom-btn" id="zoomIn">+</button>
                                <button class="zoom-btn" id="zoomFit">Fit</button>
                            </div>
                        </div>

                        <div class="preview-viewport" id="previewViewport">
                            <div class="device-wrapper">
                                <div class="device-frame android" id="deviceFrame">
                                    <div class="device-screen">
                                        <div class="status-bar">
                                            <span>9:41</span>
                                            <span>MAUI Preview</span>
                                            <span><i class="fas fa-battery-three-quarters"></i> 85%</span>
                                        </div>
                                        <div class="content-area">
                                            <div class="grid-overlay" id="gridOverlay"></div>
                                            <div class="alignment-guides" id="alignmentGuides">
                                                <div class="guide-line vertical" id="vGuide"></div>
                                                <div class="guide-line horizontal" id="hGuide"></div>
                                            </div>
                                            <div id="xamlContent">
                                                ${mobilePreview}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let selectedElement = null;
                let currentPlatform = 'android';
                let currentMode = 'select';
                let snapEnabled = false;
                let gridVisible = false;
                let gridSize = 16;
                let isDragging = false;
                let isResizing = false;
                let isRotating = false;
                let dragOffset = { x: 0, y: 0 };
                let zoomLevel = 1;
                let currentZoom = 100; // Zoom percentage
                const zoomSteps = [25, 50, 75, 100, 125, 150, 200, 300, 400];

                // Initialize app
                document.addEventListener('DOMContentLoaded', function() {
                    initializeEventListeners();
                    updateElementCount();
                    updateStatusBar();
                    // Ask extension to provide sidebar properties data
                    vscode.postMessage({ type: 'requestPropertiesData' });
                });

                function initializeEventListeners() {
                    // Mode switching
                    const selectModeBtn = document.getElementById('selectMode');
                    if (selectModeBtn) selectModeBtn.addEventListener('click', () => setMode('select'));
                    const moveModeBtn = document.getElementById('moveMode');
                    if (moveModeBtn) moveModeBtn.addEventListener('click', () => setMode('move'));

                    // Platform switching
                    document.querySelectorAll('.platform-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            currentPlatform = btn.dataset.platform;
                            updatePlatform();
                        });
                    });

                    // Controls
                    const gridToggleBtn = document.getElementById('gridToggle');
                    if (gridToggleBtn) gridToggleBtn.addEventListener('click', toggleGrid);
                    const snapToggleBtn = document.getElementById('snapToggle');
                    if (snapToggleBtn) snapToggleBtn.addEventListener('click', toggleSnap);

                    // Grid size
                    const gridSizeSelect = document.getElementById('gridSize');
                    if (gridSizeSelect) gridSizeSelect.addEventListener('change', (e) => {
                        gridSize = parseInt(e.target.value);
                        updateGridSize();
                    });

                    // Tabs
                    // Tabs no longer present (side panel removed)

                    // Zoom controls
                    const zoomInBtn = document.getElementById('zoomIn');
                    if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
                    const zoomOutBtn = document.getElementById('zoomOut');
                    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
                    const zoomFitBtn = document.getElementById('zoomFit');
                    if (zoomFitBtn) zoomFitBtn.addEventListener('click', fitToViewport);
                    const zoomActualBtn = document.getElementById('zoomActual');
                    if (zoomActualBtn) zoomActualBtn.addEventListener('click', zoomActualSize);

                    // Element interactions
                    initializeElementInteractions();

                    // Global mouse events
                    document.addEventListener('mousemove', handleGlobalMouseMove);
                    document.addEventListener('mouseup', handleGlobalMouseUp);
                    document.addEventListener('click', handleGlobalClick);
                }

                function setMode(mode) {
                    currentMode = mode;
                    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
                    document.getElementById(mode + 'Mode').classList.add('active');

                    const contentArea = document.querySelector('.content-area');
                    contentArea.className = contentArea.className.replace(/mode-\\w+/g, '');
                    contentArea.classList.add('mode-' + mode);

                    updateStatusBar();
                }

                function updatePlatform() {
                    const deviceFrame = document.getElementById('deviceFrame');
                    deviceFrame.className = \`device-frame \${currentPlatform}\`;
                    updateStatusBarForPlatform(currentPlatform);
                    updateStatusBar();

                    vscode.postMessage({
                        type: 'platformChanged',
                        platform: currentPlatform
                    });
                }

                function updateStatusBarForPlatform(platform) {
                    const statusBar = document.querySelector('.status-bar');
                    const spans = statusBar.querySelectorAll('span');

                    switch(platform) {
                        case 'android':
                            spans[0].textContent = '9:41';
                            spans[1].textContent = 'MAUI Preview';
                            spans[2].innerHTML = '<i class="fas fa-battery-three-quarters"></i> 85%';
                            break;
                        case 'ios':
                            spans[0].textContent = '9:41';
                            spans[1].textContent = '';
                            spans[2].innerHTML = '<i class="fas fa-battery-full"></i>';
                            break;
                        case 'windows':
                            spans[0].textContent = 'MAUI App';
                            spans[1].textContent = '';
                            spans[2].innerHTML = '<i class="fas fa-times"></i><i class="fas fa-window-maximize"></i><i class="fas fa-minus"></i>';
                            break;
                        case 'macos':
                            spans[0].innerHTML = '<i class="fas fa-circle" style="color: #ff5f57;"></i><i class="fas fa-circle" style="color: #ffbd2e;"></i><i class="fas fa-circle" style="color: #28ca42;"></i>';
                            spans[1].textContent = 'MAUI App';
                            spans[2].textContent = '';
                            break;
                    }
                }

                function toggleGrid() {
                    gridVisible = !gridVisible;
                    const gridOverlay = document.getElementById('gridOverlay');
                    const gridBtn = document.getElementById('gridToggle');

                    if (gridVisible) {
                        gridOverlay.classList.add('visible');
                        gridBtn.classList.add('active');
                    } else {
                        gridOverlay.classList.remove('visible');
                        gridBtn.classList.remove('active');
                    }
                }

                function toggleSnap() {
                    snapEnabled = !snapEnabled;
                    const snapBtn = document.getElementById('snapToggle');

                    if (snapEnabled) {
                        snapBtn.classList.add('active');
                    } else {
                        snapBtn.classList.remove('active');
                    }
                }

                function togglePanel() {
                    const sidePanel = document.getElementById('sidePanel');
                    const panelBtn = document.getElementById('panelToggle');

                    sidePanel.classList.toggle('collapsed');
                    panelBtn.classList.toggle('active');
                }

                function updateGridSize() {
                    const gridOverlay = document.getElementById('gridOverlay');
                    gridOverlay.style.backgroundSize = \`\${gridSize}px \${gridSize}px\`;
                }

                function switchTab(tab) {
                    document.querySelectorAll('.side-panel-tab').forEach(t => t.classList.remove('active'));
                    document.getElementById(tab + 'Tab').classList.add('active');

                    document.getElementById('structureContent').style.display = tab === 'structure' ? 'block' : 'none';
                    document.getElementById('propertiesContent').style.display = tab === 'properties' ? 'block' : 'none';
                }

                function updateZoomDisplay() {
                    document.getElementById('zoomLevel').textContent = currentZoom + '%';
                }

                function setZoom(newZoom) {
                    currentZoom = Math.max(25, Math.min(400, newZoom));
                    zoomLevel = currentZoom / 100;
                    const deviceWrapper = document.querySelector('.device-wrapper');
                    deviceWrapper.style.transform = \`scale(\${zoomLevel})\`;
                    updateZoomDisplay();
                }

                function zoomIn() {
                    const currentIndex = zoomSteps.indexOf(currentZoom);
                    if (currentIndex < zoomSteps.length - 1) {
                        setZoom(zoomSteps[currentIndex + 1]);
                    }
                }

                function zoomOut() {
                    const currentIndex = zoomSteps.indexOf(currentZoom);
                    if (currentIndex > 0) {
                        setZoom(zoomSteps[currentIndex - 1]);
                    }
                }

                function zoomActualSize() {
                    setZoom(100);
                }

                function fitToViewport() {
                    const viewport = document.querySelector('.preview-viewport');
                    const deviceWrapper = document.querySelector('.device-wrapper');
                    const deviceFrame = document.getElementById('deviceFrame');
                    
                    // Reset transform to get original size
                    deviceWrapper.style.transform = 'scale(1)';
                    
                    const deviceRect = deviceFrame.getBoundingClientRect();
                    const viewportRect = viewport.getBoundingClientRect();
                    
                    const scaleX = (viewportRect.width - 80) / deviceRect.width;
                    const scaleY = (viewportRect.height - 80) / deviceRect.height;
                    const scale = Math.min(scaleX, scaleY, 1); // Don't scale larger than 100%
                    
                    const zoomPercent = Math.round(scale * 100);
                    setZoom(zoomPercent);

                    const scaleX = (viewportRect.width - 100) / deviceRect.width;
                    const scaleY = (viewportRect.height - 100) / deviceRect.height;
                    const scale = Math.min(scaleX, scaleY, 1);

                    setZoom(scale);
                }

                function updateStatusBar() {
                    document.getElementById('currentMode').textContent = currentMode === 'select' ? 'Select Mode' : 'Move Mode';
                    document.getElementById('currentPlatform').textContent = currentPlatform.charAt(0).toUpperCase() + currentPlatform.slice(1);
                }

                function updateElementCount() {
                    const elements = document.querySelectorAll('.xaml-element');
                    document.getElementById('elementCount').textContent = \`\${elements.length} elements\`;
                }

                function snapToGrid(value) {
                    if (!snapEnabled) return value;
                    return Math.round(value / gridSize) * gridSize;
                }

                function showAlignmentGuide(type, position) {
                    const guide = document.getElementById(type === 'vertical' ? 'vGuide' : 'hGuide');
                    if (type === 'vertical') {
                        guide.style.left = position + 'px';
                    } else {
                        guide.style.top = position + 'px';
                    }
                    guide.classList.add('active');
                }

                function hideAlignmentGuides() {
                    document.querySelectorAll('.guide-line').forEach(guide => {
                        guide.classList.remove('active');
                    });
                }

                function selectElement(element) {
                    if (selectedElement) {
                        selectedElement.classList.remove('selected');
                        removeElementHandles(selectedElement);

                        // Remove tree selection
                        document.querySelectorAll('.tree-item').forEach(item => {
                            item.classList.remove('selected');
                        });
                    }

                    selectedElement = element;
                    element.classList.add('selected');
                    addElementHandles(element);

                    // Highlight in tree
                    const elementType = element.dataset.type || 'unknown';
                    const treeItems = document.querySelectorAll('.tree-item');
                    treeItems.forEach(item => {
                        if (item.dataset.elementId === element.id) {
                            item.classList.add('selected');
                        }
                    });

                    // Extract detailed properties from element
                    const computedStyle = getComputedStyle(element);
                    const properties = {
                        // Layout properties
                        Width: element.offsetWidth + 'px',
                        Height: element.offsetHeight + 'px',
                        X: element.offsetLeft + 'px',
                        Y: element.offsetTop + 'px',
                        Margin: computedStyle.margin,
                        Padding: computedStyle.padding,
                        
                        // Appearance properties
                        BackgroundColor: computedStyle.backgroundColor,
                        TextColor: computedStyle.color,
                        Opacity: computedStyle.opacity,
                        FontSize: computedStyle.fontSize,
                        FontWeight: computedStyle.fontWeight,
                        FontStyle: computedStyle.fontStyle,
                        
                        // Border properties
                        BorderColor: computedStyle.borderColor,
                        BorderWidth: computedStyle.borderWidth,
                        CornerRadius: computedStyle.borderRadius,
                        
                        // Content
                        Text: element.textContent || element.value || '',
                        
                        // Additional metadata
                        ElementType: elementType,
                        ClassName: element.className,
                        IsVisible: computedStyle.display !== 'none' ? 'True' : 'False'
                    };

                    // Extract data attributes (which might contain XAML properties)
                    Object.keys(element.dataset).forEach(key => {
                        if (key !== 'type' && key !== 'elementId') {
                            properties[key] = element.dataset[key];
                        }
                    });

                    console.log('[Selection] Element selected:', elementType, properties);

                    vscode.postMessage({
                        type: 'elementSelected',
                        elementId: element.id,
                        elementType: elementType,
                        properties: properties
                    });
                }

                function addElementHandles(element) {
                    const handles = document.createElement('div');
                    handles.className = 'element-handles';
                    handles.innerHTML = \`
                        <div class="resize-handle nw" data-direction="nw"></div>
                        <div class="resize-handle n" data-direction="n"></div>
                        <div class="resize-handle ne" data-direction="ne"></div>
                        <div class="resize-handle e" data-direction="e"></div>
                        <div class="resize-handle se" data-direction="se"></div>
                        <div class="resize-handle s" data-direction="s"></div>
                        <div class="resize-handle sw" data-direction="sw"></div>
                        <div class="resize-handle w" data-direction="w"></div>
                        <div class="rotation-handle" data-action="rotate"></div>
                    \`;

                    handles.querySelectorAll('.resize-handle').forEach(handle => {
                        handle.addEventListener('mousedown', startResize);
                    });

                    handles.querySelector('.rotation-handle').addEventListener('mousedown', startRotate);

                    element.appendChild(handles);
                }

                function removeElementHandles(element) {
                    const handles = element.querySelector('.element-handles');
                    if (handles) {
                        handles.remove();
                    }
                }

                // showElementProperties removed — external sidebar now owns properties UI

                function getElementSpecificProperties(elementType) {
                    switch(elementType) {
                        case 'Label':
                            return \`
                                <div class="properties-section">
                                    <h4><i class="fas fa-font"></i> Text</h4>
                                    <div class="property-row">
                                        <label>Text:</label>
                                        <input type="text" placeholder="Label Text" onchange="updateProperty('Text', this.value)">
                                    </div>
                                    <div class="property-row">
                                        <label>Font Size:</label>
                                        <input type="number" value="16" onchange="updateProperty('FontSize', this.value + 'px')">
                                    </div>
                                    <div class="property-row">
                                        <label>Color:</label>
                                        <input type="color" onchange="updateProperty('Color', this.value)">
                                    </div>
                                </div>
                            \`;
                        case 'Button':
                            return \`
                                <div class="properties-section">
                                    <h4><i class="fas fa-hand-pointer"></i> Button</h4>
                                    <div class="property-row">
                                        <label>Text:</label>
                                        <input type="text" placeholder="Button" onchange="updateProperty('Text', this.value)">
                                    </div>
                                    <div class="property-row">
                                        <label>Command:</label>
                                        <input type="text" placeholder="Command" onchange="updateProperty('Command', this.value)">
                                    </div>
                                </div>
                            \`;
                        case 'Entry':
                            return \`
                                <div class="properties-section">
                                    <h4><i class="fas fa-keyboard"></i> Input</h4>
                                    <div class="property-row">
                                        <label>Placeholder:</label>
                                        <input type="text" placeholder="Enter text..." onchange="updateProperty('Placeholder', this.value)">
                                    </div>
                                </div>
                            \`;
                        default:
                            return '';
                    }
                }

                function updateProperty(property, value) {
                    if (!selectedElement) return;

                    // Apply visual changes immediately
                    switch(property) {
                        case 'Width':
                            selectedElement.style.width = value;
                            break;
                        case 'Height':
                            selectedElement.style.height = value;
                            break;
                        case 'Left':
                            selectedElement.style.left = value;
                            break;
                        case 'Top':
                            selectedElement.style.top = value;
                            break;
                        case 'BackgroundColor':
                            selectedElement.style.backgroundColor = value;
                            break;
                        case 'Opacity':
                            selectedElement.style.opacity = value;
                            break;
                        case 'Rotation':
                            selectedElement.style.transform = \`rotate(\${value})\`;
                            break;
                        case 'Text':
                            selectedElement.textContent = value;
                            break;
                        case 'FontSize':
                            selectedElement.style.fontSize = value;
                            break;
                        case 'Color':
                            selectedElement.style.color = value;
                            break;
                    }

                    vscode.postMessage({
                        type: 'propertyChanged',
                        elementId: selectedElement.id,
                        property: property,
                        value: value
                    });
                }

                function initializeElementInteractions() {
                    const elements = document.querySelectorAll('.xaml-element');
                    elements.forEach(element => {
                        // Add element info tooltip
                        const info = document.createElement('div');
                        info.className = 'element-info';
                        info.textContent = element.dataset.type || 'Element';
                        element.appendChild(info);

                        element.addEventListener('click', function(e) {
                            e.stopPropagation();
                            if (currentMode === 'select') {
                                selectElement(this);
                            }
                        });

                        element.addEventListener('mousedown', function(e) {
                            if (e.target.classList.contains('resize-handle') ||
                                e.target.classList.contains('rotation-handle')) return;

                            if (currentMode === 'move') {
                                isDragging = true;
                                this.classList.add('dragging');
                                const rect = this.getBoundingClientRect();
                                const container = document.querySelector('.content-area').getBoundingClientRect();
                                dragOffset.x = e.clientX - rect.left;
                                dragOffset.y = e.clientY - rect.top;

                                selectElement(this);
                                e.preventDefault();
                            }
                        });
                    });

                    // Allow root container to be target for resize/move via handles if needed
                    const root = document.getElementById('xamlContent');
                    if (root && !root.classList.contains('xaml-element')) {
                        root.classList.add('xaml-element');
                        // Assign a stable-ish ID if missing
                        if (!root.id) {
                            root.id = 'element_' + Math.random().toString(36).substr(2, 9);
                        }
                    }
                }

                function startResize(e) {
                    e.stopPropagation();
                    isResizing = true;
                    const direction = e.target.dataset.direction;
                    const element = selectedElement;
                    const rect = element.getBoundingClientRect();
                    const startX = e.clientX;
                    const startY = e.clientY;

                    function doResize(e) {
                        if (!isResizing) return;

                        const deltaX = e.clientX - startX;
                        const deltaY = e.clientY - startY;

                        let newWidth = rect.width;
                        let newHeight = rect.height;

                        if (direction.includes('e')) newWidth += deltaX;
                        if (direction.includes('w')) newWidth -= deltaX;
                        if (direction.includes('s')) newHeight += deltaY;
                        if (direction.includes('n')) newHeight -= deltaY;

                        newWidth = Math.max(20, snapToGrid(newWidth));
                        newHeight = Math.max(20, snapToGrid(newHeight));

                        element.style.width = newWidth + 'px';
                        element.style.height = newHeight + 'px';
                    }

                    function stopResize() {
                        isResizing = false;
                        document.removeEventListener('mousemove', doResize);
                        document.removeEventListener('mouseup', stopResize);
                        hideAlignmentGuides();

                        if (selectedElement) {
                            vscode.postMessage({
                                type: 'elementResized',
                                elementId: selectedElement.id,
                                size: {
                                    width: selectedElement.offsetWidth,
                                    height: selectedElement.offsetHeight
                                }
                            });
                        }
                    }

                    document.addEventListener('mousemove', doResize);
                    document.addEventListener('mouseup', stopResize);
                }

                function startRotate(e) {
                    e.stopPropagation();
                    isRotating = true;
                    const element = selectedElement;
                    const rect = element.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    function doRotate(e) {
                        if (!isRotating) return;

                        const deltaX = e.clientX - centerX;
                        const deltaY = e.clientY - centerY;
                        const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI) + 90;

                        element.style.transform = \`rotate(\${angle}deg)\`;
                    }

                    function stopRotate() {
                        isRotating = false;
                        document.removeEventListener('mousemove', doRotate);
                        document.removeEventListener('mouseup', stopRotate);

                        if (selectedElement) {
                            const transform = selectedElement.style.transform;
                            const rotateMatch = transform.match(/rotate\\(([^)]+)\\)/);
                            const rotation = rotateMatch ? rotateMatch[1] : '0deg';

                            vscode.postMessage({
                                type: 'elementRotated',
                                elementId: selectedElement.id,
                                rotation: rotation
                            });
                        }
                    }

                    document.addEventListener('mousemove', doRotate);
                    document.addEventListener('mouseup', stopRotate);
                }

                function handleGlobalMouseMove(e) {
                    if (!isDragging || !selectedElement || currentMode !== 'move') return;

                    const container = document.querySelector('.content-area');
                    const containerRect = container.getBoundingClientRect();

                    let newX = e.clientX - containerRect.left - dragOffset.x;
                    let newY = e.clientY - containerRect.top - dragOffset.y;

                    newX = snapToGrid(Math.max(0, newX));
                    newY = snapToGrid(Math.max(0, newY));

                    selectedElement.style.position = 'absolute';
                    selectedElement.style.left = newX + 'px';
                    selectedElement.style.top = newY + 'px';

                    // Show alignment guides
                    if (snapEnabled) {
                        showAlignmentGuide('vertical', newX + selectedElement.offsetWidth / 2);
                        showAlignmentGuide('horizontal', newY + selectedElement.offsetHeight / 2);
                    }
                }

                function handleGlobalMouseUp() {
                    if (isDragging && selectedElement) {
                        isDragging = false;
                        selectedElement.classList.remove('dragging');
                        hideAlignmentGuides();

                        vscode.postMessage({
                            type: 'elementMoved',
                            elementId: selectedElement.id,
                            position: {
                                x: selectedElement.offsetLeft,
                                y: selectedElement.offsetTop
                            }
                        });
                    }
                }

                function handleGlobalClick(e) {
                    if (!e.target.closest('.xaml-element') &&
                        !e.target.closest('.element-handles')) {
                        if (selectedElement) {
                            selectedElement.classList.remove('selected');
                            removeElementHandles(selectedElement);
                            selectedElement = null;

                            // Clear tree selection
                            document.querySelectorAll('.tree-item').forEach(item => {
                                item.classList.remove('selected');
                            });
                        }
                    }
                }

                // Receive messages from the extension
                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (!msg || !msg.type) return;

                    switch (msg.type) {
                        case 'updateProperty':
                            // msg.property and msg.value
                            const prop = msg.property;
                            const val = msg.value;
                            if (selectedElement) {
                                // Apply common properties
                                if (prop.toLowerCase().includes('width')) selectedElement.style.width = val;
                                if (prop.toLowerCase().includes('height')) selectedElement.style.height = val;
                                if (prop.toLowerCase().includes('background') || prop.toLowerCase().includes('backgroundcolor')) selectedElement.style.background = val;
                                if (prop.toLowerCase().includes('opacity')) selectedElement.style.opacity = val;
                            }
                            break;
                    }
                });

                // Initialize with default platform
                updateStatusBarForPlatform('android');
            </script>
        </body>
        </html>`;
    }
    _parseXaml(xamlContent) {
        try {
            console.log('[XAML Parser] Starting XAML parsing...');
            console.log('[XAML Parser] Content length:', xamlContent.length);
            const parser = new fast_xml_parser_1.XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '@_',
                parseTagValue: false,
                parseAttributeValue: false,
                trimValues: true
            });
            const result = parser.parse(xamlContent);
            console.log('[XAML Parser] Parsing successful');
            console.log('[XAML Parser] Parsed structure:', JSON.stringify(result, null, 2));
            return result;
        }
        catch (error) {
            console.error('[XAML Parser] Error parsing XAML:', error);
            console.error('[XAML Parser] Content:', xamlContent.substring(0, 500) + '...');
            // Show error to user
            vscode.window.showErrorMessage(`XAML parsing error: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    _generateMobilePreview(parsedXaml) {
        console.log('[Preview] Generating mobile preview...');
        if (!parsedXaml) {
            console.log('[Preview] No parsed XAML data available');
            return `<div style="padding: 20px; text-align: center; color: #666; background: #f8f8f8; border-radius: 8px; margin: 20px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 12px; color: #ff6b6b;"></i>
                <p style="font-size: 16px; margin-bottom: 8px; color: #333;">Error parsing XAML</p>
                <p style="font-size: 12px; color: #666;">Please check XAML syntax and try again</p>
                <p style="font-size: 10px; color: #999; margin-top: 12px;">Check VS Code Developer Console (Help → Toggle Developer Tools) for detailed error information</p>
                <details style="margin-top: 12px; text-align: left;">
                    <summary style="cursor: pointer; color: #0078d4;">Troubleshooting Tips</summary>
                    <ul style="font-size: 11px; color: #666; margin-top: 8px;">
                        <li>Ensure all XML tags are properly closed</li>
                        <li>Check for missing namespace declarations</li>
                        <li>Verify attribute values are properly quoted</li>
                        <li>Make sure the XAML file is valid XML</li>
                    </ul>
                </details>
            </div>`;
        }
        console.log('[Preview] Converting XAML to HTML...');
        const result = this._convertXamlToHtml(parsedXaml, 0);
        console.log('[Preview] HTML conversion completed, length:', result.length);
        return result;
    }
    _generateElementStructure(parsedXaml) {
        if (!parsedXaml) {
            return '<div style="color: #888; text-align: center; padding: 20px;">No elements</div>';
        }
        return this._convertXamlToTree(parsedXaml, 0);
    }
    _convertXamlToTree(node, depth) {
        if (typeof node === 'string') {
            return '';
        }
        if (typeof node === 'object') {
            let result = '';
            for (const [key, value] of Object.entries(node)) {
                if (key.startsWith('@_'))
                    continue;
                const elementId = `element_${Math.random().toString(36).substr(2, 9)}`;
                const icon = this._getElementIcon(key);
                result += `
                    <div class="tree-item" data-element-id="${elementId}" onclick="selectElementFromTree('${elementId}')">
                        <i class="tree-item-icon ${icon}"></i>
                        <span class="tree-item-name">${key}</span>
                        <span class="tree-item-type">${key}</span>
                    </div>
                `;
                if (typeof value === 'object' && value !== null) {
                    if (!Array.isArray(value)) {
                        const children = this._getChildElements(value);
                        if (children.length > 0) {
                            result += '<div class="tree-children">';
                            for (const child of children) {
                                result += this._convertXamlToTree(child, depth + 1);
                            }
                            result += '</div>';
                        }
                    }
                }
            }
            return result;
        }
        return '';
    }
    _getElementIcon(elementType) {
        const iconMap = {
            'ContentPage': 'fas fa-file',
            'StackLayout': 'fas fa-align-justify',
            'Grid': 'fas fa-th',
            'Label': 'fas fa-font',
            'Button': 'fas fa-hand-pointer',
            'Entry': 'fas fa-keyboard',
            'Image': 'fas fa-image',
            'Frame': 'fas fa-square',
            'Border': 'fas fa-border-style'
        };
        return iconMap[elementType] || 'fas fa-cube';
    }
    _convertXamlToHtml(node, depth) {
        if (typeof node === 'string') {
            return node;
        }
        if (typeof node === 'object') {
            let result = '';
            for (const [key, value] of Object.entries(node)) {
                if (key.startsWith('@_'))
                    continue;
                const elementId = `element_${Math.random().toString(36).substr(2, 9)}`;
                const elementClass = this._getMauiElementClass(key);
                const attributes = this._extractAttributes(value);
                const content = this._getElementContent(key, attributes);
                result += `<div id="${elementId}" class="xaml-element ${elementClass}" data-type="${key}" data-attributes='${JSON.stringify(attributes)}' style="position: relative; ${this._buildElementStyle(key, attributes)}">`;
                if (typeof value === 'object' && value !== null) {
                    if (Array.isArray(value)) {
                        for (const item of value) {
                            result += this._convertXamlToHtml(item, depth + 1);
                        }
                    }
                    else {
                        const children = this._getChildElements(value);
                        if (children.length > 0) {
                            for (const child of children) {
                                result += this._convertXamlToHtml(child, depth + 1);
                            }
                        }
                        else if (content) {
                            result += content;
                        }
                    }
                }
                else if (typeof value === 'string') {
                    result += value;
                }
                else if (content) {
                    result += content;
                }
                result += '</div>';
            }
            return result;
        }
        return '';
    }
    _getMauiElementClass(elementType) {
        const classMap = {
            'StackLayout': 'maui-stacklayout',
            'Grid': 'maui-grid',
            'Label': 'maui-label',
            'Button': 'maui-button',
            'Entry': 'maui-entry',
            'Editor': 'maui-entry',
            'Image': 'maui-image',
            'Frame': 'maui-frame',
            'Border': 'maui-frame'
        };
        return classMap[elementType] || 'maui-element';
    }
    _extractAttributes(node) {
        const attributes = {};
        if (typeof node === 'object' && node !== null) {
            for (const [key, value] of Object.entries(node)) {
                if (key.startsWith('@_')) {
                    const attrName = key.substring(2);
                    let attrValue = String(value);
                    // Resolve resource values
                    attrValue = this._resolveResourceValue(attrValue);
                    attributes[attrName] = attrValue;
                }
            }
        }
        return attributes;
    }
    _getElementContent(elementType, attributes) {
        const style = this._buildElementStyle(elementType, attributes);
        switch (elementType) {
            case 'Label':
                return `<span style="${style}">${attributes.Text || 'Label Text'}</span>`;
            case 'Button':
                return `<button style="${style}" type="button">${attributes.Text || 'Button'}</button>`;
            case 'Entry':
                return `<input type="text" placeholder="${attributes.Placeholder || 'Enter text...'}" value="${attributes.Text || ''}" readonly style="${style} width: 100%; border: 1px solid #ccc; padding: 8px; border-radius: 4px;">`;
            case 'Editor':
                return `<textarea placeholder="${attributes.Placeholder || 'Enter text...'}" readonly style="${style} width: 100%; border: 1px solid #ccc; padding: 8px; border-radius: 4px; resize: vertical;">${attributes.Text || ''}</textarea>`;
            case 'Image':
                return `<div style="${style} background: #f0f0f0; color: #888; text-align: center; padding: 20px; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                    <i class="fas fa-image" style="margin-right: 8px;"></i>
                    Image: ${attributes.Source || 'No source'}
                </div>`;
            case 'Frame':
            case 'Border':
                return `<div style="${style} border: 1px solid #ccc; border-radius: 8px; padding: 16px;"></div>`;
            default:
                return '';
        }
    }
    _buildElementStyle(elementType, attributes) {
        const styles = [];
        console.log(`[Style] Building style for ${elementType}:`, attributes);
        // Background color
        if (attributes.BackgroundColor) {
            const resolvedColor = this._resolveResourceValue(attributes.BackgroundColor);
            console.log(`[Style] Background color: ${attributes.BackgroundColor} -> ${resolvedColor}`);
            styles.push(`background-color: ${resolvedColor}`);
        }
        // Text color
        if (attributes.TextColor) {
            styles.push(`color: ${attributes.TextColor}`);
        }
        // Font properties
        if (attributes.FontSize) {
            styles.push(`font-size: ${attributes.FontSize}px`);
        }
        if (attributes.FontAttributes) {
            if (attributes.FontAttributes.includes('Bold')) {
                styles.push('font-weight: bold');
            }
            if (attributes.FontAttributes.includes('Italic')) {
                styles.push('font-style: italic');
            }
        }
        // Layout properties
        if (attributes.Margin) {
            styles.push(`margin: ${this._parseThickness(attributes.Margin)}`);
        }
        if (attributes.Padding) {
            styles.push(`padding: ${this._parseThickness(attributes.Padding)}`);
        }
        // Border properties for Frame/Border
        if (elementType === 'Frame' || elementType === 'Border') {
            if (attributes.BorderColor) {
                styles.push(`border-color: ${attributes.BorderColor}`);
            }
            if (attributes.CornerRadius) {
                styles.push(`border-radius: ${attributes.CornerRadius}px`);
            }
            if (attributes.HasShadow === 'True') {
                styles.push('box-shadow: 0 2px 4px rgba(0,0,0,0.1)');
            }
        }
        // Opacity
        if (attributes.Opacity) {
            styles.push(`opacity: ${attributes.Opacity}`);
        }
        return styles.join('; ');
    }
    _parseThickness(thickness) {
        if (!thickness)
            return '0';
        const values = thickness.split(',').map(v => v.trim() + 'px');
        if (values.length === 1) {
            return values[0];
        }
        else if (values.length === 2) {
            return `${values[1]} ${values[0]}`; // vertical horizontal
        }
        else if (values.length === 4) {
            return `${values[0]} ${values[1]} ${values[2]} ${values[3]}`; // top right bottom left
        }
        return thickness;
    }
    _getChildElements(node) {
        const children = [];
        for (const [key, value] of Object.entries(node)) {
            if (!key.startsWith('@_') && key !== '#text') {
                if (Array.isArray(value)) {
                    children.push(...value);
                }
                else {
                    children.push({ [key]: value });
                }
            }
        }
        return children;
    }
    _buildElementMap(xamlContent) {
        this._elementMap.clear();
        const lines = xamlContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const elementMatch = line.match(/<(\w+)(?:\s|>)/);
            if (elementMatch && !line.trim().startsWith('</')) {
                const elementName = elementMatch[1];
                let endLine = i;
                if (line.includes('/>')) {
                    endLine = i;
                }
                else if (line.includes(`</${elementName}>`)) {
                    endLine = i;
                }
                else {
                    for (let j = i + 1; j < lines.length; j++) {
                        if (lines[j].includes(`</${elementName}>`)) {
                            endLine = j;
                            break;
                        }
                    }
                }
                const elementId = `element_${Math.random().toString(36).substr(2, 9)}`;
                this._elementMap.set(elementId, {
                    startLine: i,
                    endLine: endLine,
                    elementName: elementName
                });
            }
        }
    }
    _handleElementSelection(elementId, elementType, properties) {
        console.log(`Element selected: ${elementId} (${elementType})`, properties);
        // Highlight in code editor
        this._highlightElementInCode(elementId, elementType);
        // Update properties sidebar with detailed information
        if (this._propertiesProvider) {
            // Find the element in our parsed structure or create it
            const xamlElement = this._findOrCreateElementForSelection(elementId, elementType, properties);
            this._propertiesProvider.setSelectedElement(xamlElement);
        }
        // Update status
        vscode.window.setStatusBarMessage(`Selected: ${elementType} (${elementId.substring(0, 8)}...)`, 3000);
    }
    _findOrCreateElementForSelection(elementId, elementType, properties) {
        // Try to find the element in the current document structure
        if (this._currentDocument) {
            const xamlContent = this._currentDocument.getText();
            const parsedXaml = this._parseXaml(xamlContent);
            if (parsedXaml) {
                const foundElement = this._findElementInParsed(parsedXaml, elementType);
                if (foundElement) {
                    return foundElement;
                }
            }
        }
        // Fallback: create element from provided data
        const attributes = properties || {};
        const elementProperties = this._buildPropertiesFromAttributes(elementType, attributes);
        return {
            id: elementId,
            type: elementType,
            name: attributes.Name || attributes['x:Name'] || elementType,
            properties: elementProperties,
            children: []
        };
    }
    _findElementInParsed(node, targetType) {
        if (typeof node !== 'object' || node === null) {
            return null;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('@_'))
                continue;
            if (key === targetType) {
                const elementId = `element_${Math.random().toString(36).substr(2, 9)}`;
                const attributes = this._extractAttributes(value);
                const properties = this._buildPropertiesFromAttributes(key, attributes);
                return {
                    id: elementId,
                    type: key,
                    name: attributes.Name || attributes['x:Name'] || key,
                    properties: properties,
                    children: []
                };
            }
            // Recursively search in child elements
            if (typeof value === 'object') {
                const childElements = this._getChildElements(value);
                for (const child of childElements) {
                    const result = this._findElementInParsed(child, targetType);
                    if (result) {
                        return result;
                    }
                }
            }
        }
        return null;
    }
    _handlePropertyChange(elementId, property, value) {
        console.log(`Property changed: ${elementId}.${property} = ${value}`);
        if (!this._currentDocument)
            return;
        vscode.window.showInformationMessage(`Updated: ${property} = ${value}`);
    }
    _handlePlatformChange(platform) {
        this._currentPlatform = platform;
        console.log(`Platform changed to: ${platform}`);
        vscode.window.showInformationMessage(`Preview platform: ${platform}`);
    }
    _handleElementMove(elementId, position) {
        console.log(`Element moved: ${elementId}`, position);
        vscode.window.showInformationMessage(`Element moved to (${position.x}, ${position.y})`);
    }
    _handleElementResize(elementId, size) {
        console.log(`Element resized: ${elementId}`, size);
        vscode.window.showInformationMessage(`Element resized to ${size.width}x${size.height}`);
    }
    _handleElementRotation(elementId, rotation) {
        console.log(`Element rotated: ${elementId}`, rotation);
        vscode.window.showInformationMessage(`Element rotated to ${rotation}`);
    }
    _highlightElementInCode(elementId, elementType) {
        if (!this._currentDocument || !this._elementHighlightDecoration) {
            return;
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document !== this._currentDocument) {
            return;
        }
        activeEditor.setDecorations(this._elementHighlightDecoration, []);
        if (elementType && elementType !== 'unknown') {
            this._highlightElementByType(elementType, activeEditor);
        }
    }
    _highlightElementByType(elementType, activeEditor) {
        if (!this._elementHighlightDecoration)
            return;
        const text = activeEditor.document.getText();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(`<${elementType}`) && !line.trim().startsWith('</')) {
                let endLine = i;
                if (line.includes('/>')) {
                    endLine = i;
                }
                else if (line.includes(`</${elementType}>`)) {
                    endLine = i;
                }
                else {
                    for (let j = i + 1; j < lines.length; j++) {
                        if (lines[j].includes(`</${elementType}>`)) {
                            endLine = j;
                            break;
                        }
                    }
                }
                const startPosition = new vscode.Position(i, 0);
                const endPosition = new vscode.Position(endLine, lines[endLine].length);
                const range = new vscode.Range(startPosition, endPosition);
                const decoration = {
                    range: range,
                    hoverMessage: `Selected: ${elementType}`
                };
                activeEditor.setDecorations(this._elementHighlightDecoration, [decoration]);
                activeEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                break;
            }
        }
    }
    _loadResourceDictionaries(document) {
        console.log('[Resources] Loading resource dictionaries...');
        this._resourceDictionary.clear();
        this._styleCache.clear();
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            console.log('[Resources] No workspace folder found');
            return;
        }
        const workspacePath = workspaceFolder.uri.fsPath;
        console.log('[Resources] Workspace path:', workspacePath);
        // Look for App.xaml and other resource files
        this._loadResourcesFromPattern(workspacePath, '**/App.xaml');
        this._loadResourcesFromPattern(workspacePath, '**/Resources/**/*.xaml');
        this._loadResourcesFromPattern(workspacePath, '**/Styles/**/*.xaml');
        this._loadResourcesFromPattern(workspacePath, '**/*Resources.xaml');
        // Extract resources from current document
        this._extractResourcesFromXaml(document.getText());
        console.log('[Resources] Loaded resources:', this._resourceDictionary.size);
        console.log('[Resources] Loaded styles:', this._styleCache.size);
        console.log('[Resources] Resource keys:', Array.from(this._resourceDictionary.keys()));
    }
    _loadResourcesFromPattern(workspacePath, pattern) {
        try {
            const files = vscode.workspace.findFiles(pattern);
            files.then(uris => {
                uris.forEach(uri => {
                    try {
                        const content = fs.readFileSync(uri.fsPath, 'utf8');
                        this._extractResourcesFromXaml(content);
                    }
                    catch (error) {
                        console.log(`Could not read resource file: ${uri.fsPath}`, error);
                    }
                });
            });
        }
        catch (error) {
            console.log(`Error loading resources from pattern ${pattern}:`, error);
        }
    }
    _extractResourcesFromXaml(xamlContent) {
        try {
            const parser = new fast_xml_parser_1.XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '@_'
            });
            const parsed = parser.parse(xamlContent);
            // Extract ResourceDictionary elements
            this._traverseForResources(parsed);
        }
        catch (error) {
            console.log('Error parsing XAML for resources:', error);
        }
    }
    _traverseForResources(node, path = '') {
        if (typeof node !== 'object' || node === null) {
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('@_'))
                continue;
            if (key === 'ResourceDictionary' || key.includes('Resources')) {
                this._extractResourcesFromNode(value);
            }
            else if (key === 'Style') {
                this._extractStyleFromNode(value);
            }
            else if (typeof value === 'object') {
                this._traverseForResources(value, `${path}.${key}`);
            }
        }
    }
    _extractResourcesFromNode(resourceNode) {
        if (typeof resourceNode !== 'object' || resourceNode === null) {
            return;
        }
        for (const [key, value] of Object.entries(resourceNode)) {
            if (key.startsWith('@_'))
                continue;
            if (typeof value === 'object' && value !== null && value['@_x:Key']) {
                const resourceKey = value['@_x:Key'];
                this._resourceDictionary.set(resourceKey, value);
            }
        }
    }
    _extractStyleFromNode(styleNode) {
        if (typeof styleNode !== 'object' || styleNode === null) {
            return;
        }
        const targetType = styleNode['@_TargetType'];
        const key = styleNode['@_x:Key'] || targetType;
        if (key) {
            this._styleCache.set(key, styleNode);
        }
    }
    _initializeThemeColors() {
        console.log('[Theme] Initializing theme colors for platform:', this._currentPlatform);
        // Initialize common MAUI theme colors
        this._themeColors.clear();
        // Primary colors
        this._themeColors.set('Primary', '#512BD4');
        this._themeColors.set('Secondary', '#DFD8F7');
        this._themeColors.set('Tertiary', '#2B0B98');
        // Gray colors
        this._themeColors.set('White', '#FFFFFF');
        this._themeColors.set('Black', '#000000');
        this._themeColors.set('Gray100', '#E1E1E1');
        this._themeColors.set('Gray200', '#C8C8C8');
        this._themeColors.set('Gray300', '#ACACAC');
        this._themeColors.set('Gray400', '#919191');
        this._themeColors.set('Gray500', '#6E6E6E');
        this._themeColors.set('Gray600', '#404040');
        this._themeColors.set('Gray900', '#212121');
        this._themeColors.set('Gray950', '#141414');
        // Platform-specific colors based on current platform
        switch (this._currentPlatform) {
            case 'android':
                this._themeColors.set('PlatformPrimary', '#4CAF50');
                this._themeColors.set('PlatformAccent', '#FF9800');
                break;
            case 'ios':
                this._themeColors.set('PlatformPrimary', '#007AFF');
                this._themeColors.set('PlatformAccent', '#FF3B30');
                break;
            case 'windows':
                this._themeColors.set('PlatformPrimary', '#0078D4');
                this._themeColors.set('PlatformAccent', '#8764B8');
                break;
        }
        console.log('[Theme] Initialized theme colors:', Array.from(this._themeColors.keys()));
    }
    _resolveResourceValue(value) {
        if (!value)
            return value;
        // Handle StaticResource and DynamicResource
        const staticResourceMatch = value.match(/\{StaticResource\s+([^}]+)\}/);
        if (staticResourceMatch) {
            const resourceKey = staticResourceMatch[1].trim();
            const resource = this._resourceDictionary.get(resourceKey);
            if (resource) {
                return this._extractResourceValue(resource);
            }
        }
        const dynamicResourceMatch = value.match(/\{DynamicResource\s+([^}]+)\}/);
        if (dynamicResourceMatch) {
            const resourceKey = dynamicResourceMatch[1].trim();
            const resource = this._resourceDictionary.get(resourceKey);
            if (resource) {
                return this._extractResourceValue(resource);
            }
        }
        // Handle theme colors
        if (this._themeColors.has(value)) {
            return this._themeColors.get(value);
        }
        return value;
    }
    _extractResourceValue(resource) {
        if (typeof resource === 'string') {
            return resource;
        }
        if (typeof resource === 'object' && resource !== null) {
            // For Color resources
            if (resource['@_Color']) {
                return resource['@_Color'];
            }
            // For SolidColorBrush resources
            if (resource['@_Color'] || resource.Color) {
                return resource['@_Color'] || resource.Color;
            }
            // For other resource types, try to find a value
            for (const [key, value] of Object.entries(resource)) {
                if (!key.startsWith('@_') && typeof value === 'string') {
                    return value;
                }
            }
        }
        return '';
    }
}
exports.MauiXamlPreviewProvider = MauiXamlPreviewProvider;
MauiXamlPreviewProvider.viewType = 'mauiXamlPreview';
//# sourceMappingURL=previewProvider.backup.js.map