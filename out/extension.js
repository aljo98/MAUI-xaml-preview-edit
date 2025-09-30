"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const previewProvider_1 = require("./previewProvider");
const entityManager_1 = require("./entityManager");
async function activate(context) {
    console.log('MAUI XAML Preview extension je aktivna!');
    // Registracija preview providerja
    const previewProvider = new previewProvider_1.MauiXamlPreviewProvider(context.extensionUri);
    const providerRegistration = vscode.window.registerWebviewPanelSerializer('mauiXamlPreview', previewProvider);
    // Registracija properties sidebar providerja (dynamic import to avoid circular issues)
    const propertiesModule = await Promise.resolve().then(() => require('./propertiesProvider'));
    const propertiesProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri);
    const propertiesTreeView = vscode.window.createTreeView('mauiProperties', {
        treeDataProvider: propertiesProvider,
        showCollapseAll: true
    });
    // Povezava med preview in properties providerjem
    previewProvider.setPropertiesProvider(propertiesProvider, propertiesTreeView);
    // Decoration type for highlighting selected elements in code
    const elementHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 152, 0, 0.2)',
        border: '2px solid #ff9800',
        borderRadius: '4px'
    });
    // Inicializacija entity managerja
    const entityManager = new entityManager_1.EntityManager();
    // Status bar gumb za hiter dostop do preview-ja
    const previewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    previewStatusBar.text = '$(preview) MAUI Preview';
    previewStatusBar.tooltip = 'Odpri MAUI XAML Preview';
    previewStatusBar.command = 'mauiXamlPreview.openPreview';
    context.subscriptions.push(previewStatusBar);
    const updatePreviewStatusBar = (editor) => {
        const targetEditor = editor ?? vscode.window.activeTextEditor;
        if (targetEditor && targetEditor.document.fileName.toLowerCase().endsWith('.xaml')) {
            previewStatusBar.show();
        }
        else {
            previewStatusBar.hide();
        }
    };
    updatePreviewStatusBar(vscode.window.activeTextEditor);
    // Ukaz za odpiranje preview-ja
    const openPreviewCommand = vscode.commands.registerCommand('mauiXamlPreview.openPreview', () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('Odprite XAML datoteko za preview!');
            return;
        }
        const document = activeEditor.document;
        if (!document.fileName.endsWith('.xaml')) {
            vscode.window.showWarningMessage('Preview deluje samo z XAML datotekami!');
            return;
        }
        previewProvider.openPreview(document);
        previewProvider.setElementHighlightDecoration(elementHighlightDecoration);
        updatePreviewStatusBar(activeEditor);
    });
    // Ukaz za urejanje lastnosti
    const editPropertyCommand = vscode.commands.registerCommand('mauiProperties.editProperty', async (property) => {
        if (!property)
            return;
        const newValue = await vscode.window.showInputBox({
            prompt: `Vnesi novo vrednost za ${property.key}`,
            value: property.value,
            placeHolder: property.value
        });
        if (newValue === undefined)
            return;
        // 1) Posodobi DOM v webview-u
        previewProvider.updateElementProperty(property, newValue);
        // 2) Posodobi XAML kodo (best-effort inline edit)
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
            vscode.window.showInformationMessage(`Posodobljena lastnost ${property.key}: ${newValue}`);
            return;
        }
        const doc = editor.document;
        const text = doc.getText();
        const keyPattern = property.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRegex = new RegExp(`${keyPattern}\\s*=\\s*"([^"]*)"`, 'i');
        const edit = new vscode.WorkspaceEdit();
        if (attrRegex.test(text)) {
            const match = attrRegex.exec(text);
            const idx = match.index;
            const start = doc.positionAt(idx);
            const end = doc.positionAt(idx + match[0].length);
            const newAttr = `${property.key}="${newValue}"`;
            edit.replace(doc.uri, new vscode.Range(start, end), newAttr);
        }
        else {
            // Insert attribute after element start tag for a quick update
            const openTag = new RegExp(`<${property.elementType}[^>]*>`, 'i').exec(text);
            if (openTag) {
                const insertPos = doc.positionAt(openTag.index + openTag[0].length - 1); // before '>'
                const insertion = ` ${property.key}="${newValue}"`;
                edit.insert(doc.uri, insertPos, insertion);
            }
        }
        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        }
        vscode.window.showInformationMessage(`Posodobljena lastnost ${property.key}: ${newValue}`);
    });
    // Ukaz za dodajanje entitete
    const addEntityCommand = vscode.commands.registerCommand('mauiXamlPreview.addEntity', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('Odprite XAML datoteko!');
            return;
        }
        const document = activeEditor.document;
        if (!document.fileName.endsWith('.xaml')) {
            vscode.window.showWarningMessage('Entitete lahko dodate samo v XAML datoteke!');
            return;
        }
        // Prikaz quick pick z entitetami
        const entities = entityManager.getAvailableEntities();
        const selectedEntity = await vscode.window.showQuickPick(entities.map(entity => ({
            label: entity.name,
            description: entity.description,
            detail: entity.category,
            entity: entity
        })), {
            placeHolder: 'Izberi MAUI element za dodajanje',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (selectedEntity) {
            const position = activeEditor.selection.active;
            const xamlCode = entityManager.generateXamlCode(selectedEntity.entity);
            await activeEditor.edit(editBuilder => {
                editBuilder.insert(position, xamlCode);
            });
            vscode.window.showInformationMessage(`Dodal sem ${selectedEntity.entity.name}!`);
        }
    });
    // Avtomatsko osveževanje preview-ja ob spremembah
    const onDidChangeDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.fileName.endsWith('.xaml')) {
            previewProvider.updatePreview(event.document);
        }
    });
    // Poslusjalec za spremembe aktivnega editorja
    const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.fileName.endsWith('.xaml')) {
            // Osveži properties panel za aktivno XAML datoteko
            setTimeout(() => {
                previewProvider.updatePreview(editor.document);
            }, 100);
        }
        updatePreviewStatusBar(editor);
    });
    // Registracija vseh dispozablov
    context.subscriptions.push(providerRegistration, propertiesTreeView, openPreviewCommand, editPropertyCommand, addEntityCommand, onDidChangeDocument, onDidChangeActiveEditor);
    // Avtomatsko odpiranje preview-ja če je XAML datoteka odprta
    if (vscode.window.activeTextEditor?.document.fileName.endsWith('.xaml')) {
        previewStatusBar.show();
        vscode.commands.executeCommand('mauiXamlPreview.openPreview');
    }
}
function deactivate() {
    console.log('MAUI XAML Preview extension se deaktivira...');
}
//# sourceMappingURL=extension.js.map