import * as vscode from 'vscode';
import * as fs from 'fs';
import { CSharpParser } from './csharpParser';

/**
 * Provides CodeLens items on XAML files:
 *   - Above x:DataType  → "Open ViewModel"
 *   - Above {Binding X} → "→ ViewModel.X" (navigates to property)
 *   - Above Command="{Binding XCommand}" → "→ ViewModel.XCommand"
 */
export class XamlCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // 1. x:DataType → "Open ViewModel"
        const dataTypeRe = /x:DataType\s*=\s*"([^"]+)"/g;
        let m: RegExpExecArray | null;
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
        const seen = new Set<string>();
        while ((m = bindingRe.exec(text)) !== null) {
            const propPath = m[1];
            if (seen.has(propPath)) continue;
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
    public resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
        return lens;
    }
}

// ── Command handlers ─────────────────────────────────────────────────────────

export function registerCodeLensCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mauiCodeLens.openViewModel',
            async (xamlPath: string, rawType: string) => {
                const className = rawType.includes(':') ? rawType.split(':')[1] : rawType;
                const vmPath = CSharpParser.resolveViewModelPath(xamlPath, rawType);
                if (!vmPath) {
                    vscode.window.showWarningMessage(`ViewModel '${className}' ni bil najden.`);
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(vmPath));
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            }
        ),

        vscode.commands.registerCommand('mauiCodeLens.gotoVmSymbol',
            async (xamlPath: string, symbolName: string) => {
                // Resolve VM file
                const vmPath = CSharpParser.resolveViewModelPath(xamlPath);
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

                let matchIndex: number | undefined;
                for (const re of patterns) {
                    const match = re.exec(text);
                    if (match) { matchIndex = match.index; break; }
                }

                const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                if (matchIndex !== undefined) {
                    const pos = doc.positionAt(matchIndex);
                    editor.selection = new vscode.Selection(pos, pos);
                    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                }
            }
        )
    );
}
