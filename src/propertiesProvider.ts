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

export class MauiPropertiesProvider implements vscode.TreeDataProvider<PropertyTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PropertyTreeItem | undefined | null | void> = new vscode.EventEmitter<PropertyTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PropertyTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _selectedElement: XamlElement | undefined;
    private _elements: XamlElement[] = [];
    private _extensionUri: vscode.Uri;
    private _showAllFlat: boolean = true;
    private _extraPropertySuggestions: string[] = [
        'Text', 'TextColor', 'BackgroundColor', 'FontSize', 'FontAttributes', 'FontFamily', 'LineHeight', 'CharacterSpacing', 'TextDecorations',
        'WidthRequest', 'HeightRequest', 'MinWidthRequest', 'MinHeightRequest', 'MaxWidthRequest', 'MaxHeightRequest',
        'Margin', 'Padding', 'CornerRadius', 'BorderColor', 'BorderThickness', 'Stroke', 'StrokeThickness', 'Opacity', 'IsVisible', 'IsEnabled',
        'HorizontalOptions', 'VerticalOptions', 'HorizontalTextAlignment', 'TextAlignment', 'Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan',
        'Style', 'ClassId'
    ];

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
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
        this.refresh();
    }

    getTreeItem(element: PropertyTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PropertyTreeItem): Thenable<PropertyTreeItem[]> {
        if (!element) {
            // Root items: Properties (flat list) and Structure
            return Promise.resolve([
                new PropertyTreeItem(
                    'Lastnosti',
                    'section-props',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'fas fa-cog'
                ),
                new PropertyTreeItem(
                    'Struktura Elementov',
                    'section',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'fas fa-sitemap',
                    undefined,
                    undefined,
                    'structure'
                )
            ]);
        }

        if (element.contextValue === 'section') {
            // Tree structure elements
            return Promise.resolve(this._getStructureItems());
        }

        if (element.contextValue === 'section-props') {
            // Flat properties list with an Add Property action at top
            const items: PropertyTreeItem[] = [];
            if (!this._selectedElement) {
                items.push(new PropertyTreeItem('Ni izbranega elementa', 'info', vscode.TreeItemCollapsibleState.None, 'fas fa-info-circle'));
                return Promise.resolve(items);
            }

            // Add property action
            const addItem = new PropertyTreeItem('+ Dodaj lastnost…', 'add-property', vscode.TreeItemCollapsibleState.None, 'fas fa-plus');
            addItem.command = {
                command: 'mauiProperties.addProperty',
                title: 'Dodaj lastnost',
                arguments: [this._selectedElement]
            };
            items.push(addItem);

            // Show all current properties as editable rows
            for (const prop of this._selectedElement.properties) {
                const item = new PropertyTreeItem(
                    `${prop.key}: ${prop.value}`,
                    'property',
                    vscode.TreeItemCollapsibleState.None,
                    this._getPropertyIcon(prop.type),
                    undefined,
                    prop
                );
                item.command = {
                    command: 'mauiProperties.editProperty',
                    title: 'Uredi lastnost',
                    arguments: [prop]
                };
                items.push(item);
            }

            return Promise.resolve(items);
        }

        if (element.contextValue === 'element') {
            // Children of element in structure
            const xamlElement = this._findElementById(element.elementId!);
            if (xamlElement && xamlElement.children) {
                return Promise.resolve(
                    xamlElement.children.map(child =>
                        new PropertyTreeItem(
                            child.name || child.type,
                            'element',
                            child.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                            this._getElementIcon(child.type),
                            child.id
                        )
                    )
                );
            }
        }

        return Promise.resolve([]);
    }

    private _getStructureItems(): PropertyTreeItem[] {
        return this._elements.map(element =>
            new PropertyTreeItem(
                element.name || element.type,
                'element',
                element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
                this._getElementIcon(element.type),
                element.id
            )
        );
    }

    private _getPropertiesForSection(section: string): PropertyTreeItem[] {
        if (!this._selectedElement) {
            return [
                new PropertyTreeItem(
                    'Ni izbranega elementa',
                    'info',
                    vscode.TreeItemCollapsibleState.None,
                    'fas fa-info-circle'
                )
            ];
        }

        const sectionProperties = this._selectedElement.properties.filter(prop => prop.section === section);

        return sectionProperties.map(prop => {
            const item = new PropertyTreeItem(
                `${prop.key}: ${prop.value}`,
                'property',
                vscode.TreeItemCollapsibleState.None,
                this._getPropertyIcon(prop.type),
                undefined,
                prop
            );

            // Add click command for editing
            item.command = {
                command: 'mauiProperties.editProperty',
                title: 'Edit Property',
                arguments: [prop]
            };

            return item;
        });
    }

    private _findElementById(id: string): XamlElement | undefined {
        const findElement = (elements: XamlElement[]): XamlElement | undefined => {
            for (const element of elements) {
                if (element.id === id) {
                    return element;
                }
                const found = findElement(element.children);
                if (found) {
                    return found;
                }
            }
            return undefined;
        };

        return findElement(this._elements);
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
            'Border': 'fas fa-border-style'
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
}

export class PropertyTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly contextValue: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly iconClass?: string,
        public readonly elementId?: string,
        public readonly property?: ElementProperty,
        public readonly sectionType?: string
    ) {
        super(label, collapsibleState);

        this.tooltip = this.label;
        this.contextValue = contextValue;

        if (contextValue === 'section') {
            this.sectionType = sectionType || (label.toLowerCase().includes('videz') ? 'appearance' :
                label.toLowerCase().includes('postavitev') ? 'layout' : 'structure');
        }

        // VS Code doesn't support Font Awesome directly, so we'll use built-in icons
        if (iconClass) {
            this.iconPath = this._getVSCodeIcon(iconClass);
        }
    }

    private _getVSCodeIcon(iconClass: string): vscode.ThemeIcon {
        // Map Font Awesome icons to VS Code theme icons
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
            'fas fa-info-circle': 'info'
        };

        return new vscode.ThemeIcon(iconMap[iconClass] || 'symbol-misc');
    }
}