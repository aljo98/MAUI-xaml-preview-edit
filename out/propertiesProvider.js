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
exports.PropertyTreeItem = exports.MauiPropertiesProvider = void 0;
const vscode = __importStar(require("vscode"));
class MauiPropertiesProvider {
    constructor(extensionUri, mode = 'combined') {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._elements = [];
        this._templates = [];
        this._showAllFlat = true;
        this._itemCache = new Map();
        this._extraPropertySuggestions = [
            'Text', 'TextColor', 'BackgroundColor', 'FontSize', 'FontAttributes', 'FontFamily', 'LineHeight', 'CharacterSpacing', 'TextDecorations',
            'WidthRequest', 'HeightRequest', 'MinWidthRequest', 'MinHeightRequest', 'MaxWidthRequest', 'MaxHeightRequest',
            'Margin', 'Padding', 'CornerRadius', 'BorderColor', 'BorderThickness', 'Stroke', 'StrokeThickness', 'Opacity', 'IsVisible', 'IsEnabled',
            'HorizontalOptions', 'VerticalOptions', 'HorizontalTextAlignment', 'TextAlignment', 'Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan',
            'Style', 'ClassId'
        ];
        this._mode = 'combined';
        this._extensionUri = extensionUri;
        this._mode = mode;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    setSelectedElement(element) {
        this._selectedElement = element;
        this.refresh();
    }
    setElements(elements) {
        this._elements = elements;
        // rebuild cache so reveal() can find items immediately
        this._itemCache.clear();
        this._indexElements(elements);
        this.refresh();
    }
    setTemplates(templates) {
        this._templates = templates || [];
        this.refresh();
    }
    setMode(mode) {
        this._mode = mode;
        this.refresh();
    }
    // Allow external reveal to access the cached tree item
    getTreeItemById(id) {
        return this._itemCache.get(id);
    }
    getTreeItem(element) { return element; }
    getChildren(element) {
        // MODED ROOT
        if (!element) {
            if (this._mode === 'props') {
                return this._getPropsRoot();
            }
            if (this._mode === 'templates') {
                return this._getTemplatesRoot();
            }
            if (this._mode === 'structure') {
                return Promise.resolve(this._getStructureItems());
            }
            // combined (backward compatible)
            return Promise.resolve([
                new PropertyTreeItem('Lastnosti izbranega elementa', 'section-props', vscode.TreeItemCollapsibleState.Expanded, 'fas fa-cog'),
                new PropertyTreeItem('Template primeri', 'section-templates', vscode.TreeItemCollapsibleState.Collapsed, 'fas fa-list'),
                new PropertyTreeItem('Struktura Elementov', 'section', vscode.TreeItemCollapsibleState.Expanded, 'fas fa-sitemap', undefined, undefined, 'structure')
            ]);
        }
        // Combined mode sections handling remains
        if (element.contextValue === 'section-templates') {
            return this._getTemplatesRoot();
        }
        if (element.contextValue === 'section') {
            return Promise.resolve(this._getStructureItems());
        }
        if (element.contextValue === 'section-props') {
            return this._getPropsRoot();
        }
        if (element.contextValue === 'element') {
            const xamlElement = this._findElementById(element.elementId);
            if (xamlElement && xamlElement.children) {
                return Promise.resolve(xamlElement.children.map(child => this._getOrCreateStructureItem(child)));
            }
        }
        return Promise.resolve([]);
    }
    _getPropsRoot() {
        const items = [];
        if (!this._selectedElement) {
            items.push(new PropertyTreeItem('Ni izbranega elementa', 'info', vscode.TreeItemCollapsibleState.None, 'fas fa-info-circle'));
            return Promise.resolve(items);
        }
        const addItem = new PropertyTreeItem('+ Dodaj lastnost…', 'add-property', vscode.TreeItemCollapsibleState.None, 'fas fa-plus');
        addItem.command = { command: 'mauiProperties.addProperty', title: 'Dodaj lastnost', arguments: [this._selectedElement] };
        items.push(addItem);
        for (const prop of this._selectedElement.properties) {
            const item = new PropertyTreeItem(`${prop.key}: ${prop.value}`, 'property', vscode.TreeItemCollapsibleState.None, this._getPropertyIcon(prop.type), undefined, prop);
            item.command = { command: 'mauiProperties.editProperty', title: 'Uredi lastnost', arguments: [prop] };
            items.push(item);
        }
        return Promise.resolve(items);
    }
    _getTemplatesRoot() {
        const items = [];
        if (!this._templates.length) {
            items.push(new PropertyTreeItem('Ni definiranih template-ov', 'info', vscode.TreeItemCollapsibleState.None, 'fas fa-info-circle'));
            return Promise.resolve(items);
        }
        for (const tpl of this._templates) {
            const item = new PropertyTreeItem(tpl.name, 'template', vscode.TreeItemCollapsibleState.None, 'fas fa-square', tpl.id);
            item.description = tpl.description || tpl.category;
            item.command = { command: 'mauiTemplates.insertTemplate', title: 'Vstavi template', arguments: [tpl] };
            items.push(item);
        }
        return Promise.resolve(items);
    }
    _indexElements(elements) {
        const walk = (el) => {
            this._getOrCreateStructureItem(el);
            el.children.forEach(walk);
        };
        elements.forEach(walk);
    }
    _getOrCreateStructureItem(el) {
        let item = this._itemCache.get(el.id);
        if (!item) {
            item = new PropertyTreeItem(el.name || el.type, 'element', el.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, this._getElementIcon(el.type), el.id);
            item.command = { command: 'mauiDesigner.selectElementById', title: 'Izberi element', arguments: [el.id] };
            this._itemCache.set(el.id, item);
        }
        else {
            item.label = el.name || el.type;
            item.collapsibleState = el.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
            item.iconPath = this._getVSCodeIcon(this._getElementIcon(el.type));
        }
        return item;
    }
    _getStructureItems() {
        return this._elements.map(el => this._getOrCreateStructureItem(el));
    }
    _getPropertiesForSection(section) {
        if (!this._selectedElement) {
            return [new PropertyTreeItem('Ni izbranega elementa', 'info', vscode.TreeItemCollapsibleState.None, 'fas fa-info-circle')];
        }
        const sectionProperties = this._selectedElement.properties.filter(prop => prop.section === section);
        return sectionProperties.map(prop => {
            const item = new PropertyTreeItem(`${prop.key}: ${prop.value}`, 'property', vscode.TreeItemCollapsibleState.None, this._getPropertyIcon(prop.type), undefined, prop);
            item.command = { command: 'mauiProperties.editProperty', title: 'Edit Property', arguments: [prop] };
            return item;
        });
    }
    _findElementById(id) {
        const find = (arr) => {
            for (const e of arr) {
                if (e.id === id)
                    return e;
                const f = find(e.children);
                if (f)
                    return f;
            }
            return undefined;
        };
        return find(this._elements);
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
            'Border': 'fas fa-border-style',
            'BoxView': 'fas fa-square'
        };
        return iconMap[elementType] || 'fas fa-cube';
    }
    _getPropertyIcon(propertyType) {
        const iconMap = {
            'string': 'fas fa-font',
            'number': 'fas fa-hashtag',
            'color': 'fas fa-palette',
            'boolean': 'fas fa-toggle-on',
            'select': 'fas fa-list'
        };
        return iconMap[propertyType] || 'fas fa-cog';
    }
    _getVSCodeIcon(iconClass) {
        const iconMap = {
            'fas fa-palette': 'symbol-color',
            'fas fa-ruler-combined': 'symbol-ruler',
            'fas fa-sitemap': 'type-hierarchy',
            'fas fa-file': 'file',
            'fas fa-align-justify': 'list-flat',
            'fas fa-th': 'table',
            'fas fa-font': 'symbol-string',
            'fas fa-hand-pointer': 'hand',
            'fas fa-keyboard': 'symbol-key',
            'fas fa-image': 'file-media',
            'fas fa-square': 'symbol-structure',
            'fas fa-border-style': 'border',
            'fas fa-cube': 'symbol-misc',
            'fas fa-hashtag': 'symbol-number',
            'fas fa-toggle-on': 'symbol-boolean',
            'fas fa-list': 'list-selection',
            'fas fa-cog': 'gear',
            'fas fa-info-circle': 'info',
            'fas fa-plus': 'add'
        };
        return new vscode.ThemeIcon(iconMap[iconClass] || 'symbol-misc');
    }
}
exports.MauiPropertiesProvider = MauiPropertiesProvider;
class PropertyTreeItem extends vscode.TreeItem {
    constructor(label, contextValue, collapsibleState, iconClass, elementId, property, sectionType) {
        super(label, collapsibleState);
        this.label = label;
        this.contextValue = contextValue;
        this.collapsibleState = collapsibleState;
        this.iconClass = iconClass;
        this.elementId = elementId;
        this.property = property;
        this.sectionType = sectionType;
        this.tooltip = this.label;
        this.contextValue = contextValue;
        if (iconClass) {
            this.iconPath = this._getVSCodeIcon(iconClass);
        }
    }
    _getVSCodeIcon(iconClass) {
        const iconMap = {
            'fas fa-palette': 'symbol-color',
            'fas fa-ruler-combined': 'symbol-ruler',
            'fas fa-sitemap': 'type-hierarchy',
            'fas fa-file': 'file',
            'fas fa-align-justify': 'list-flat',
            'fas fa-th': 'table',
            'fas fa-font': 'symbol-string',
            'fas fa-hand-pointer': 'hand',
            'fas fa-keyboard': 'symbol-key',
            'fas fa-image': 'file-media',
            'fas fa-square': 'symbol-structure',
            'fas fa-border-style': 'border',
            'fas fa-cube': 'symbol-misc',
            'fas fa-hashtag': 'symbol-number',
            'fas fa-toggle-on': 'symbol-boolean',
            'fas fa-list': 'list-selection',
            'fas fa-cog': 'gear',
            'fas fa-info-circle': 'info',
            'fas fa-plus': 'add'
        };
        return new vscode.ThemeIcon(iconMap[iconClass] || 'symbol-misc');
    }
}
exports.PropertyTreeItem = PropertyTreeItem;
//# sourceMappingURL=propertiesProvider.js.map