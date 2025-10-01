import * as vscode from 'vscode';

export interface ElementProperty {
    key: string;
    value: string;
    type: 'string' | 'number' | 'color' | 'boolean' | 'select';
    options?: string[];
    section: 'appearance' | 'layout' | 'structure';
    elementType?: string;
}

export interface XamlElement {
    id: string;
    type: string;
    name: string;
    properties: ElementProperty[];
    children: XamlElement[];
    parent?: XamlElement;
}

export interface TemplateItem {
    id: string;
    name: string;
    description?: string;
    category?: string;
    xaml: string;
}

export class MauiPropertiesProvider implements vscode.TreeDataProvider<PropertyTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PropertyTreeItem | undefined | null | void> = new vscode.EventEmitter<PropertyTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PropertyTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _selectedElement: XamlElement | undefined;
    private _elements: XamlElement[] = [];
    private _templates: TemplateItem[] = [];
    private _extensionUri: vscode.Uri;
    private _showAllFlat: boolean = true;
    private _itemCache: Map<string, PropertyTreeItem> = new Map();
    private _extraPropertySuggestions: string[] = [
        'Text', 'TextColor', 'BackgroundColor', 'FontSize', 'FontAttributes', 'FontFamily', 'LineHeight', 'CharacterSpacing', 'TextDecorations',
        'WidthRequest', 'HeightRequest', 'MinWidthRequest', 'MinHeightRequest', 'MaxWidthRequest', 'MaxHeightRequest',
        'Margin', 'Padding', 'CornerRadius', 'BorderColor', 'BorderThickness', 'Stroke', 'StrokeThickness', 'Opacity', 'IsVisible', 'IsEnabled',
        'HorizontalOptions', 'VerticalOptions', 'HorizontalTextAlignment', 'TextAlignment', 'Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan',
        'Style', 'ClassId'
    ];

    private _mode: 'combined' | 'props' | 'templates' | 'structure' = 'combined';

    constructor(extensionUri: vscode.Uri, mode: 'combined' | 'props' | 'templates' | 'structure' = 'combined') {
        this._extensionUri = extensionUri;
        this._mode = mode;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setSelectedElement(element: XamlElement | undefined): void {
        this._selectedElement = element;
        this.refresh();
    }

    setElements(elements: XamlElement[]): void {
        this._elements = elements;
        // rebuild cache so reveal() can find items immediately
        this._itemCache.clear();
        this._indexElements(elements);
        this.refresh();
    }

    setTemplates(templates: TemplateItem[]): void {
        this._templates = templates || [];
        this.refresh();
    }

    public setMode(mode: 'combined' | 'props' | 'templates' | 'structure') {
        this._mode = mode;
        this.refresh();
    }

    // Allow external reveal to access the cached tree item
    public getTreeItemById(id: string): PropertyTreeItem | undefined {
        return this._itemCache.get(id);
    }

    getTreeItem(element: PropertyTreeItem): vscode.TreeItem { return element; }

    getChildren(element?: PropertyTreeItem): Thenable<PropertyTreeItem[]> {
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
            const xamlElement = this._findElementById(element.elementId!);
            if (xamlElement && xamlElement.children) {
                return Promise.resolve(
                    xamlElement.children.map(child => this._getOrCreateStructureItem(child))
                );
            }
        }

        return Promise.resolve([]);
    }

    private _getPropsRoot(): Thenable<PropertyTreeItem[]> {
        const items: PropertyTreeItem[] = [];
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

    private _getTemplatesRoot(): Thenable<PropertyTreeItem[]> {
        const items: PropertyTreeItem[] = [];
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

    private _indexElements(elements: XamlElement[]) {
        const walk = (el: XamlElement) => {
            this._getOrCreateStructureItem(el);
            el.children.forEach(walk);
        };
        elements.forEach(walk);
    }

    private _getOrCreateStructureItem(el: XamlElement): PropertyTreeItem {
        let item = this._itemCache.get(el.id);
        if (!item) {
            item = new PropertyTreeItem(
                el.name || el.type,
                'element',
                el.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                this._getElementIcon(el.type),
                el.id
            );
            item.command = { command: 'mauiDesigner.selectElementById', title: 'Izberi element', arguments: [el.id] };
            this._itemCache.set(el.id, item);
        } else {
            item.label = el.name || el.type;
            item.collapsibleState = el.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
            item.iconPath = this._getVSCodeIcon(this._getElementIcon(el.type));
        }
        return item;
    }

    private _getStructureItems(): PropertyTreeItem[] {
        return this._elements.map(el => this._getOrCreateStructureItem(el));
    }

    private _getPropertiesForSection(section: string): PropertyTreeItem[] {
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

    private _findElementById(id: string): XamlElement | undefined {
        const find = (arr: XamlElement[]): XamlElement | undefined => {
            for (const e of arr) {
                if (e.id === id) return e;
                const f = find(e.children);
                if (f) return f;
            }
            return undefined;
        };
        return find(this._elements);
    }

    private _getElementIcon(elementType: string): string {
        const iconMap: { [key: string]: string } = {
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

    private _getPropertyIcon(propertyType: string): string {
        const iconMap: { [key: string]: string } = {
            'string': 'fas fa-font',
            'number': 'fas fa-hashtag',
            'color': 'fas fa-palette',
            'boolean': 'fas fa-toggle-on',
            'select': 'fas fa-list'
        };
        return iconMap[propertyType] || 'fas fa-cog';
    }

    private _getVSCodeIcon(iconClass: string): vscode.ThemeIcon {
        const iconMap: { [key: string]: string } = {
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

export class PropertyTreeItem extends vscode.TreeItem {
    constructor(
        public label: string,
        public readonly contextValue: string,
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly iconClass?: string,
        public readonly elementId?: string,
        public readonly property?: ElementProperty,
        public readonly sectionType?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;
        this.contextValue = contextValue;
        if (iconClass) {
            this.iconPath = this._getVSCodeIcon(iconClass);
        }
    }

    private _getVSCodeIcon(iconClass: string): vscode.ThemeIcon {
        const iconMap: { [key: string]: string } = {
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