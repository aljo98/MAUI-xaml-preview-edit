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
exports.CodeBehindProvider = exports.CodeBehindTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const csharpParser_1 = require("./csharpParser");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class CodeBehindTreeItem extends vscode.TreeItem {
    constructor(label, tooltip, type, isCommand, collapsibleState, filePath, kind) {
        super(label, collapsibleState);
        this.label = label;
        this.tooltip = tooltip;
        this.type = type;
        this.isCommand = isCommand;
        this.collapsibleState = collapsibleState;
        this.filePath = filePath;
        this.kind = kind;
        let iconId;
        if (kind === 'command' || isCommand || type === 'ICommand') {
            iconId = 'symbol-event';
        }
        else if (kind === 'event') {
            iconId = 'symbol-interface';
        }
        else if (kind === 'method' || type.includes('void') || type.includes('Task')) {
            iconId = 'symbol-method';
        }
        else {
            iconId = 'symbol-property';
        }
        this.iconPath = new vscode.ThemeIcon(iconId);
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
exports.CodeBehindTreeItem = CodeBehindTreeItem;
class CodeBehindProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._viewModelProps = [];
        this._codeBehindProps = [];
    }
    updateContext(xamlFilePath, xDataType) {
        // 1. Resolve Code-Behind (e.g., MainPage.xaml.cs)
        this._currentCodeBehindPath = xamlFilePath + '.cs';
        if (fs.existsSync(this._currentCodeBehindPath)) {
            this._codeBehindProps = csharpParser_1.CSharpParser.parseFile(this._currentCodeBehindPath);
        }
        else {
            this._currentCodeBehindPath = undefined;
            this._codeBehindProps = [];
        }
        // 2. Resolve ViewModel
        this._currentViewModelPath = csharpParser_1.CSharpParser.resolveViewModelPath(xamlFilePath, xDataType) || undefined;
        if (this._currentViewModelPath) {
            this._viewModelProps = csharpParser_1.CSharpParser.parseFile(this._currentViewModelPath);
        }
        else {
            this._viewModelProps = [];
        }
        this.refresh();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!this._currentViewModelPath && !this._currentCodeBehindPath) {
            return Promise.resolve([
                new CodeBehindTreeItem('Ni najdene C# kode', 'Odprite XAML datoteko', 'info', false, vscode.TreeItemCollapsibleState.None, '')
            ]);
        }
        if (element) {
            // Children of groups
            if (element.label.includes('ViewModel')) {
                return Promise.resolve(this._viewModelProps.map(p => new CodeBehindTreeItem(p.name, `${p.type} ${p.name}`, p.type, p.isCommand, vscode.TreeItemCollapsibleState.None, this._currentViewModelPath, p.kind)));
            }
            else if (element.label.includes('Code-Behind')) {
                return Promise.resolve(this._codeBehindProps.map(p => new CodeBehindTreeItem(p.name, `${p.type} ${p.name}`, p.type, p.isCommand, vscode.TreeItemCollapsibleState.None, this._currentCodeBehindPath, p.kind)));
            }
            return Promise.resolve([]);
        }
        else {
            // Root elements (Groups)
            const roots = [];
            if (this._currentViewModelPath) {
                const vmName = path.basename(this._currentViewModelPath);
                roots.push(new CodeBehindTreeItem(`ViewModel (${vmName})`, this._currentViewModelPath, 'group', false, vscode.TreeItemCollapsibleState.Expanded, this._currentViewModelPath));
            }
            if (this._currentCodeBehindPath) {
                const cbName = path.basename(this._currentCodeBehindPath);
                roots.push(new CodeBehindTreeItem(`Code-Behind (${cbName})`, this._currentCodeBehindPath, 'group', false, vscode.TreeItemCollapsibleState.Expanded, this._currentCodeBehindPath));
            }
            return Promise.resolve(roots);
        }
    }
}
exports.CodeBehindProvider = CodeBehindProvider;
//# sourceMappingURL=codeBehindProvider.js.map