import * as vscode from 'vscode';
import { CSharpProperty, CSharpParser } from './csharpParser';
import * as path from 'path';
import * as fs from 'fs';

export class CodeBehindTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly type: string,
        public readonly isCommand: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly filePath: string,
    ) {
        super(label, collapsibleState);

        let iconPath = '';
        if (isCommand || type === 'ICommand') {
            // Command icon (e.g. symbol-event or symbol-method)
            iconPath = new vscode.ThemeIcon('symbol-event').id;
        } else if (type.toLowerCase().includes('void') || type.toLowerCase().includes('task')) {
            // Method / Event Handler
            iconPath = new vscode.ThemeIcon('symbol-method').id;
        } else {
            // Property
            iconPath = new vscode.ThemeIcon('symbol-property').id;
        }

        this.iconPath = new vscode.ThemeIcon(iconPath);
        this.contextValue = 'codeBehindItem';

        // Add command to make item clickable if it's not a group
        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.command = {
                command: 'mauiCodeBehind.selectItem',
                title: 'Select in XAML',
                arguments: [this]
            };
        }
    }
}

export class CodeBehindProvider implements vscode.TreeDataProvider<CodeBehindTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CodeBehindTreeItem | undefined | void> = new vscode.EventEmitter<CodeBehindTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<CodeBehindTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private _currentViewModelPath: string | undefined;
    private _currentCodeBehindPath: string | undefined;

    private _viewModelProps: CSharpProperty[] = [];
    private _codeBehindProps: CSharpProperty[] = [];

    constructor() { }

    public updateContext(xamlFilePath: string, xDataType?: string) {
        // 1. Resolve Code-Behind (e.g., MainPage.xaml.cs)
        this._currentCodeBehindPath = xamlFilePath + '.cs';
        if (fs.existsSync(this._currentCodeBehindPath)) {
            this._codeBehindProps = CSharpParser.parseFile(this._currentCodeBehindPath);
        } else {
            this._currentCodeBehindPath = undefined;
            this._codeBehindProps = [];
        }

        // 2. Resolve ViewModel
        this._currentViewModelPath = CSharpParser.resolveViewModelPath(xamlFilePath, xDataType) || undefined;
        if (this._currentViewModelPath) {
            this._viewModelProps = CSharpParser.parseFile(this._currentViewModelPath);
        } else {
            this._viewModelProps = [];
        }

        this.refresh();
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CodeBehindTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CodeBehindTreeItem): Thenable<CodeBehindTreeItem[]> {
        if (!this._currentViewModelPath && !this._currentCodeBehindPath) {
            return Promise.resolve([
                new CodeBehindTreeItem('Ni najdene C# kode', 'Odprite XAML datoteko', 'info', false, vscode.TreeItemCollapsibleState.None, '')
            ]);
        }

        if (element) {
            // Children of groups
            if (element.label.includes('ViewModel')) {
                return Promise.resolve(this._viewModelProps.map(p =>
                    new CodeBehindTreeItem(p.name, `${p.type} ${p.name}`, p.type, p.isCommand, vscode.TreeItemCollapsibleState.None, this._currentViewModelPath!)
                ));
            } else if (element.label.includes('Code-Behind')) {
                return Promise.resolve(this._codeBehindProps.map(p =>
                    new CodeBehindTreeItem(p.name, `${p.type} ${p.name}`, p.type, p.isCommand, vscode.TreeItemCollapsibleState.None, this._currentCodeBehindPath!)
                ));
            }
            return Promise.resolve([]);
        } else {
            // Root elements (Groups)
            const roots: CodeBehindTreeItem[] = [];

            if (this._currentViewModelPath) {
                const vmName = path.basename(this._currentViewModelPath);
                roots.push(new CodeBehindTreeItem(
                    `ViewModel (${vmName})`,
                    this._currentViewModelPath,
                    'group',
                    false,
                    vscode.TreeItemCollapsibleState.Expanded,
                    this._currentViewModelPath
                ));
            }

            if (this._currentCodeBehindPath) {
                const cbName = path.basename(this._currentCodeBehindPath);
                roots.push(new CodeBehindTreeItem(
                    `Code-Behind (${cbName})`,
                    this._currentCodeBehindPath,
                    'group',
                    false,
                    vscode.TreeItemCollapsibleState.Expanded,
                    this._currentCodeBehindPath
                ));
            }

            return Promise.resolve(roots);
        }
    }
}
