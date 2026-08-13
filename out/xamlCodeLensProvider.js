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
exports.XamlCodeLensProvider = void 0;
exports.registerCodeLensCommands = registerCodeLensCommands;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const csharpParser_1 = require("./csharpParser");
/**
 * Provides CodeLens items on XAML files:
 *   - Above x:DataType  → "Open ViewModel"
 *   - Above {Binding X} → "→ ViewModel.X" (navigates to property)
 *   - Above Command="{Binding XCommand}" → "→ ViewModel.XCommand"
 */
class XamlCodeLensProvider {
    constructor() {
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }
    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
    provideCodeLenses(document, _token) {
        const lenses = [];
        const text = document.getText();
        const lines = text.split('\n');
        // 1. x:DataType → "Open ViewModel"
        const dataTypeRe = /x:DataType\s*=\s*"([^"]+)"/g;
        let m;
        while ((m = dataTypeRe.exec(text)) !== null) {
            const pos = document.positionAt(m.index);
            const range = new vscode.Range(pos, pos);
            const rawType = m[1];
            const className = rawType.includes(':') ? rawType.split(':')[1] : rawType;
            lenses.push(new vscode.CodeLens(range, {
                title: `$(go-to-file) Open ViewModel: ${className}`,
                command: 'mauiCodeLens.openViewModel',
                arguments: [document.uri.fsPath, rawType]
            }));
        }
        // 2. Bindings → navigate to VM property
        const bindingRe = /\{Binding\s+(?:Path\s*=\s*)?([A-Za-z0-9_.]+)/g;
        const seen = new Set();
        while ((m = bindingRe.exec(text)) !== null) {
            const propPath = m[1];
            if (seen.has(propPath))
                continue;
            seen.add(propPath);
            const pos = document.positionAt(m.index);
            const range = new vscode.Range(pos, pos);
            lenses.push(new vscode.CodeLens(range, {
                title: `$(symbol-property) → ${propPath}`,
                command: 'mauiCodeLens.gotoVmSymbol',
                arguments: [document.uri.fsPath, propPath]
            }));
        }
        return lenses;
    }
    /** Resolves arguments (no lazy resolution needed here) */
    resolveCodeLens(lens) {
        return lens;
    }
}
exports.XamlCodeLensProvider = XamlCodeLensProvider;
// ── Command handlers ─────────────────────────────────────────────────────────
function registerCodeLensCommands(context) {
    context.subscriptions.push(vscode.commands.registerCommand('mauiCodeLens.openViewModel', async (xamlPath, rawType) => {
        const className = rawType.includes(':') ? rawType.split(':')[1] : rawType;
        const vmPath = csharpParser_1.CSharpParser.resolveViewModelPath(xamlPath, rawType);
        if (!vmPath) {
            vscode.window.showWarningMessage(`ViewModel '${className}' ni bil najden.`);
            return;
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(vmPath));
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    }), vscode.commands.registerCommand('mauiCodeLens.gotoVmSymbol', async (xamlPath, symbolName) => {
        // Resolve VM file
        const vmPath = csharpParser_1.CSharpParser.resolveViewModelPath(xamlPath);
        if (!vmPath || !fs.existsSync(vmPath)) {
            vscode.window.showWarningMessage(`ViewModel ni bil najden za ${symbolName}.`);
            return;
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(vmPath));
        const text = doc.getText();
        // Find the property/command by name
        const patterns = [
            // [ObservableProperty] private string _symbolName  → generated as SymbolName
            new RegExp(`\\[ObservableProperty\\][\\s\\S]{0,100}_${symbolName.charAt(0).toLowerCase() + symbolName.slice(1)}\\b`),
            // public string SymbolName {
            new RegExp(`public[^\\n]+\\b${symbolName}\\s*\\{`),
            // [RelayCommand] ... MethodName (generates MethodNameCommand)
            new RegExp(`\\[RelayCommand\\][\\s\\S]{0,100}\\b${symbolName.replace(/Command$/, '')}\\s*\\(`),
            // plain method or property match
            new RegExp(`\\b${symbolName}\\b`)
        ];
        let matchIndex;
        for (const re of patterns) {
            const match = re.exec(text);
            if (match) {
                matchIndex = match.index;
                break;
            }
        }
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
        if (matchIndex !== undefined) {
            const pos = doc.positionAt(matchIndex);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    }));
}
//# sourceMappingURL=xamlCodeLensProvider.js.map