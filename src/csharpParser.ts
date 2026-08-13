import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface CSharpProperty {
    name: string;
    type: string;
    isCommand: boolean;
    kind: 'property' | 'method' | 'event' | 'command';
}

export class CSharpParser {

    /**
     * Parses a C# file and extracts public properties (including ObservableProperties)
     * and ICommands/RelayCommands.
     */
    public static parseFile(filePath: string): CSharpProperty[] {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        return this.parseContent(content);
    }

    /**
     * Parses C# source code content to extract properties and commands.
     */
    public static parseContent(content: string): CSharpProperty[] {
        const properties: CSharpProperty[] = [];

        // 1. Match standard auto-properties: public string Title { get; set; }
        // Require { get or { get; set or { set directly after name (no '(' before '{')
        const autoPropRegex = /public\s+([A-Za-z0-9_?<>\[\],. ]+?)\s+([A-Za-z0-9_]+)\s*\{\s*(?:get|set)/g;
        let match;
        while ((match = autoPropRegex.exec(content)) !== null) {
            const type = match[1].trim();
            const name = match[2].trim();
            const skip = ['class', 'interface', 'struct', 'enum', 'record', 'static', 'partial', 'abstract', 'override', 'virtual', 'sealed', 'new'];
            if (!skip.includes(name) && !skip.includes(type)) {
                properties.push({
                    name,
                    type,
                    isCommand: type.includes('Command'),
                    kind: type.includes('Command') ? 'command' : 'property'
                });
            }
        }

        // 2. Match Toolkit ObservableProperties: [ObservableProperty] private string _title;
        const observablePropRegex = /\[ObservableProperty\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public)\s+([A-Za-z0-9_<>\[\],]+)\s+([A-Za-z0-9_]+)/g;
        while ((match = observablePropRegex.exec(content)) !== null) {
            const type = match[1].trim();
            const fieldName = match[2].trim();
            let propName = fieldName.replace(/^[_m]+/, '');
            if (propName.length > 0) {
                propName = propName.charAt(0).toUpperCase() + propName.slice(1);
            }
            if (!properties.some(p => p.name === propName)) {
                properties.push({
                    name: propName,
                    type,
                    isCommand: type.includes('Command'),
                    kind: type.includes('Command') ? 'command' : 'property'
                });
            }
        }

        // 3. Match CommunityToolkit RelayCommands: [RelayCommand] private void Delete()
        const relayCmdRegex = /\[RelayCommand\][\s\n\r]*(?:\[.*?\][\s\n\r]*)*\s*(?:private|protected|public)\s+(?:async\s+)?(?:Task|void)\s+([A-Za-z0-9_]+)\s*\(/g;
        while ((match = relayCmdRegex.exec(content)) !== null) {
            const methodName = match[1].trim();
            const cmdName = methodName + 'Command';
            if (!properties.some(p => p.name === cmdName)) {
                properties.push({
                    name: cmdName,
                    type: 'ICommand',
                    isCommand: true,
                    kind: 'command'
                });
            }
        }

        // 4. Match public methods: public void Show(...), public async Task Load(...)
        const publicMethodRegex = /(?:^|\n)\s*public\s+(?:static\s+)?(?:async\s+)?([A-Za-z0-9_?<>\[\],. ]+?)\s+([A-Za-z0-9_]+)\s*\(/gm;
        while ((match = publicMethodRegex.exec(content)) !== null) {
            const retType = match[1].trim();
            const name = match[2].trim();
            const skip = ['class', 'interface', 'struct', 'enum', 'if', 'for', 'while', 'switch', 'catch', 'using', 'return', 'new'];
            if (!skip.includes(name) && !skip.includes(retType) && !properties.some(p => p.name === name)) {
                properties.push({
                    name,
                    type: retType,
                    isCommand: false,
                    kind: 'method'
                });
            }
        }

        // 5. Match event handlers (private/protected void/Task OnXxx, async void OnXxx):
        const eventHandlerRegex = /(?:^|\n)\s*(?:private|protected|internal)?\s+(?:async\s+)?(?:void|Task)\s+(On[A-Za-z0-9_]+|[A-Za-z0-9_]+(?:Clicked|Tapped|Changed|Updated|Loaded|Appeared|Navigated|Selected|Handler))\s*\(/gm;
        while ((match = eventHandlerRegex.exec(content)) !== null) {
            const name = match[1].trim();
            if (!properties.some(p => p.name === name)) {
                properties.push({
                    name,
                    type: 'void',
                    isCommand: false,
                    kind: 'method'
                });
            }
        }

        // 6. Match public events: public event Action? SaveCompleted;
        const eventDeclRegex = /public\s+event\s+([A-Za-z0-9_?<>\[\],. ]+?)\s+([A-Za-z0-9_]+)\s*;/g;
        while ((match = eventDeclRegex.exec(content)) !== null) {
            const type = match[1].trim();
            const name = match[2].trim();
            if (!properties.some(p => p.name === name)) {
                properties.push({
                    name,
                    type: `event ${type}`,
                    isCommand: false,
                    kind: 'event'
                });
            }
        }

        return properties;
    }

    /**
     * Resolves the path to the ViewModel given a XAML file path and optionally the x:DataType.
     */
    public static resolveViewModelPath(xamlFilePath: string, xDataType?: string): string | null {
        const dir = path.dirname(xamlFilePath);
        const fileName = path.basename(xamlFilePath, '.xaml'); // e.g., MainPage

        // Strategy 1: Look for explicit CodeBehind file (.xaml.cs) to find the ViewModel
        // We could parse the code-behind to find the BindingContext assignment, but that's complex.

        // Strategy 2: If xDataType is provided (e.g., "viewmodels:MainViewModel" or "local:MainViewModel")
        if (xDataType) {
            const parts = xDataType.split(':');
            const vmClassName = parts.length > 1 ? parts[1] : parts[0];

            // Try looking for vmClassName.cs in the same dir and known ViewModels dirs
            const subFolderForVm = path.basename(dir);
            const possiblePaths = [
                path.join(dir, `${vmClassName}.cs`),
                path.join(dir, '..', 'ViewModels', `${vmClassName}.cs`),
                path.join(dir, '..', '..', 'ViewModels', `${vmClassName}.cs`),
                // Mirror subfolder: Views/Codelists -> ViewModels/Codelists
                path.join(dir, '..', '..', 'ViewModels', subFolderForVm, `${vmClassName}.cs`),
                path.join(dir, '..', '..', '..', 'ViewModels', subFolderForVm, `${vmClassName}.cs`),
            ];

            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    return p;
                }
            }
        }

        // Strategy 3: Convention over configuration (MainPage -> MainViewModel, Page -> ViewModel)
        let conventionVmName = fileName;
        if (fileName.endsWith('Page') || fileName.endsWith('View')) {
            conventionVmName = fileName.replace(/Page$/, 'ViewModel').replace(/View$/, 'ViewModel');
        } else {
            conventionVmName = fileName + 'ViewModel';
        }

        // Subfolder name (e.g. "Codelists" when XAML is in Views/Codelists/)
        const subFolder = path.basename(dir);

        const conventionPaths = [
            path.join(dir, `${conventionVmName}.cs`),
            path.join(dir, '..', 'ViewModels', `${conventionVmName}.cs`),
            path.join(dir, '..', '..', 'ViewModels', `${conventionVmName}.cs`),
            // Mirror subfolder: Views/Codelists -> ViewModels/Codelists
            path.join(dir, '..', '..', 'ViewModels', subFolder, `${conventionVmName}.cs`),
            // Also check Auth, Settings, Modules, etc. subfolders one level deeper
            path.join(dir, '..', '..', '..', 'ViewModels', subFolder, `${conventionVmName}.cs`),
        ];

        for (const p of conventionPaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }

        // Return null if we couldn't resolve it reliably
        return null;
    }
}
