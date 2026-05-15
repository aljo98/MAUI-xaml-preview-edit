import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a parsed C# property
 */
export interface CSharpProperty {
    name: string;
    type: string;
    isCommand: boolean;
    description?: string;
    defaultValue?: string;
}

/**
 * Represents a parsed C# command
 */
export interface CSharpCommand {
    name: string;
    type: string;  // ICommand, ReactiveCommand, etc.
    methodName?: string;
    canExecute?: string;
    parameters?: string[];
}

/**
 * Represents a parsed C# class with its properties
 */
export interface CSharpClass {
    name: string;
    namespace: string;
    baseClasses: string[];
    properties: CSharpProperty[];
    commands: CSharpCommand[];
    fields: Array<{ name: string; type: string; isReadOnly: boolean }>;
    methods: Array<{ name: string; parameters: string[]; returnType: string }>;
}

/**
 * Represents a ViewModel with all its parsed information
 */
export interface ViewModelInfo {
    className: string;
    namespace: string;
    filePath: string;
    dataType: string;  // The generic type parameter (e.g., "SalesOrderDto")
    properties: CSharpProperty[];
    commands: CSharpCommand[];
    filterDefinitions: CSharpProperty[];  // Properties from DefineFilters()
    tableColumns: CSharpProperty[];  // Properties from DefineColumns()
    toolbarActions: CSharpProperty[];  // Properties from DefineActions()
    baseProperties: CSharpProperty[];  // Properties inherited from base classes
}

export class CSharpParser {

    // ─────────────────────────────────────────────────────────────────────────
    // KNOWN BASE VIEWMODEL PROPERTIES (for Floworks project)
    // These are inherited from ViewModelBase → ModuleListViewModel → StandardTableViewModel
    // ─────────────────────────────────────────────────────────────────────────
    private static readonly BASE_VIEWMODEL_PROPERTIES: CSharpProperty[] = [
        // From ModuleListViewModel<T>
        { name: 'Items', type: 'ObservableCollection<T>', isCommand: false, description: 'All data items' },
        { name: 'FilteredItems', type: 'ObservableCollection<T>', isCommand: false, description: 'Filtered data items' },
        { name: 'SelectedItem', type: 'T', isCommand: false, description: 'Currently selected item' },
        { name: 'HasSelection', type: 'bool', isCommand: false, description: 'True if item selected' },
        { name: 'SearchText', type: 'string', isCommand: false, description: 'Search text' },
        { name: 'IsLoading', type: 'bool', isCommand: false, description: 'Loading state' },
        { name: 'CurrentPage', type: 'int', isCommand: false, description: 'Current page' },
        { name: 'PageSize', type: 'int', isCommand: false, description: 'Items per page' },
        { name: 'TotalRecords', type: 'int', isCommand: false, description: 'Total record count' },
        { name: 'TotalPages', type: 'int', isCommand: false, description: 'Total pages' },
        { name: 'PageInfo', type: 'string', isCommand: false, description: 'Page info text' },
        { name: 'CanGoNextPage', type: 'bool', isCommand: false },
        { name: 'CanGoPreviousPage', type: 'bool', isCommand: false },
        { name: 'IsEmpty', type: 'bool', isCommand: false },
        { name: 'EmptyMessage', type: 'string', isCommand: false },
        { name: 'StatusMessage', type: 'string', isCommand: false },
        
        // Commands from ModuleListViewModel
        { name: 'LoadDataCommand', type: 'ICommand', isCommand: true },
        { name: 'AddCommand', type: 'ICommand', isCommand: true },
        { name: 'EditCommand', type: 'ICommand', isCommand: true },
        { name: 'DeleteCommand', type: 'ICommand', isCommand: true },
        { name: 'DuplicateCommand', type: 'ICommand', isCommand: true },
        { name: 'RefreshCommand', type: 'ICommand', isCommand: true },
        { name: 'SearchCommand', type: 'ICommand', isCommand: true },
        { name: 'NextPageCommand', type: 'ICommand', isCommand: true },
        { name: 'PreviousPageCommand', type: 'ICommand', isCommand: true },
        { name: 'ExportCommand', type: 'ICommand', isCommand: true },

        // From StandardTableViewModel<T>
        { name: 'FilterDefinitions', type: 'ObservableCollection<FilterDefinition>', isCommand: false },
        { name: 'TableColumns', type: 'ObservableCollection<TableColumnDefinition>', isCommand: false },
        { name: 'ToolbarActions', type: 'ObservableCollection<ToolbarAction>', isCommand: false },
        { name: 'AvailableViews', type: 'ObservableCollection<string>', isCommand: false },
        { name: 'SelectedViewKey', type: 'string', isCommand: false },
        { name: 'SortColumn', type: 'string', isCommand: false },
        { name: 'SortAscending', type: 'bool', isCommand: false },
        { name: 'ApplyFiltersCommand', type: 'ICommand', isCommand: true },
        { name: 'ClearFiltersCommand', type: 'ICommand', isCommand: true },
        { name: 'SortCommand', type: 'ICommand', isCommand: true },
    ];

    // ─────────────────────────────────────────────────────────────────────────
    // REACTIVEUI PATTERNS
    // ─────────────────────────────────────────────────────────────────────────
    private static readonly REACTIVEUI_PATTERNS = {
        // RaiseAndSetIfChanged pattern
        raiseSetPattern: /this\s*\.\s*RaiseAndSetIfChanged\s*\(ref\s+_\w+\s*,\s*value\s*,?\s*(?:["'](\w+)["'])?\s*\)/gi,
        
        // RaisePropertyChanged pattern
        raisePropertyPattern: /this\s*\.\s*RaisePropertyChanged\s*\(\s*(?:nameof\s*\(\s*(\w+)\s*\)|["'](\w+)["'])\s*\)/gi,
        
        // WhenAnyValue pattern
        whenAnyPattern: /this\s*\.\s*WhenAnyValue\s*\(\s*(?:x\s*=>\s*x\s*\.\s*(\w+)|(\w+))\s*(?:,\s*(?:x\s*=>\s*x\s*\.\s*(\w+)|(\w+)))*\s*\)/gi,
        
        // ReactiveCommand pattern
        reactiveCommandPattern: /(?:public|private|protected)?\s*(?:static)?\s*(?:readonly)?\s*ICommand\s+(\w+)\s*(?:\{?\s*get)?\s*=\s*(?:ReactiveCommand|Command)\s*\.?\s*(CreateFromTask|Create)?\s*<([^>]+)>\s*\(/gi,
        
        // ObservableAsProperty
        oapPattern: /private\s+readonly\s+ObservableAsPropertyAttribute\s*\(\s*\)\s*(\w+)/gi,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // COMMUNITYTOOLKIT.MVVM PATTERNS
    // ─────────────────────────────────────────────────────────────────────────
    private static readonly MVVM_TOOLKIT_PATTERNS = {
        // ObservableProperty attribute
        observablePropertyPattern: /\[ObservableProperty\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public|readonly)?\s+([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*;/gi,
        
        // RelayCommand attribute
        relayCommandPattern: /\[RelayCommand\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public)?\s*(?:async\s+)?(?:Task|void)\s+([A-Za-z_]\w*)\s*\(/gi,
        
        // ObservableProperty with source generator
        generatedPropertyPattern: /public\s+([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\{\s*(?:get;\s*)?(?:private\s+set;\s*)?\}\s*;?\s*$/gm,
        
        // WeakReferenceMessenger
        messengerSendPattern: /WeakReferenceMessenger\s*\.\s*Default\s*\.\s*Send\s*<(\w+)>\s*\(/gi,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // STANDARD C# PATTERNS
    // ─────────────────────────────────────────────────────────────────────────
    private static readonly STANDARD_PATTERNS = {
        // Auto-property: public Type Name { get; set; }
        autoPropertyPattern: /public\s+(?:static\s+)?(?:readonly\s+)?([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\{\s*(?:get|set)(?:\s*;|\s*\{\s*\})\s*\}/gi,
        
        // Property with backing field: public Type Name { get => _name; set => SetProperty(ref _name, value); }
        propertyWithBackingPattern: /public\s+([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\{\s*get\s*;?\s*(?:private\s+)?set\s*;?\s*\}/gi,
        
        // Read-only property: public Type Name => ...
        readOnlyPropertyPattern: /public\s+([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*=>/gi,
        
        // Field: private Type _name;
        fieldPattern: /(?:private|protected|public|readonly)?\s*(?:static\s+)?(?:readonly\s+)?([A-Za-z0-9_<>\[\],\s]+?)\s+([_][A-Za-z_]\w*)\s*;/gi,
        
        // Command: public ICommand NameCommand { get; }
        commandPattern: /(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?ICommand\s+(\w+)\s*(?:\{?\s*get)?\s*[;=]/gi,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN PARSING METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Parse a C# file and extract all properties and commands
     */
    public static parseFile(filePath: string): CSharpProperty[] {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        return this.parseContent(content);
    }

    /**
     * Parse C# content to extract properties
     */
    public static parseContent(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];

        // 1. Standard auto-properties
        properties.push(...this.parseAutoProperties(content));

        // 2. ObservableProperty (CommunityToolkit.Mvvm)
        properties.push(...this.parseObservableProperties(content));

        // 3. ReactiveUI RaiseAndSetIfChanged
        properties.push(...this.parseReactiveUIProperties(content));

        // 4. RelayCommands (CommunityToolkit.Mvvm)
        properties.push(...this.parseRelayCommands(content));

        // 5. ReactiveCommands
        properties.push(...this.parseReactiveCommands(content));

        // 6. Standard ICommand properties
        properties.push(...this.parseICommandProperties(content));

        // Remove duplicates
        return this.deduplicateProperties(properties);
    }

    /**
     * Parse a C# file and extract full class information
     */
    public static parseClass(filePath: string): CSharpClass | null {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        return this.parseClassContent(content, path.basename(filePath, '.cs'));
    }

    /**
     * Parse content to extract full class information
     */
    public static parseClassContent(content: string, fileName?: string): CSharpClass | null {
        // Extract namespace
        const namespaceMatch = content.match(/namespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);
        const namespace_ = namespaceMatch ? namespaceMatch[1] : '';

        // Extract class name
        const classMatch = content.match(/class\s+([A-Za-z_]\w*)/);
        const className = classMatch ? classMatch[1] : (fileName || 'Unknown');

        // Extract base classes
        const baseClassMatch = content.match(/class\s+\w+\s*:\s*([^{]+)/);
        const baseClasses = baseClassMatch 
            ? baseClassMatch[1].split(',').map(b => b.trim().split('<')[0].split('.').pop()!)
            : [];

        // Parse properties
        const properties = this.parseContent(content);

        // Parse fields
        const fields = this.parseFields(content);

        // Parse methods
        const methods = this.parseMethods(content);

        // Parse commands
        const commands = this.parseAllCommands(content);

        return {
            name: className,
            namespace: namespace_,
            baseClasses,
            properties,
            commands,
            fields,
            methods
        };
    }

    /**
     * Parse ViewModel information including base class properties
     */
    public static parseViewModel(filePath: string, xDataType?: string): ViewModelInfo | null {
        const cls = this.parseClass(filePath);
        if (!cls) return null;

        // Determine the data type (generic parameter T)
        const dataType = this.extractDataType(cls);

        // Get base properties
        const baseProperties = this.getBaseProperties(cls.baseClasses);

        // Get specific definitions
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        const filterDefinitions = this.parseMethodDefinitions(content, 'DefineFilters');
        const tableColumns = this.parseMethodDefinitions(content, 'DefineColumns');
        const toolbarActions = this.parseMethodDefinitions(content, 'DefineActions');

        return {
            className: cls.name,
            namespace: cls.namespace,
            filePath,
            dataType,
            properties: cls.properties,
            commands: cls.commands,
            filterDefinitions,
            tableColumns,
            toolbarActions,
            baseProperties
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PATTERN PARSING METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Parse standard auto-properties: public Type Name { get; set; }
     */
    private static parseAutoProperties(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];
        const pattern = /public\s+(?:static\s+)?(?:readonly\s+)?([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\{\s*(?:get|set)(?:\s*;|\s*\{\s*\})\s*\}/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const type = match[1].trim();
            const name = match[2].trim();

            if (!this.isIgnoredProperty(name, type)) {
                properties.push({
                    name,
                    type: this.normalizeType(type),
                    isCommand: type.includes('Command'),
                    description: this.getPropertyDescription(name, type)
                });
            }
        }

        return properties;
    }

    /**
     * Parse ObservableProperty (CommunityToolkit.Mvvm): [ObservableProperty] private string _name;
     */
    private static parseObservableProperties(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];
        const pattern = /\[ObservableProperty\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public|readonly)?\s*([A-Za-z0-9_<>\[\],\s]+?)\s+([_][A-Za-z_]\w*)\s*;/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const type = match[1].trim();
            const fieldName = match[2].trim();

            // Convert field name to property name
            const propName = this.fieldToPropertyName(fieldName);

            properties.push({
                name: propName,
                type: this.normalizeType(type),
                isCommand: type.includes('Command'),
                description: `Observable property from field ${fieldName}`
            });
        }

        return properties;
    }

    /**
     * Parse ReactiveUI RaiseAndSetIfChanged properties
     */
    private static parseReactiveUIProperties(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];
        const pattern = /this\s*\.\s*RaiseAndSetIfChanged\s*\(\s*ref\s+_\w+\s*,\s*value\s*,?\s*(?:["'](\w+)["'])?\s*\)/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const propName = match[1] || match[2];
            if (propName) {
                // Try to find the backing field type
                const backingPattern = new RegExp(`private\\s+([A-Za-z0-9_<>,]+)\\s+_${propName.charAt(0).toLowerCase()}${propName.slice(1)}\\s*;`, 'i');
                const backingMatch = content.match(backingPattern);
                const type = backingMatch ? backingMatch[1].trim() : 'object';

                if (!properties.some(p => p.name === propName)) {
                    properties.push({
                        name: propName,
                        type: this.normalizeType(type),
                        isCommand: type.includes('Command'),
                        description: 'Property using ReactiveUI RaiseAndSetIfChanged'
                    });
                }
            }
        }

        return properties;
    }

    /**
     * Parse RelayCommands (CommunityToolkit.Mvvm): [RelayCommand] private void Delete()
     */
    private static parseRelayCommands(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];
        const pattern = /\[RelayCommand\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public)?\s*(?:async\s+)?(?:Task|void)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const methodName = match[1].trim();
            const params = match[2]?.trim() || '';
            const cmdName = methodName + 'Command';

            properties.push({
                name: cmdName,
                type: 'ICommand' + (params ? `<${this.extractParamTypes(params)}>` : ''),
                isCommand: true,
                description: `RelayCommand for ${methodName}()`
            });
        }

        return properties;
    }

    /**
     * Parse ReactiveCommand declarations
     */
    private static parseReactiveCommands(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];

        // ReactiveCommand.CreateFromTask pattern
        const createFromTaskPattern = /(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?(\w+Command)\s*=\s*ReactiveCommand\s*\.?\s*CreateFromTask\s*<([^>]+)>\s*\(/gi;
        let match;

        while ((match = createFromTaskPattern.exec(content)) !== null) {
            properties.push({
                name: match[1],
                type: 'ReactiveCommand',
                isCommand: true,
                description: `ReactiveCommand for ${match[1].replace('Command', '')}`
            });
        }

        // Simple ReactiveCommand declaration
        const simplePattern = /(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?(ICommand\s+)?(\w+Command)\s*[;=]/gi;
        while ((match = simplePattern.exec(content)) !== null) {
            if (!properties.some(p => p.name === match[2])) {
                properties.push({
                    name: match[2],
                    type: 'ICommand',
                    isCommand: true,
                    description: 'ICommand property'
                });
            }
        }

        return properties;
    }

    /**
     * Parse standard ICommand properties
     */
    private static parseICommandProperties(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];
        
        // Pattern: public ICommand NameCommand { get; }
        const pattern = /(?:public|private|protected)?\s*(?:static\s+)?(?:readonly\s+)?ICommand\s+(\w+)\s*(?:\{?\s*get)?\s*[;]/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const name = match[1].trim();
            
            if (!name.includes('_') && !properties.some(p => p.name === name)) {
                properties.push({
                    name,
                    type: 'ICommand',
                    isCommand: true,
                    description: 'ICommand property'
                });
            }
        }

        return properties;
    }

    /**
     * Parse private fields
     */
    private static parseFields(content: string): Array<{ name: string; type: string; isReadOnly: boolean }> {
        const fields: Array<{ name: string; type: string; isReadOnly: boolean }> = [];
        
        // Pattern: [private/public/protected] [readonly] Type _name;
        const pattern = /(?:private|protected|public)?\s*(readonly)?\s*([A-Za-z0-9_<>\[\],\s]+?)\s+([_][A-Za-z_]\w*)\s*;/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const isReadOnly = !!match[1];
            const type = match[2].trim();
            const name = match[3].trim();

            fields.push({ name, type, isReadOnly });
        }

        return fields;
    }

    /**
     * Parse methods
     */
    private static parseMethods(content: string): Array<{ name: string; parameters: string[]; returnType: string }> {
        const methods: Array<{ name: string; parameters: string[]; returnType: string }> = [];
        
        // Pattern: [attributes] [async] ReturnType MethodName(params)
        const pattern = /(?:\[.*?\]\s*)*\s*(?:public|private|protected|internal)?\s*(?:static)?\s*(?:async)?\s*([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const returnType = match[1].trim();
            const name = match[2].trim();
            const params = match[3]?.trim() || '';

            // Skip event handlers and properties
            if (!name.startsWith('get_') && !name.startsWith('set_') && !name.startsWith('add_') && !name.startsWith('remove_')) {
                methods.push({
                    name,
                    returnType,
                    parameters: params ? params.split(',').map(p => p.trim()) : []
                });
            }
        }

        return methods;
    }

    /**
     * Parse all commands (for ViewModelInfo)
     */
    private static parseAllCommands(content: string): CSharpCommand[] {
        const commands: CSharpCommand[] = [];

        // Parse RelayCommand attributes
        const relayCommandPattern = /\[RelayCommand\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public)?\s*(?:async\s+)?(?:Task|void)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gi;
        let match;
        while ((match = relayCommandPattern.exec(content)) !== null) {
            const methodName = match[1].trim();
            const params = match[2]?.trim() || '';
            commands.push({
                name: methodName + 'Command',
                type: 'RelayCommand',
                methodName: methodName,
                parameters: params ? params.split(',').map(p => p.trim()) : []
            });
        }

        // Add simple ICommand properties
        const propCommands = this.parseICommandProperties(content);
        for (const pc of propCommands) {
            if (!commands.some(c => c.name === pc.name)) {
                commands.push({
                    name: pc.name,
                    type: 'ICommand',
                    methodName: pc.name.replace('Command', '')
                });
            }
        }

        return commands;
    }

    /**
     * Parse definitions from DefineFilters, DefineColumns, DefineActions methods
     */
    private static parseMethodDefinitions(content: string, methodName: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];

        // Find the method body
        const methodPattern = new RegExp(`protected\\s+(?:override\\s+)?void\\s+${methodName}\\s*\\(\\s*\\)\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`, 's');
        const match = content.match(methodPattern);

        if (!match) return properties;

        const body = match[1];

        // Parse TableColumnDefinition additions
        if (methodName === 'DefineColumns') {
            const colPattern = /new\s+TableColumnDefinition\s*\{([^}]+)\}/gi;
            let colMatch;

            while ((colMatch = colPattern.exec(body)) !== null) {
                const props = colMatch[1];
                const keyMatch = props.match(/Key\s*=\s*["']?(\w+)["']?/);
                const headerMatch = props.match(/Header\s*=\s*["']?([^"',\s]+)["']?/);
                const typeMatch = props.match(/DataType\s*=\s*ColumnDataType\.(\w+)/);

                if (keyMatch) {
                    properties.push({
                        name: keyMatch[1],
                        type: typeMatch ? `ColumnDataType.${typeMatch[1]}` : 'ColumnDataType.Text',
                        isCommand: false,
                        description: headerMatch ? `Column: ${headerMatch[1]}` : 'Table column'
                    });
                }
            }
        }

        // Parse FilterDefinition additions
        if (methodName === 'DefineFilters') {
            const filterPattern = /new\s+FilterDefinition\s*\{([^}]+)\}/gi;
            let filterMatch;

            while ((filterMatch = filterPattern.exec(body)) !== null) {
                const props = filterMatch[1];
                const keyMatch = props.match(/Key\s*=\s*["']?(\w+)["']?/);
                const labelMatch = props.match(/Label\s*=\s*["']?([^"',\s]+)["']?/);
                const typeMatch = props.match(/Type\s*=\s*FilterType\.(\w+)/);

                if (keyMatch) {
                    properties.push({
                        name: keyMatch[1],
                        type: typeMatch ? `FilterType.${typeMatch[1]}` : 'FilterType.TextSearch',
                        isCommand: false,
                        description: labelMatch ? `Filter: ${labelMatch[1]}` : 'Filter'
                    });
                }
            }
        }

        // Parse ToolbarAction additions
        if (methodName === 'DefineActions') {
            const actionPattern = /new\s+ToolbarAction\s*\{([^}]+)\}/gi;
            let actionMatch;

            while ((actionMatch = actionPattern.exec(body)) !== null) {
                const props = actionMatch[1];
                const idMatch = props.match(/Id\s*=\s*["']?(\w+)["']?/);
                const textMatch = props.match(/Text\s*=\s*["']?([^"',\s]+)["']?/);

                if (idMatch) {
                    properties.push({
                        name: idMatch[1],
                        type: 'ToolbarAction',
                        isCommand: false,
                        description: textMatch ? `Action: ${textMatch[1]}` : 'Toolbar action'
                    });
                }
            }
        }

        return properties;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Convert field name to property name (_title → Title)
     */
    private static fieldToPropertyName(fieldName: string): string {
        return fieldName
            .replace(/^[_m]+/, '')  // Remove leading _ or m_
            .replace(/^./, s => s.toUpperCase());  // Capitalize first letter
    }

    /**
     * Normalize type string (remove extra whitespace, simplify generics)
     */
    private static normalizeType(type: string): string {
        return type
            .replace(/\s+/g, ' ')
            .replace(/>\s+</g, '><')
            .trim();
    }

    /**
     * Check if property should be ignored
     */
    private static isIgnoredProperty(name: string, type: string): boolean {
        const ignored = ['class', 'interface', 'struct', 'enum', 'event', 'delegate'];
        if (ignored.includes(name.toLowerCase())) return true;

        // Ignore event handlers
        if (type.includes('EventHandler') || type.includes('Action<')) return true;

        return false;
    }

    /**
     * Get description for a property based on its name
     */
    private static getPropertyDescription(name: string, type: string): string {
        const descriptions: Record<string, string> = {
            'Id': 'Unique identifier',
            'Name': 'Display name',
            'Title': 'Title text',
            'Text': 'Text content',
            'IsEnabled': 'Enabled state',
            'IsVisible': 'Visibility state',
            'IsLoading': 'Loading indicator state',
            'SelectedItem': 'Currently selected item',
            'ItemsSource': 'Collection of items',
            'Command': 'Command to execute',
            'Width': 'Width dimension',
            'Height': 'Height dimension',
            'Color': 'Color value',
            'BackgroundColor': 'Background color',
            'TextColor': 'Text color',
            'Margin': 'Margin spacing',
            'Padding': 'Padding spacing',
        };

        return descriptions[name] || `Property of type ${type}`;
    }

    /**
     * Extract parameter types from parameter string
     */
    private static extractParamTypes(params: string): string {
        return params
            .split(',')
            .map(p => {
                const match = p.trim().match(/([A-Za-z0-9_<>,]+)\s+\w+$/);
                return match ? match[1] : 'object';
            })
            .join(', ');
    }

    /**
     * Extract data type from generic class declaration
     */
    private static extractDataType(cls: CSharpClass): string {
        // Find the generic parameter T from inheritance
        if (cls.baseClasses.some(b => b.includes('StandardTableViewModel') || b.includes('ModuleListViewModel'))) {
            // Try to find T from the class definition
            const genericMatch = cls.baseClasses
                .map(b => b.match(/<(\w+)>/)?.[1])
                .find(m => !!m);
            return genericMatch || 'T';
        }

        return 'object';
    }

    /**
     * Get base class properties based on inheritance chain
     */
    private static getBaseProperties(baseClasses: string[]): CSharpProperty[] {
        const baseProps: CSharpProperty[] = [];

        // Add ViewModelBase properties if inherited
        if (baseClasses.includes('ViewModelBase') || 
            baseClasses.includes('ReactiveObject') ||
            baseClasses.includes('StandardTableViewModel') ||
            baseClasses.includes('ModuleListViewModel')) {
            baseProps.push(...this.BASE_VIEWMODEL_PROPERTIES);
        }

        return baseProps;
    }

    /**
     * Remove duplicate properties (by name)
     */
    private static deduplicateProperties(properties: CSharpProperty[]): CSharpProperty[] {
        const seen = new Map<string, CSharpProperty>();

        for (const prop of properties) {
            if (!seen.has(prop.name)) {
                seen.set(prop.name, prop);
            }
        }

        return Array.from(seen.values());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PATH RESOLUTION METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resolve the path to the ViewModel given a XAML file path and optionally the x:DataType.
     */
    public static resolveViewModelPath(xamlFilePath: string, xDataType?: string): string | null {
        const dir = path.dirname(xamlFilePath);
        const fileName = path.basename(xamlFilePath, '.xaml');

        // Strategy 1: If xDataType is provided (e.g., "viewmodels:MainViewModel" or "local:MainViewModel")
        if (xDataType) {
            const vmPath = this.resolveViewModelFromDataType(xamlFilePath, xDataType);
            if (vmPath) return vmPath;
        }

        // Strategy 2: Look for Code-Behind file (.xaml.cs) to find ViewModel
        const codeBehindPath = xamlFilePath + '.cs';
        if (fs.existsSync(codeBehindPath)) {
            const cbContent = fs.readFileSync(codeBehindPath, 'utf-8');
            
            // Look for BindingContext assignment
            const bindingContextMatch = cbContent.match(/BindingContext\s*=\s*new\s+(\w+ViewModel)\s*\(/);
            if (bindingContextMatch) {
                const vmClassName = bindingContextMatch[1];
                const possiblePaths = this.getPossibleViewModelPaths(dir, vmClassName);
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) return p;
                }
            }
        }

        // Strategy 3: Convention over configuration (MainPage → MainViewModel)
        return this.resolveByConvention(dir, fileName);
    }

    /**
     * Resolve ViewModel path from x:DataType declaration
     */
    private static resolveViewModelFromDataType(xamlFilePath: string, xDataType: string): string | null {
        const parts = xDataType.split(':');
        const vmClassName = parts.length > 1 ? parts[1] : parts[0];
        
        // Remove generic type parameters for file matching
        const cleanClassName = vmClassName.split('<')[0];

        const possiblePaths = this.getPossibleViewModelPaths(path.dirname(xamlFilePath), cleanClassName);
        
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }

        return null;
    }

    /**
     * Get possible ViewModel paths based on common conventions
     */
    private static getPossibleViewModelPaths(dir: string, className: string): string[] {
        return [
            path.join(dir, `${className}.cs`),
            path.join(dir, '..', 'ViewModels', `${className}.cs`),
            path.join(dir, '..', '..', 'ViewModels', `${className}.cs`),
            path.join(dir, '..', 'ViewModels', 'Modules', `${className}.cs`),
            path.join(dir, '..', '..', 'ViewModels', 'Modules', `${className}.cs`),
            path.join(dir, '..', '..', 'ViewModels', `${className}.cs`),
        ];
    }

    /**
     * Resolve ViewModel by naming convention
     */
    private static resolveByConvention(dir: string, xamlFileName: string): string | null {
        let conventionVmName = xamlFileName;
        
        if (xamlFileName.endsWith('Page') || xamlFileName.endsWith('View')) {
            conventionVmName = xamlFileName
                .replace(/Page$/, 'ViewModel')
                .replace(/View$/, 'ViewModel');
        } else {
            conventionVmName = xamlFileName + 'ViewModel';
        }

        const possiblePaths = this.getPossibleViewModelPaths(dir, conventionVmName);

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }

        return null;
    }

    /**
     * Get all ViewModels in a project directory
     */
    public static findAllViewModels(projectPath: string): string[] {
        const viewModels: string[] = [];
        
        const searchPatterns = [
            '**/*ViewModel.cs',
            '**/*ViewModel.generated.cs',
        ];

        for (const pattern of searchPatterns) {
            try {
                const matches = this.findFiles(projectPath, pattern);
                viewModels.push(...matches);
            } catch (e) {
                // Ignore errors
            }
        }

        return viewModels;
    }

    /**
     * Find files matching a pattern (simple implementation)
     */
    private static findFiles(dir: string, pattern: string): string[] {
        const results: string[] = [];
        const patternParts = pattern.split('/').filter(p => p !== '**');
        const regexPattern = new RegExp('^' + patternParts.join('\\/').replace(/\*/g, '.*') + '$');

        const walk = (currentDir: string) => {
            try {
                const entries = fs.readdirSync(currentDir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentDir, entry.name);
                    
                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'bin' && entry.name !== 'obj') {
                        walk(fullPath);
                    } else if (entry.isFile() && regexPattern.test(entry.name)) {
                        results.push(fullPath);
                    }
                }
            } catch (e) {
                // Ignore permission errors
            }
        };

        walk(dir);
        return results;
    }

    /**
     * Parse DTO class to extract properties
     */
    public static parseDto(filePath: string): CSharpProperty[] {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const properties: CSharpProperty[] = [];

        // Pattern: public Type Name { get; set; }
        const pattern = /public\s+([A-Za-z0-9_<>\[\],\s]+?)\s+([A-Za-z_]\w*)\s*\{\s*get;\s*set;\s*\}/gi;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const type = match[1].trim();
            const name = match[2].trim();

            // Get JSON property name if present
            const propMatch = content.substring(match.index, match.index + 200).match(/\[JsonPropertyName\s*\(\s*["']([^"']+)["']\s*\)\][\s\n]*public\s+/);
            const jsonName = propMatch ? propMatch[1] : name;

            properties.push({
                name: jsonName,  // Use JSON property name for binding
                type: this.normalizeType(type),
                isCommand: false,
                description: `DTO property of type ${type}`
            });
        }

        return properties;
    }

    /**
     * Get all binding suggestions for a ViewModel
     */
    public static getBindingSuggestions(viewModelPath: string, xDataType?: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];

        // 1. Get base ViewModel properties
        properties.push(...this.BASE_VIEWMODEL_PROPERTIES);

        // 2. Get ViewModel-specific properties
        const viewModelProps = this.parseFile(viewModelPath);
        properties.push(...viewModelProps);

        // 3. If x:DataType is set, also get DTO properties
        if (xDataType) {
            const parts = xDataType.split(':');
            const dtoClassName = parts.length > 1 ? parts[1] : parts[0];
            const cleanDtoName = dtoClassName.split('<')[0];

            // Try to find DTO file
            const possibleDtoPaths = [
                path.join(path.dirname(viewModelPath), '..', 'Models', 'Api', `${cleanDtoName}.cs`),
                path.join(path.dirname(viewModelPath), '..', 'Models', 'Dto', `${cleanDtoName}.cs`),
                path.join(path.dirname(viewModelPath), '..', '..', 'Dto', 'ApiDtos', `${cleanDtoName}.cs`),
                path.join(path.dirname(viewModelPath), '..', '..', 'Models', 'Api', `${cleanDtoName}.cs`),
            ];

            for (const dtoPath of possibleDtoPaths) {
                if (fs.existsSync(dtoPath)) {
                    properties.push(...this.parseDto(dtoPath));
                    break;
                }
            }
        }

        return this.deduplicateProperties(properties);
    }
}
