import * as vscode from 'vscode';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

import { MauiPropertiesProvider, XamlElement, ElementProperty, PropertyTreeItem } from './propertiesProvider';
import { ResourceManager, ParsedResource, StyleResource } from './resourceManager';
import { PlatformManager } from './platformManager';
import { ZoomManager } from './zoomManager';

interface ParsedElement {
    id: string;
    type: string;
    name?: string;
    attributes: Record<string, string>;
    resolvedAttributes: Record<string, string>;
    children: ParsedElement[];
    textContent?: string;
    metadata: {
        startLine?: number;
        startIndex?: number;
        gridRows?: string[];
        gridColumns?: string[];
        cornerRadius?: string;
    };
}

const COLOR_NAME_MAP: Record<string, string> = {
    transparent: 'transparent',
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    orange: '#ffa500',
    gray: '#808080',
    grey: '#808080',
    lightgray: '#d3d3d3',
    darkgray: '#4d4d4d',
    lightgrey: '#d3d3d3',
    darkgrey: '#4d4d4d',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    purple: '#800080',
    brown: '#a52a2a',
    teal: '#008080',
    indigo: '#4b0082'
};

export class MauiXamlPreviewProvider implements vscode.WebviewPanelSerializer {
    private static readonly viewType = 'mauiXamlPreview';

    private readonly _extensionUri: vscode.Uri;
    private _currentPanel: vscode.WebviewPanel | undefined;
    private _currentDocument: vscode.TextDocument | undefined;
    private _elementHighlightDecoration: vscode.TextEditorDecorationType | undefined;
    private _elementMap: Map<string, { startLine: number; endLine: number; elementName: string }> = new Map();
    private _propertiesProvider: MauiPropertiesProvider | undefined;
    private _propertiesTreeView: vscode.TreeView<PropertyTreeItem> | undefined;
    private _structureProvider: MauiPropertiesProvider | undefined;
    private _structureTreeView: vscode.TreeView<PropertyTreeItem> | undefined;

    private _resourceManager: ResourceManager;
    private _platformManager: PlatformManager;
    private _zoomManager: ZoomManager;

    private _resources: ParsedResource[] = [];
    private _styles: StyleResource[] = [];
    private _themeColors: Map<string, string> = new Map();

    private _parsedElements: ParsedElement[] = [];
    private _elementLookup: Map<string, ParsedElement> = new Map();
    private _xamlElements: XamlElement[] = [];
    private _elementIdCounter = 0;
    private _currentSelectedElementId: string | undefined;
    private _viewMode: 'full' | 'selected' = 'full';

    private _xmlParser: XMLParser;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._resourceManager = new ResourceManager();
        this._platformManager = new PlatformManager();
        this._zoomManager = new ZoomManager();
        this._xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            parseTagValue: false,
            parseAttributeValue: false,
            trimValues: true,
            removeNSPrefix: false,
            allowBooleanAttributes: true
        });
        console.log('[PreviewProvider] Initialized with managers');
    }

    // Provide color suggestions for property editors
    public getColorSuggestions(): string[] {
        const suggestions = new Set<string>();
        // Theme colors
        for (const [k, v] of this._themeColors.entries()) {
            suggestions.add(k);
            suggestions.add(v);
        }
        // Parsed resources
        for (const r of this._resources) {
            if (r.type === 'Color' && r.value) {
                suggestions.add(r.key);
                suggestions.add(r.value);
            }
        }
        // Common named colors
        for (const name of Object.keys(COLOR_NAME_MAP)) {
            suggestions.add(name);
        }
        return Array.from(suggestions).filter(Boolean).slice(0, 200);
    }

    // Provide style key suggestions
    public getStyleSuggestions(): string[] {
        const styles = new Set<string>();
        for (const s of this._styles) {
            if (s.key) styles.add(s.key);
        }
        return Array.from(styles).slice(0, 200);
    }

    // Provide generic StaticResource keys (e.g., Colors, Brushes, etc.)
    public getResourceKeySuggestions(): string[] {
        const keys = new Set<string>();
        for (const r of this._resources) {
            if (r.key) keys.add(r.key);
        }
        return Array.from(keys).slice(0, 300);
    }

    public setElementHighlightDecoration(decoration: vscode.TextEditorDecorationType) {
        this._elementHighlightDecoration = decoration;
    }

    public setPropertiesProvider(provider: MauiPropertiesProvider, treeView?: vscode.TreeView<PropertyTreeItem>) {
        this._propertiesProvider = provider;
        this._propertiesTreeView = treeView; // kept for backward compatibility, not used for reveal anymore
        console.log('[PreviewProvider] Properties provider set');
    }

    public setStructureProvider(provider: MauiPropertiesProvider, treeView: vscode.TreeView<PropertyTreeItem>) {
        this._structureProvider = provider;
        this._structureTreeView = treeView;
        console.log('[PreviewProvider] Structure provider set');
    }

    public updateElementProperty(property: ElementProperty, newValue: string) {
        if (this._currentPanel) {
            this._currentPanel.webview.postMessage({
                type: 'updateProperty',
                property: property.key,
                value: newValue
            });
        }

        if (this._propertiesProvider) {
            this._propertiesProvider.refresh();
        }
    }

    public async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel): Promise<void> {
        this._currentPanel = webviewPanel;
        this._configureWebview(webviewPanel.webview);
    }

    public async openPreview(document: vscode.TextDocument) {
        console.log('[PreviewProvider] Opening preview for:', document.fileName);
        this._currentDocument = document;

        if (this._currentPanel) {
            try {
                this._currentPanel.reveal(vscode.ViewColumn.Beside);
                await this.updatePreview(document);
                return;
            } catch (error) {
                console.warn('[PreviewProvider] Existing panel is no longer usable, recreating.', error);
                this._currentPanel.dispose();
                this._currentPanel = undefined;
            }
        }

        this._currentPanel = vscode.window.createWebviewPanel(
            MauiXamlPreviewProvider.viewType,
            `MAUI Preview: ${path.basename(document.fileName)}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._configureWebview(this._currentPanel.webview);
        await this.updatePreview(document);

        this._currentPanel.onDidDispose(() => {
            this._currentPanel = undefined;
            console.log('[PreviewProvider] Panel disposed');
        }, null);
    }

    public async updatePreview(document: vscode.TextDocument) {
        if (!this._currentPanel) {
            console.warn('[PreviewProvider] No panel available for update');
            return;
        }

        this._currentDocument = document;

        try {
            const xamlContent = document.getText();
            console.log('[PreviewProvider] Updating preview for:', document.fileName);

            const resourceData = await this._resourceManager.loadResourcesForFile(document.fileName);
            this._resources = resourceData.resources;
            this._styles = resourceData.styles;
            this._initializeThemeColors();

            this._parsedElements = this._parseXamlDocument(xamlContent);
            this._indexParsedElements();
            this._assignElementPositions(xamlContent);
            this._xamlElements = this._convertParsedToXamlElements(this._parsedElements);

            const htmlContent = this._generatePreviewHtml();
            this._currentPanel.webview.html = htmlContent;

            this._sendPropertiesDataToSidebar();

            console.log('[PreviewProvider] Preview updated successfully');
        } catch (error) {
            console.error('[PreviewProvider] Error updating preview:', error);
            this._showErrorMessage('Failed to update preview: ' + error);
        }
    }

    // PUBLIC: Select element by id from outside (tree/cmd)
    public async selectElementById(elementId: string) {
        if (!elementId) return;
        await this._handleElementSelection(elementId);
        // also instruct webview to mark as selected
        this._currentPanel?.webview.postMessage({ type: 'selectElement', elementId });
    }

    // PUBLIC: Select element based on caret line in active XAML
    public async selectElementAtLine(line: number) {
        if (!this._currentDocument) return;
        let bestId: string | undefined;
        let bestSpan = Number.POSITIVE_INFINITY;
        for (const [id, info] of this._elementMap.entries()) {
            if (line >= info.startLine && line <= info.endLine) {
                const span = info.endLine - info.startLine;
                if (span < bestSpan) { bestSpan = span; bestId = id; }
            }
        }
        if (bestId) {
            await this.selectElementById(bestId);
        }
    }

    private _configureWebview(webview: vscode.Webview) {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webview.onDidReceiveMessage(async (message) => {
            console.log('[PreviewProvider] Received message:', message.command, message);

            switch (message.command) {
                case 'elementSelected':
                    await this._handleElementSelection(message.elementId, message.line);
                    break;
                case 'switchPlatform':
                    await this._handlePlatformSwitch(message.platform);
                    break;
                case 'zoom':
                    this._handleZoom(message.action, message.value);
                    break;
                case 'changeViewMode':
                    this._handleViewModeChange(message.mode);
                    break;
                case 'ready':
                    console.log('[PreviewProvider] Webview ready');
                    setTimeout(() => {
                        this._sendPropertiesDataToSidebar();
                        this._applyViewModeToWebview();
                    }, 50);
                    break;
                default:
                    console.warn('[PreviewProvider] Unknown command:', message.command);
            }
        });

        console.log('[PreviewProvider] Webview configured');
    }

    private async _handleElementSelection(elementId: string, rawLine?: any) {
        if (!elementId) {
            return;
        }

        this._currentSelectedElementId = elementId;

        let targetLine: number | undefined;
        if (rawLine !== undefined && rawLine !== null && rawLine !== '') {
            const parsed = Number(rawLine);
            if (!Number.isNaN(parsed)) {
                targetLine = parsed;
            }
        }

        const elementInfo = this._elementMap.get(elementId);
        if (!targetLine && elementInfo) {
            targetLine = elementInfo.startLine;
        }

        if (targetLine !== undefined && this._currentDocument) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === this._currentDocument) {
                const clampedLine = Math.max(0, Math.min(targetLine, editor.document.lineCount - 1));
                const position = new vscode.Position(clampedLine, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);

                if (this._elementHighlightDecoration && elementInfo) {
                    const endLine = Math.max(elementInfo.startLine, elementInfo.endLine);
                    const range = new vscode.Range(
                        elementInfo.startLine,
                        0,
                        endLine,
                        editor.document.lineAt(endLine).text.length
                    );
                    editor.setDecorations(this._elementHighlightDecoration, [range]);
                }
            }
        }

        await this._focusPropertiesView();
        this._sendElementPropertiesToSidebar(elementId);
        // NEW: reveal in tree view
        await this._revealElementInTree(elementId);
        this._applyViewModeToWebview(elementId);
        // Ensure selection is reflected in DOM
        this._currentPanel?.webview.postMessage({ type: 'selectElement', elementId });
    }

    private async _revealElementInTree(elementId: string) {
        try {
            const provider = this._structureProvider ?? this._propertiesProvider;
            const tree = this._structureTreeView ?? this._propertiesTreeView;
            if (!provider || !tree) return;
            const anyProvider: any = provider as any;
            const item = typeof anyProvider.getTreeItemById === 'function' ? anyProvider.getTreeItemById(elementId) : undefined;
            if (item) {
                await tree.reveal(item, { expand: true, focus: true, select: true });
            } else {
                provider.refresh();
                await new Promise(r => setTimeout(r, 80));
                const item2 = typeof anyProvider.getTreeItemById === 'function' ? anyProvider.getTreeItemById(elementId) : undefined;
                if (item2) {
                    await tree.reveal(item2, { expand: true, focus: true, select: true });
                }
            }
        } catch (err) {
            console.warn('[PreviewProvider] reveal in tree failed', err);
        }
    }

    private async _handlePlatformSwitch(platform: string) {
        if (!platform) {
            return;
        }

        console.log(`[PreviewProvider] Switching to platform: ${platform}`);
        if (this._platformManager.setPlatform(platform)) {
            if (this._currentDocument) {
                await this.updatePreview(this._currentDocument);
            }
        } else {
            vscode.window.showWarningMessage(`Neznana platforma: ${platform}`);
        }
    }

    private _handleZoom(action: string, value?: number) {
        switch (action) {
            case 'in':
                this._zoomManager.zoomIn();
                break;
            case 'out':
                this._zoomManager.zoomOut();
                break;
            case 'fit':
                this._currentPanel?.webview.postMessage({ type: 'fitToViewport' });
                break;
            case 'actual':
                this._zoomManager.zoomActualSize();
                break;
            case 'set':
                if (typeof value === 'number') {
                    this._zoomManager.setZoom(value);
                }
                break;
        }

        this._currentPanel?.webview.postMessage({
            type: 'updateZoom',
            zoom: this._zoomManager.getCurrentZoom()
        });
    }

    private _sendPropertiesDataToSidebar() {
        if (!this._propertiesProvider && !this._structureProvider) {
            return;
        }

        if (this._propertiesProvider) {
            this._propertiesProvider.setElements(this._xamlElements);
        }
        if (this._structureProvider) {
            this._structureProvider.setElements(this._xamlElements);
        }

        const selectedElement = this._currentSelectedElementId
            ? this._findXamlElementById(this._currentSelectedElementId, this._xamlElements)
            : this._xamlElements[0];

        this._propertiesProvider?.setSelectedElement(selectedElement);

        if (!this._currentSelectedElementId && selectedElement) {
            this._currentSelectedElementId = selectedElement.id;
        }
    }

    private async _focusPropertiesView() {
        try {
            await vscode.commands.executeCommand('workbench.view.extension.maui-designer');
            await vscode.commands.executeCommand('mauiProperties.focus');
        } catch (error) {
            console.warn('[PreviewProvider] Unable to focus properties view:', error);
        }
    }

    private _handleViewModeChange(mode: string) {
        const normalized: 'full' | 'selected' = mode === 'selected' ? 'selected' : 'full';
        this._viewMode = normalized;

        const activeId = this._getActiveElementId();
        if (!this._currentSelectedElementId && activeId) {
            this._currentSelectedElementId = activeId;
        }

        this._applyViewModeToWebview(activeId);
    }

    private _applyViewModeToWebview(selectedId?: string) {
        if (!this._currentPanel) {
            return;
        }

        const targetId = selectedId ?? this._getActiveElementId();
        this._currentPanel.webview.postMessage({
            type: 'applyViewMode',
            mode: this._viewMode,
            selectedId: targetId
        });
    }

    private _getActiveElementId(): string | undefined {
        if (this._currentSelectedElementId) {
            return this._currentSelectedElementId;
        }
        return this._xamlElements.length > 0 ? this._xamlElements[0].id : undefined;
    }

    private _sendElementPropertiesToSidebar(elementId: string) {
        if (!this._propertiesProvider) {
            return;
        }

        const element = this._findXamlElementById(elementId, this._xamlElements);
        if (element) {
            this._currentSelectedElementId = elementId;
            this._propertiesProvider.setSelectedElement(element);
        }
    }

    private _findXamlElementById(id: string | undefined, elements: XamlElement[]): XamlElement | undefined {
        if (!id) {
            return undefined;
        }

        const stack: XamlElement[] = [...elements];
        while (stack.length) {
            const current = stack.shift()!;
            if (current.id === id) {
                return current;
            }
            stack.unshift(...current.children);
        }
        return undefined;
    }

    private _initializeThemeColors() {
        this._themeColors.clear();
        this._themeColors.set('Primary', '#007acc');
        this._themeColors.set('Secondary', '#6c757d');
        this._themeColors.set('Success', '#28a745');
        this._themeColors.set('Info', '#17a2b8');
        this._themeColors.set('Warning', '#ffc107');
        this._themeColors.set('Danger', '#dc3545');
        this._themeColors.set('Light', '#f8f9fa');
        this._themeColors.set('Dark', '#343a40');

        for (const resource of this._resources) {
            if (resource.type === 'Color') {
                this._themeColors.set(resource.key, resource.value);
            }
        }

        console.log(`[PreviewProvider] Initialized ${this._themeColors.size} theme colors`);
    }

    private _parseXamlDocument(xamlContent: string): ParsedElement[] {
        this._elementIdCounter = 0;
        const parsedElements: ParsedElement[] = [];

        if (!xamlContent.trim()) {
            return parsedElements;
        }

        try {
            const parsed = this._xmlParser.parse(xamlContent);
            for (const key in parsed) {
                const value = parsed[key];
                const nodes = Array.isArray(value) ? value : [value];
                for (const node of nodes) {
                    const element = this._convertNodeToElement(key, node);
                    if (element) {
                        parsedElements.push(element);
                    }
                }
            }
        } catch (error) {
            console.error('[PreviewProvider] Error parsing XAML:', error);
        }

        parsedElements.forEach(element => this._finalizeElementAttributes(element));
        return parsedElements;
    }

    private _convertNodeToElement(type: string, node: any): ParsedElement | null {
        if (node === null || node === undefined) {
            return null;
        }

        if (typeof node === 'string') {
            if (!node.trim()) {
                return null;
            }
            return {
                id: this._nextElementId(),
                type,
                attributes: {},
                resolvedAttributes: {},
                children: [],
                textContent: node.trim(),
                metadata: {}
            };
        }

        if (typeof node !== 'object') {
            return null;
        }

        const element: ParsedElement = {
            id: this._nextElementId(),
            type,
            attributes: {},
            resolvedAttributes: {},
            children: [],
            metadata: {}
        };

        for (const key in node) {
            const value = node[key];
            if (key.startsWith('@_')) {
                const attrName = key.substring(2);
                element.attributes[attrName] = value !== undefined && value !== null ? String(value).trim() : '';
            } else if (key === '#text') {
                if (typeof value === 'string' && value.trim()) {
                    element.textContent = value.trim();
                }
            } else if (key.includes('.')) {
                this._applyElementProperty(element, key, value);
            } else {
                const children = Array.isArray(value) ? value : [value];
                for (const child of children) {
                    const childElement = this._convertNodeToElement(key, child);
                    if (childElement) {
                        element.children.push(childElement);
                    }
                }
            }
        }

        element.name = element.attributes['x:Name'] || element.attributes['Name'];
        return element;
    }

    private _applyElementProperty(element: ParsedElement, propertyKey: string, rawValue: any) {
        const [owner, property] = propertyKey.split('.', 2);
        if (owner !== element.type) {
            return;
        }

        switch (property) {
            case 'Content':
            case 'Children':
                this._appendPropertyChildren(element, rawValue);
                break;
            case 'RowDefinitions':
                element.metadata.gridRows = this._extractGridDefinitions(rawValue, 'RowDefinition', 'Height');
                break;
            case 'ColumnDefinitions':
                element.metadata.gridColumns = this._extractGridDefinitions(rawValue, 'ColumnDefinition', 'Width');
                break;
            case 'StrokeShape':
                this._extractStrokeShape(element, rawValue);
                break;
            case 'Resources':
                break;
            default:
                this._appendPropertyChildren(element, rawValue);
                break;
        }
    }

    private _appendPropertyChildren(element: ParsedElement, propertyValue: any) {
        if (!propertyValue || typeof propertyValue !== 'object') {
            return;
        }

        for (const key in propertyValue) {
            if (key.startsWith('@_') || key === '#text') {
                continue;
            }

            const value = propertyValue[key];
            const nodes = Array.isArray(value) ? value : [value];
            for (const node of nodes) {
                const childElement = this._convertNodeToElement(key, node);
                if (childElement) {
                    element.children.push(childElement);
                }
            }
        }
    }

    private _extractGridDefinitions(propertyValue: any, elementName: string, attributeName: string): string[] {
        const result: string[] = [];
        if (!propertyValue || typeof propertyValue !== 'object') {
            return result;
        }

        const definitions = propertyValue[elementName];
        const defArray = Array.isArray(definitions) ? definitions : definitions ? [definitions] : [];
        for (const def of defArray) {
            if (def && typeof def === 'object') {
                const value = def[`@_${attributeName}`] ?? def[attributeName] ?? def['#text'];
                result.push(value ? String(value).trim() : '*');
            }
        }

        return result;
    }

    private _extractStrokeShape(element: ParsedElement, propertyValue: any) {
        if (!propertyValue || typeof propertyValue !== 'object') {
            return;
        }

        const shape = propertyValue['RoundRectangle'];
        if (!shape) {
            return;
        }

        const shapes = Array.isArray(shape) ? shape : [shape];
        for (const item of shapes) {
            if (item && typeof item === 'object') {
                const corner = item['@_CornerRadius'] ?? item['CornerRadius'];
                if (corner) {
                    element.metadata.cornerRadius = String(corner).trim();
                }
            }
        }
    }

    private _finalizeElementAttributes(element: ParsedElement) {
        const resolved: Record<string, string> = { ...element.attributes };

        const styleKey = this._extractResourceKey(resolved['Style']);
        if (styleKey) {
            const styleResource = this._resourceManager.resolveStyleResource(styleKey, this._styles);
            if (styleResource) {
                for (const setter in styleResource.setters) {
                    if (!resolved[setter]) {
                        resolved[setter] = styleResource.setters[setter];
                    }
                }
            }
        }

        for (const key of Object.keys(resolved)) {
            if (key.toLowerCase().includes('color')) {
                const color = this._resolveColor(resolved[key]);
                if (color) {
                    resolved[key] = color;
                }
            } else if (resolved[key] && resolved[key].startsWith('{StaticResource')) {
                const resourceKey = this._extractResourceKey(resolved[key]);
                if (resourceKey) {
                    const resourceValue = this._resourceManager.resolveStaticResource(resourceKey, this._resources);
                    if (resourceValue) {
                        resolved[key] = resourceValue;
                    }
                }
            }
        }

        element.resolvedAttributes = resolved;
        element.children.forEach(child => this._finalizeElementAttributes(child));
    }

    private _extractResourceKey(value?: string): string | undefined {
        if (!value) {
            return undefined;
        }
        const match = value.match(/\{(?:StaticResource|DynamicResource)\s+([^}]+)\}/);
        return match ? match[1].trim() : undefined;
    }

    private _indexParsedElements() {
        this._elementLookup.clear();
        const stack = [...this._parsedElements];
        while (stack.length) {
            const element = stack.shift()!;
            this._elementLookup.set(element.id, element);
            stack.unshift(...element.children);
        }
    }

    private _assignElementPositions(xamlContent: string) {
        this._elementMap.clear();
        const lineOffsets = this._calculateLineOffsets(xamlContent);
        let searchIndex = 0;

        const assign = (element: ParsedElement) => {
            const regex = new RegExp(`<${element.type}(?:[\n\r\s>])`, 'g');
            regex.lastIndex = searchIndex;
            const match = regex.exec(xamlContent);
            if (match) {
                const startIndex = match.index;
                const startLine = this._getLineForIndex(startIndex, lineOffsets);
                element.metadata.startIndex = startIndex;
                element.metadata.startLine = startLine;

                const closingTag = `</${element.type}>`;
                const closingIndex = xamlContent.indexOf(closingTag, startIndex);
                const endLine = closingIndex !== -1 ? this._getLineForIndex(closingIndex, lineOffsets) : startLine;

                this._elementMap.set(element.id, {
                    startLine,
                    endLine,
                    elementName: element.type
                });

                searchIndex = regex.lastIndex;
            }

            element.children.forEach(assign);
        };

        this._parsedElements.forEach(assign);
    }

    private _calculateLineOffsets(text: string): number[] {
        const offsets: number[] = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') {
                offsets.push(i + 1);
            }
        }
        return offsets;
    }

    private _getLineForIndex(index: number, offsets: number[]): number {
        if (index <= 0) {
            return 0;
        }
        let low = 0;
        let high = offsets.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (offsets[mid] === index) {
                return mid;
            }
            if (offsets[mid] < index) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return Math.max(0, low - 1);
    }

    private _generatePreviewHtml(): string {
        const platformSelector = this._platformManager.generatePlatformSelectorHtml();
        const deviceFrameCss = this._platformManager.generateDeviceFrameCss();
        const statusBarContent = this._platformManager.generateStatusBarContent();
        const navigationBarContent = this._platformManager.generateNavigationBarContent();
        const platformSwitchScript = this._platformManager.generatePlatformSwitchScript();
        const zoomScript = this._zoomManager.getWebviewZoomScript();
        const renderedContent = this._renderElements(this._parsedElements);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MAUI XAML Preview</title>
<style>
    :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    body {
        margin: 0;
        padding: 20px;
        background: #f5f5f5;
        overflow: auto;
    }

    .preview-container {
        max-width: 100%;
        margin: 0 auto;
    }

    .toolbar {
        background: white;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: center;
    }

    .zoom-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #d0d0d0;
        border-radius: 6px;
        padding: 4px;
        background: #fafafa;
    }

    .zoom-btn {
        padding: 6px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 4px;
        font-size: 14px;
    }

    .zoom-btn:hover {
        background: #e9f3ff;
    }

    .zoom-level {
        font-weight: 600;
        min-width: 48px;
        text-align: center;
    }

    .view-mode-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #d0d0d0;
        border-radius: 6px;
        padding: 4px;
        background: #fafafa;
    }

    .view-btn {
        padding: 6px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 4px;
        font-size: 14px;
        transition: background 0.15s ease, color 0.15s ease;
    }

    .view-btn:hover {
        background: #e9f3ff;
    }

    .view-btn.active {
        background: #007acc;
        color: white;
    }

    .preview-viewport {
        background: white;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 8px 24px rgba(15,22,33,0.1);
        min-height: 420px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
    }

    ${deviceFrameCss}

    .content-area {
        position: relative;
    }

    .xaml-root {
        width: 100%;
        height: 100%;
    }

    .maui-element {
        box-sizing: border-box;
        position: relative;
        transition: box-shadow 0.15s ease, transform 0.15s ease;
        cursor: pointer;
    }

    .maui-element:hover {
        box-shadow: 0 0 0 2px rgba(0,122,204,0.18);
    }

    .maui-element.hidden-element {
        display: none !important;
    }

    .maui-element.focused-element {
        box-shadow: 0 0 0 2px rgba(37,99,235,0.35), 0 8px 18px rgba(37,99,235,0.15);
    }

    .maui-element.ancestor-element {
        outline: 1px dashed rgba(37,99,235,0.35);
    }

    .maui-stacklayout {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
    }

    .maui-stacklayout.is-horizontal {
        flex-direction: row;
    }

    .maui-grid {
        display: grid;
        width: 100%;
        gap: 8px;
    }

    .maui-label {
        display: block;
        padding: 2px 0;
        color: #1f2933;
        white-space: pre-wrap;
    }

    .maui-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 18px;
        border-radius: 8px;
        border: none;
        font-weight: 600;
        background: #2563eb;
        color: white;
        box-shadow: 0 3px 10px rgba(37,99,235,0.25);
    }

    .maui-button:disabled {
        opacity: 0.6;
    }

    .maui-border {
        border: 1px solid #d0d0d0;
        border-radius: 10px;
        padding: 12px;
        background: #ffffff;
    }

    .maui-frame {
        border-radius: 12px;
        padding: 12px;
        background: #ffffff;
        box-shadow: 0 6px 16px rgba(15,22,33,0.08);
    }

    .maui-boxview {
        min-height: 24px;
    }

    .maui-scrollview {
        max-height: 100%;
        overflow: auto;
    }

    .binding-placeholder {
        font-style: italic;
        color: #64748b;
    }

    .structure-outline {
        border: 1px dashed rgba(148,163,184,0.6);
        border-radius: 6px;
    }
</style>
</head>
<body>
<div class="preview-container">
    <div class="toolbar">
        <div class="zoom-controls">
            <button id="zoomOut" class="zoom-btn" title="Zoom Out">−</button>
            <div id="zoomLevel" class="zoom-level">${this._zoomManager.getCurrentZoom()}%</div>
            <button id="zoomIn" class="zoom-btn" title="Zoom In">+</button>
            <button id="zoomFit" class="zoom-btn" title="Fit to Window">⌂</button>
            <button id="zoomActual" class="zoom-btn" title="Actual Size">1:1</button>
        </div>
        <div class="view-mode-toggle">
            <button class="view-btn ${this._viewMode === 'full' ? 'active' : ''}" data-mode="full" title="Prikaži celotno hierarhijo">Celoten pogled</button>
            <button class="view-btn ${this._viewMode === 'selected' ? 'active' : ''}" data-mode="selected" title="Prikaži samo izbrani element">Izbrani element</button>
        </div>
        ${platformSelector}
    </div>
    <div class="preview-viewport">
        <div class="device-wrapper">
            <div class="device-frame" id="deviceFrame">
                <div class="device-screen">
                    ${statusBarContent ? `<div class="status-bar">${statusBarContent}</div>` : ''}
                    ${navigationBarContent ? `<div class="navigation-bar">${navigationBarContent}</div>` : ''}
                    <div class="content-area">
                        <div class="xaml-root">
                            ${renderedContent}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<script>
    const vscode = acquireVsCodeApi();
    ${platformSwitchScript}
    ${zoomScript}

    let currentViewMode = '${this._viewMode}';

    // Helpers for mapping MAUI-like values to CSS
    const toPx = (v) => {
        if (v == null) return '';
        const s = String(v).trim();
        if (!s) return '';
        // Preserve if looks like CSS unit already
        if (/^(\d+\.?\d*)(px|em|rem|%)$/i.test(s)) return s;
        // number -> px
        if (/^\d+(\.\d+)?$/.test(s)) return s + 'px';
        return s;
    };

    const parseThickness = (val) => {
        if (!val && val !== 0) return '';
        const raw = String(val).trim();
        if (!raw) return '';
        // Allow comma or space separated
        const parts = raw.split(/[ ,]+/).filter(Boolean).map(n => n.trim());
        if (parts.length === 1) {
            const a = toPx(parts[0]);
            return a + ' ' + a + ' ' + a + ' ' + a;
        }
        if (parts.length === 2) {
            // MAUI: h, v -> CSS: top right bottom left = v h v h
            const h = toPx(parts[0]);
            const v = toPx(parts[1]);
            return v + ' ' + h + ' ' + v + ' ' + h;
        }
        if (parts.length === 4) {
            const t = toPx(parts[0]);
            const r = toPx(parts[1]);
            const b = toPx(parts[2]);
            const l = toPx(parts[3]);
            return t + ' ' + r + ' ' + b + ' ' + l;
        }
        // Fallback: join as-is
        return parts.map(toPx).join(' ');
    };

    const parseCornerRadius = (val) => {
        if (!val && val !== 0) return '';
        const raw = String(val).trim();
        if (!raw) return '';
        const parts = raw.split(/[ ,]+/).filter(Boolean).map(n => n.trim());
        if (parts.length === 1) {
            const a = toPx(parts[0]);
            return a;
        }
        if (parts.length === 2) {
            // CSS semantics: tl/br then tr/bl
            const a = toPx(parts[0]);
            const b = toPx(parts[1]);
            return a + ' ' + b;
        }
        if (parts.length === 3) {
            // CSS: tl tr br
            const a = toPx(parts[0]);
            const b = toPx(parts[1]);
            const c = toPx(parts[2]);
            return a + ' ' + b + ' ' + c;
        }
        if (parts.length >= 4) {
            // Assume order tl, tr, br, bl which matches CSS
            const tl = toPx(parts[0]);
            const tr = toPx(parts[1]);
            const br = toPx(parts[2]);
            const bl = toPx(parts[3]);
            return tl + ' ' + tr + ' ' + br + ' ' + bl;
        }
        return '';
    };

    const setViewModeButtons = (mode) => {
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
        });
    };

    const applyViewMode = (mode, selectedId) => {
        currentViewMode = mode || currentViewMode || 'full';
        setViewModeButtons(currentViewMode);

        const root = document.querySelector('.xaml-root');
        if (!root) {
            return;
        }

        const elements = root.querySelectorAll('.maui-element');
        elements.forEach(el => el.classList.remove('hidden-element', 'focused-element', 'ancestor-element'));

        if (currentViewMode !== 'selected' || !selectedId) {
            return;
        }

        elements.forEach(el => el.classList.add('hidden-element'));

        const target = root.querySelector('[data-element-id="' + selectedId + '"]');
        if (!target) {
            elements.forEach(el => el.classList.remove('hidden-element'));
            return;
        }

        target.classList.remove('hidden-element');
        target.classList.add('focused-element');

        target.querySelectorAll('.maui-element').forEach(child => child.classList.remove('hidden-element'));

        let ancestor = target.parentElement ? target.parentElement.closest('.maui-element') : null;
        while (ancestor) {
            ancestor.classList.remove('hidden-element');
            ancestor.classList.add('ancestor-element');
            ancestor = ancestor.parentElement ? ancestor.parentElement.closest('.maui-element') : null;
        }
    };

    const setupViewModeToggle = () => {
        const buttons = document.querySelectorAll('.view-btn');
        if (!buttons.length) {
            return;
        }

        const activeButton = document.querySelector('.view-btn.active');
        if (activeButton) {
            currentViewMode = activeButton.getAttribute('data-mode') || 'full';
        }

        buttons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const mode = btn.getAttribute('data-mode') || 'full';
                if (mode === currentViewMode) {
                    return;
                }
                vscode.postMessage({ command: 'changeViewMode', mode });
            });
        });
    };

    setupViewModeToggle();
    applyViewMode(currentViewMode);

    const notifySelection = (element) => {
        if (!element) return;
        vscode.postMessage({
            command: 'elementSelected',
            elementId: element.getAttribute('data-element-id'),
            line: element.getAttribute('data-line')
        });
    };

    document.addEventListener('click', (event) => {
        const target = event.target.closest('.maui-element');
        if (!target) {
            return;
        }

        document.querySelectorAll('.maui-element.selected').forEach(el => el.classList.remove('selected'));
        target.classList.add('selected');
        applyViewMode(currentViewMode, target.getAttribute('data-element-id'));
        notifySelection(target);
        event.preventDefault();
        event.stopPropagation();
    });

    // Ensure platform buttons work even if inline handler is blocked
    setTimeout(() => {
        document.querySelectorAll('.platform-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pf = btn.getAttribute('data-platform');
                if (pf && typeof window.switchPlatform === 'function') {
                    window.switchPlatform(pf);
                }
            }, { once: false });
        });
    }, 0);

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message) {
            return;
        }

        if (message.type === 'updateZoom' && window.webViewZoomManager) {
            window.webViewZoomManager.setZoom(message.zoom);
        }

        if (message.type === 'fitToViewport' && window.webViewZoomManager) {
            window.webViewZoomManager.fitToViewport();
        }

        if (message.type === 'applyViewMode') {
            applyViewMode(message.mode, message.selectedId);
        }

        if (message.type === 'updateProperty') {
            try {
                const selected = document.querySelector('.maui-element.selected');
                if (selected) {
                    const key = message.property || '';
                    const val = String(message.value ?? '').trim();

                    const setStyle = (k, v) => selected && (selected.style[k] = v);
                    const px = (v) => (/^\d+(\.\d+)?$/.test(v) ? (v + 'px') : v);

                    const kLower = key.toLowerCase();
                    if (kLower === 'background' || kLower.includes('backgroundcolor')) setStyle('backgroundColor', val);
                    else if (kLower.includes('textcolor') || kLower === 'color') setStyle('color', val);
                    else if (kLower === 'widthrequest' || kLower === 'width') setStyle('width', px(val));
                    else if (kLower === 'heightrequest' || kLower === 'height') setStyle('height', px(val));
                    else if (kLower === 'maxwidthrequest' || kLower === 'maxwidth') setStyle('maxWidth', px(val));
                    else if (kLower === 'maxheightrequest' || kLower === 'maxheight') setStyle('maxHeight', px(val));
                    else if (kLower === 'minwidthrequest' || kLower === 'minwidth') setStyle('minWidth', px(val));
                    else if (kLower === 'minheightrequest' || kLower === 'minheight') setStyle('minHeight', px(val));
                    else if (kLower === 'padding') setStyle('padding', parseThickness(val));
                    else if (kLower === 'margin') setStyle('margin', parseThickness(val));
                    else if (kLower === 'cornerradius') setStyle('borderRadius', parseCornerRadius(val));
                    else if (kLower === 'bordercolor' || kLower === 'stroke') setStyle('borderColor', val);
                    else if (kLower === 'borderthickness' || kLower === 'strokethickness') setStyle('borderWidth', parseThickness(val));
                    else if (kLower === 'grid.row') setStyle('gridRowStart', val);
                    else if (kLower === 'grid.column') setStyle('gridColumnStart', val);
                    else if (kLower === 'grid.rowspan') selected.style.gridRowEnd = 'span ' + (parseInt(val, 10) || 1);
                    else if (kLower === 'grid.columnspan') selected.style.gridColumnEnd = 'span ' + (parseInt(val, 10) || 1);
                    else if (kLower === 'opacity') setStyle('opacity', val);
                    else if (kLower === 'isvisible') setStyle('display', (val.toLowerCase() === 'false' || val === '0') ? 'none' : '');
                    else if (kLower === 'isenabled') { setStyle('pointerEvents', (val.toLowerCase() === 'false' || val === '0') ? 'none' : ''); setStyle('opacity', (val.toLowerCase() === 'false' || val === '0') ? '0.6' : ''); }
                    else if (kLower === 'fontsize') setStyle('fontSize', px(val));
                    else if (kLower === 'fontfamily') setStyle('fontFamily', val);
                    else if (kLower === 'lineheight') setStyle('lineHeight', val);
                    else if (kLower === 'characterspacing') setStyle('letterSpacing', px(val));
                    else if (kLower === 'textdecorations') setStyle('textDecoration', val.toLowerCase());
                    else if (kLower === 'fontattributes') {
                        const low = val.toLowerCase();
                        if (low.includes('bold')) setStyle('fontWeight', '600');
                        else setStyle('fontWeight', '');
                        if (low.includes('italic')) setStyle('fontStyle', 'italic');
                        else setStyle('fontStyle', '');
                    }
                    else if (kLower === 'horizontaltextalignment' || kLower === 'textalignment') {
                        const map = { start: 'left', center: 'center', end: 'right' };
                        setStyle('textAlign', map[val.toLowerCase()] || val);
                    }
                    else if (kLower === 'horizontaloptions') {
                        const low = val.toLowerCase();
                        const map = { start: 'flex-start', center: 'center', end: 'flex-end', fill: 'stretch' };
                        setStyle('alignSelf', map[low] || '');
                    }
                    else if (kLower === 'verticaloptions') {
                        const low = val.toLowerCase();
                        const map = { start: 'flex-start', center: 'center', end: 'flex-end', fill: 'stretch' };
                        setStyle('alignSelf', map[low] || '');
                    }
                    else if (kLower === 'aspect') {
                        const map = { aspectfit: 'contain', aspectfill: 'cover', fill: 'fill' };
                        setStyle('objectFit', map[val.toLowerCase()] || 'contain');
                    }

                    if (key === 'Text') {
                        selected.innerText = val;
                    }
                }
            } catch (e) {
                console.warn('[Webview] Failed to apply property update', e);
            }
        }

        if (message.type === 'selectElement') {
            const root = document.querySelector('.xaml-root');
            if (!root) return;
            const target = root.querySelector('[data-element-id="' + message.elementId + '"]');
            if (!target) return;
            document.querySelectorAll('.maui-element.selected').forEach(el => el.classList.remove('selected'));
            target.classList.add('selected');
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            applyViewMode(currentViewMode, message.elementId);
        }
    });

    vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
    }

    private _renderElements(elements: ParsedElement[]): string {
        return elements.map(element => this._renderElement(element)).join('');
    }

    private _renderElement(element: ParsedElement): string {
        const classes = ['maui-element'];
        const typeClass = `maui-${element.type.toLowerCase()}`;
        classes.push(typeClass);

        if (element.type === 'StackLayout') {
            const orientation = (element.resolvedAttributes['Orientation'] || '').toLowerCase();
            if (orientation === 'horizontal') {
                classes.push('is-horizontal');
            }
        }

        const style = this._buildInlineStyle(element);
        const styleAttr = style ? ` style="${style}"` : '';
        const dataId = `data-element-id="${element.id}"`;
        const dataLine = element.metadata.startLine !== undefined ? ` data-line="${element.metadata.startLine}"` : '';
        const titleAttr = ` title="${element.type}${element.name ? ' • ' + element.name : ''}"`;

        const childrenHtml = element.children.map(child => this._renderElement(child)).join('');
        const text = this._renderElementText(element);

        switch (element.type) {
            case 'Label':
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr}>${text}</div>`;
            case 'Button':
                return `<button class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr}>${text || 'Button'}</button>`;
            case 'Entry':
                return `<input class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr} value="${this._escapeHtml(text || '')}" placeholder="Entry" />`;
            case 'Editor':
                return `<textarea class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr}>${this._escapeHtml(text || '')}</textarea>`;
            case 'ScrollView':
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr}><div class="scroll-content">${childrenHtml}</div></div>`;
            case 'Image':
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr}><span class="binding-placeholder">${text || 'Image'}</span></div>`;
            default:
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine}${styleAttr}${titleAttr}>${text}${childrenHtml}</div>`;
        }
    }

    private _renderElementText(element: ParsedElement): string {
        const textValue = element.resolvedAttributes['Text'] ?? element.textContent;
        if (!textValue) {
            return '';
        }

        const bindingMatch = textValue.match(/\{Binding\s+([^}]+)\}/i);
        if (bindingMatch) {
            return `<span class="binding-placeholder">Binding: ${this._escapeHtml(bindingMatch[1])}</span>`;
        }

        return this._escapeHtml(textValue);
    }

    private _buildInlineStyle(element: ParsedElement): string {
        const style = new Map<string, string>();
        const attrs = element.resolvedAttributes;

        const background = attrs['Background'] || attrs['BackgroundColor'];
        const resolvedBackground = this._resolveColor(background);
        if (resolvedBackground) {
            style.set('background-color', resolvedBackground);
        }

        const textColor = this._resolveColor(attrs['TextColor'] || attrs['Color']);
        if (textColor) {
            style.set('color', textColor);
        }

        if (attrs['Opacity']) {
            const opacityValue = Number(attrs['Opacity']);
            if (!Number.isNaN(opacityValue)) {
                style.set('opacity', Math.max(0, Math.min(opacityValue, 1)).toString());
            }
        }

        if (attrs['WidthRequest']) {
            style.set('width', this._toPixels(attrs['WidthRequest']));
        }

        if (attrs['HeightRequest']) {
            style.set('height', this._toPixels(attrs['HeightRequest']));
        }

        if (attrs['MinWidth']) {
            style.set('min-width', this._toPixels(attrs['MinWidth']));
        }

        if (attrs['MinHeight']) {
            style.set('min-height', this._toPixels(attrs['MinHeight']));
        }

        if (attrs['MaxWidth']) {
            style.set('max-width', this._toPixels(attrs['MaxWidth']));
        }

        if (attrs['MaxHeight']) {
            style.set('max-height', this._toPixels(attrs['MaxHeight']));
        }

        if (attrs['Padding']) {
            style.set('padding', this._convertThickness(attrs['Padding']));
        }

        if (attrs['Margin']) {
            style.set('margin', this._convertThickness(attrs['Margin']));
        }

        if (attrs['HorizontalOptions']) {
            this._applyLayoutOptions(style, 'horizontal', attrs['HorizontalOptions']);
        }

        if (attrs['VerticalOptions']) {
            this._applyLayoutOptions(style, 'vertical', attrs['VerticalOptions']);
        }

        if (attrs['FontSize']) {
            style.set('font-size', this._toPixels(attrs['FontSize']));
        }

        if (attrs['FontAttributes']) {
            const fontAttributes = attrs['FontAttributes'].toLowerCase();
            if (fontAttributes.includes('bold')) {
                style.set('font-weight', '600');
            }
            if (fontAttributes.includes('italic')) {
                style.set('font-style', 'italic');
            }
        }

        if (attrs['FontFamily']) {
            style.set('font-family', attrs['FontFamily']);
        }

        if (attrs['HorizontalTextAlignment']) {
            style.set('text-align', attrs['HorizontalTextAlignment'].toLowerCase());
        }

        if (attrs['LineHeight']) {
            style.set('line-height', attrs['LineHeight']);
        }

        if (attrs['Grid.Row']) {
            const rowIndex = Number(attrs['Grid.Row']);
            if (!Number.isNaN(rowIndex)) {
                const span = Number(attrs['Grid.RowSpan'] ?? '1');
                const rowValue = `${rowIndex + 1} / span ${Number.isNaN(span) ? 1 : span}`;
                style.set('grid-row', rowValue);
            }
        }

        if (attrs['Grid.Column']) {
            const colIndex = Number(attrs['Grid.Column']);
            if (!Number.isNaN(colIndex)) {
                const span = Number(attrs['Grid.ColumnSpan'] ?? '1');
                const colValue = `${colIndex + 1} / span ${Number.isNaN(span) ? 1 : span}`;
                style.set('grid-column', colValue);
            }
        }

        switch (element.type) {
            case 'StackLayout': {
                style.set('display', 'flex');
                const orientation = (attrs['Orientation'] || '').toLowerCase();
                style.set('flex-direction', orientation === 'horizontal' ? 'row' : 'column');
                const spacing = attrs['Spacing'];
                if (spacing) {
                    style.set('gap', this._toPixels(spacing));
                }
                break;
            }
            case 'Grid': {
                style.set('display', 'grid');
                const columns = element.metadata.gridColumns && element.metadata.gridColumns.length
                    ? element.metadata.gridColumns.map(g => this._convertGridLength(g)).join(' ')
                    : '1fr';
                const rows = element.metadata.gridRows && element.metadata.gridRows.length
                    ? element.metadata.gridRows.map(g => this._convertGridLength(g)).join(' ')
                    : 'auto';
                style.set('grid-template-columns', columns);
                style.set('grid-template-rows', rows);
                if (attrs['ColumnSpacing']) {
                    style.set('column-gap', this._toPixels(attrs['ColumnSpacing']));
                }
                if (attrs['RowSpacing']) {
                    style.set('row-gap', this._toPixels(attrs['RowSpacing']));
                }
                break;
            }
            case 'Border':
            case 'Frame': {
                const stroke = this._resolveColor(attrs['Stroke'] || attrs['BorderColor']);
                const strokeThickness = this._toPixels(attrs['StrokeThickness'] || '1');
                style.set('border-style', 'solid');
                style.set('border-width', stroke ? strokeThickness : '1px');
                style.set('border-color', stroke || 'rgba(0,0,0,0.12)');
                const radius = element.metadata.cornerRadius || attrs['CornerRadius'];
                if (radius) {
                    style.set('border-radius', this._convertCornerRadius(radius));
                } else if (element.type === 'Frame') {
                    style.set('border-radius', '12px');
                }
                break;
            }
            case 'BoxView': {
                style.set('min-height', this._toPixels(attrs['HeightRequest'] || '36'));
                style.set('border-radius', this._convertCornerRadius(attrs['CornerRadius'] || '0'));
                break;
            }
            case 'Button': {
                if (!style.has('background-color')) {
                    style.set('background-color', '#2563eb');
                }
                if (!style.has('color')) {
                    style.set('color', '#ffffff');
                }
                style.set('display', 'inline-flex');
                style.set('align-items', 'center');
                style.set('justify-content', 'center');
                break;
            }
            case 'ScrollView': {
                style.set('overflow', 'auto');
                break;
            }
            case 'Label': {
                style.set('display', 'block');
                break;
            }
        }

        return Array.from(style.entries()).map(([key, value]) => `${key}: ${value}`).join('; ');
    }

    private _resolveColor(raw?: string, visited: Set<string> = new Set()): string | undefined {
        if (!raw) {
            return undefined;
        }

        let value = raw.trim();
        if (!value) {
            return undefined;
        }

        const appThemeMatch = value.match(/\{AppThemeBinding\s+Light=([^,}]+)(?:,\s*Dark=([^}]+))?/i);
        if (appThemeMatch) {
            const lightCandidate = appThemeMatch[1] ? appThemeMatch[1].trim() : undefined;
            if (lightCandidate) {
                const resolved = this._resolveColor(lightCandidate, visited);
                if (resolved) {
                    return resolved;
                }
            }
            const darkCandidate = appThemeMatch[2] ? appThemeMatch[2].trim() : undefined;
            if (darkCandidate) {
                const resolvedDark = this._resolveColor(darkCandidate, visited);
                if (resolvedDark) {
                    return resolvedDark;
                }
            }
        }

        const resourceKey = this._extractResourceKey(value);
        if (resourceKey && !visited.has(resourceKey)) {
            visited.add(resourceKey);
            const resourceValue = this._resourceManager.resolveStaticResource(resourceKey, this._resources);
            if (resourceValue) {
                const resolved = this._resolveColor(resourceValue, visited);
                if (resolved) {
                    return resolved;
                }
            }
            const themeColor = this._themeColors.get(resourceKey);
            if (themeColor) {
                return themeColor;
            }
        }

        value = this._normalizeColorValue(value);
        if (!value) {
            return undefined;
        }

        if (value.startsWith('#') && (value.length === 4 || value.length === 5 || value.length === 7 || value.length === 9)) {
            return value;
        }

        if (/^(rgb|rgba|hsl|hsla)\(/i.test(value)) {
            return value;
        }

        const lower = value.toLowerCase();
        if (COLOR_NAME_MAP[lower]) {
            return COLOR_NAME_MAP[lower];
        }

        if (this._themeColors.has(value)) {
            return this._themeColors.get(value);
        }

        return undefined;
    }

    private _normalizeColorValue(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) {
            return trimmed;
        }

        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            if (trimmed.includes('"')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    const candidate = this._findColorInParsedValue(parsed);
                    if (candidate) {
                        return candidate;
                    }
                } catch (error) {
                    // ignore JSON parse errors and fall back to trimmed string
                }
            }
        }

        if (/^Color\s+/i.test(trimmed)) {
            return trimmed.replace(/^Color\s+/i, '');
        }

        return trimmed;
    }

    private _findColorInParsedValue(value: any): string | undefined {
        if (!value) {
            return undefined;
        }

        if (typeof value === 'string') {
            return value;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const result = this._findColorInParsedValue(item);
                if (result) {
                    return result;
                }
            }
            return undefined;
        }

        if (typeof value === 'object') {
            const directKeys = ['@_Color', 'Color', '#text', '@_Light', 'Light', '@_Value', 'Value'];
            for (const key of directKeys) {
                const candidate = (value as Record<string, unknown>)[key];
                if (typeof candidate === 'string' && candidate.trim()) {
                    return candidate;
                }
            }

            for (const key of Object.keys(value)) {
                const result = this._findColorInParsedValue((value as Record<string, unknown>)[key]);
                if (result) {
                    return result;
                }
            }
        }

        return undefined;
    }

    private _applyLayoutOptions(style: Map<string, string>, axis: 'horizontal' | 'vertical', option: string) {
        const normalized = option.toLowerCase();
        if (axis === 'horizontal') {
            if (normalized === 'center') {
                style.set('margin-left', 'auto');
                style.set('margin-right', 'auto');
            } else if (normalized === 'end') {
                style.set('margin-left', 'auto');
            } else if (normalized === 'start') {
                style.set('margin-right', 'auto');
            } else if (normalized === 'fill' || normalized === 'fillandexpand') {
                style.set('width', '100%');
            }
        } else {
            if (normalized === 'center') {
                style.set('align-self', 'center');
            } else if (normalized === 'end') {
                style.set('align-self', 'flex-end');
            } else if (normalized === 'start') {
                style.set('align-self', 'flex-start');
            } else if (normalized === 'fill' || normalized === 'fillandexpand') {
                style.set('align-self', 'stretch');
            }
        }
    }

    private _convertThickness(value: string): string {
        const parts = value.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) {
            return '0px';
        }
        if (parts.length === 1) {
            const px = this._toPixels(parts[0]);
            return `${px}`;
        }
        if (parts.length === 2) {
            const vertical = this._toPixels(parts[0]);
            const horizontal = this._toPixels(parts[1]);
            return `${vertical} ${horizontal}`;
        }
        if (parts.length === 3) {
            const top = this._toPixels(parts[0]);
            const horizontal = this._toPixels(parts[1]);
            const bottom = this._toPixels(parts[2]);
            return `${top} ${horizontal} ${bottom}`;
        }
        const top = this._toPixels(parts[0]);
        const right = this._toPixels(parts[1]);
        const bottom = this._toPixels(parts[2]);
        const left = this._toPixels(parts[3]);
        return `${top} ${right} ${bottom} ${left}`;
    }

    private _convertCornerRadius(value: string): string {
        if (!value) {
            return '0px';
        }
        return this._convertThickness(value);
    }

    private _convertGridLength(value: string): string {
        if (!value) {
            return '1fr';
        }
        const trimmed = value.trim();
        if (!trimmed || trimmed === '*') {
            return '1fr';
        }
        if (trimmed.toLowerCase() === 'auto') {
            return 'auto';
        }
        if (trimmed.endsWith('*')) {
            const factor = parseFloat(trimmed.slice(0, -1));
            return `${Number.isNaN(factor) ? 1 : factor}fr`;
        }
        const numeric = parseFloat(trimmed);
        if (!Number.isNaN(numeric)) {
            return `${numeric}px`;
        }
        return trimmed;
    }

    private _toPixels(value: string): string {
        if (!value) {
            return '0px';
        }
        const normalized = value.trim();
        if (normalized.endsWith('px') || normalized.endsWith('%')) {
            return normalized;
        }
        const numeric = parseFloat(normalized);
        if (!Number.isNaN(numeric)) {
            return `${numeric}px`;
        }
        return normalized;
    }

    private _escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private _convertParsedToXamlElements(elements: ParsedElement[]): XamlElement[] {
        return elements.map(element => this._convertParsedElement(element));
    }

    private _convertParsedElement(element: ParsedElement): XamlElement {
        const properties = this._buildElementProperties(element);
        return {
            id: element.id,
            type: element.type,
            name: element.name || element.type,
            properties,
            children: element.children.map(child => this._convertParsedElement(child))
        };
    }

    private _buildElementProperties(element: ParsedElement): ElementProperty[] {
        const properties: ElementProperty[] = [];
        const entries = Object.entries(element.resolvedAttributes);
        for (const [key, value] of entries) {
            if (!value) {
                continue;
            }
            const normalizedValue = this._normalizePropertyValue(key, value);
            properties.push({
                key,
                value: normalizedValue,
                type: this._determinePropertyType(key, normalizedValue),
                section: this._getPropertySection(key),
                elementType: element.type
            });
        }

        properties.push({
            key: 'Type',
            value: element.type,
            type: 'string',
            section: 'structure'
        });

        if (element.name) {
            properties.push({
                key: 'Name',
                value: element.name,
                type: 'string',
                section: 'structure'
            });
        }

        if (element.textContent) {
            properties.push({
                key: 'Text',
                value: element.textContent,
                type: 'string',
                section: 'appearance'
            });
        }

        return properties;
    }

    private _normalizePropertyValue(key: string, value: string): string {
        if (!value) {
            return value;
        }
        if (key.toLowerCase().includes('color')) {
            return this._resolveColor(value) ?? value;
        }
        return value;
    }

    private _determinePropertyType(key: string, value: string): ElementProperty['type'] {
        const lowerKey = key.toLowerCase();
        const lowerValue = value.toLowerCase();
        if (lowerKey.includes('color') || lowerValue.startsWith('#') || lowerValue.startsWith('rgb')) {
            return 'color';
        }
        if (lowerValue === 'true' || lowerValue === 'false') {
            return 'boolean';
        }
        if (!Number.isNaN(Number(value))) {
            return 'number';
        }
        return 'string';
    }

    private _getPropertySection(propertyName: string): 'appearance' | 'layout' | 'structure' {
        const lower = propertyName.toLowerCase();
        const layoutProps = ['margin', 'padding', 'width', 'widthrequest', 'height', 'heightrequest', 'horizontaloptions', 'verticaloptions', 'grid.row', 'grid.column', 'grid.rowspan', 'grid.columnspan'];
        const appearanceProps = ['background', 'backgroundcolor', 'textcolor', 'color', 'font', 'opacity', 'corner', 'border', 'stroke'];

        if (layoutProps.some(prop => lower.includes(prop))) {
            return 'layout';
        }
        if (appearanceProps.some(prop => lower.includes(prop))) {
            return 'appearance';
        }
        return 'structure';
    }

    private _showErrorMessage(message: string) {
        if (!this._currentPanel) {
            return;
        }

        this._currentPanel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>MAUI XAML Preview - Error</title>
<style>
    body {
        font-family: Segoe UI, sans-serif;
        background: #f6f8fa;
        color: #b91c1c;
        padding: 24px;
    }
    .error {
        background: #fff;
        border-left: 4px solid #dc2626;
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
</style>
</head>
<body>
<div class="error">
    <h2>⚠️ Napaka pri generiranju predogleda</h2>
    <p>${this._escapeHtml(message)}</p>
</div>
</body>
</html>`;
    }

    private _nextElementId(): string {
        return `element_${this._elementIdCounter++}`;
    }
}
