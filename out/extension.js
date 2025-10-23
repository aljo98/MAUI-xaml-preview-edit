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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const previewProvider_1 = require("./previewProvider");
const entityManager_1 = require("./entityManager");
async function activate(context) {
    console.log('MAUI XAML Preview extension je aktivna!');
    // Registracija preview providerja
    const previewProvider = new previewProvider_1.MauiXamlPreviewProvider(context.extensionUri);
    const providerRegistration = vscode.window.registerWebviewPanelSerializer('mauiXamlPreview', previewProvider);
    // Registracija sidebar providerjev (3 ločeni pogledi kot pri GitHub Changes/Graph)
    const propertiesModule = await Promise.resolve().then(() => __importStar(require('./propertiesProvider')));
    const propertiesProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'props');
    const templatesProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'templates');
    const structureProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'structure');
    // Ensure providers have correct modes (defensive in case constructor defaulting changes)
    propertiesProvider.setMode('props');
    templatesProvider.setMode('templates');
    structureProvider.setMode('structure');
    const propertiesTreeView = vscode.window.createTreeView('mauiProperties', {
        treeDataProvider: propertiesProvider,
        showCollapseAll: false
    });
    const templatesTreeView = vscode.window.createTreeView('mauiTemplates', {
        treeDataProvider: templatesProvider,
        showCollapseAll: false
    });
    const structureTreeView = vscode.window.createTreeView('mauiStructure', {
        treeDataProvider: structureProvider,
        showCollapseAll: true
    });
    // Also register as TreeDataProviders explicitly (defensive) so VS Code always has a provider
    const regProps = vscode.window.registerTreeDataProvider('mauiProperties', propertiesProvider);
    const regTemplates = vscode.window.registerTreeDataProvider('mauiTemplates', templatesProvider);
    const regStructure = vscode.window.registerTreeDataProvider('mauiStructure', structureProvider);
    console.log('[Extension] Registered tree data providers for properties, templates and structure');
    // Povezava med preview in providerji
    previewProvider.setPropertiesProvider(propertiesProvider, propertiesTreeView);
    previewProvider.setStructureProvider(structureProvider, structureTreeView);
    // Decoration type for highlighting selected elements v kodi
    const elementHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 152, 0, 0.2)',
        border: '2px solid #ff9800',
        borderRadius: '4px'
    });
    // Inicializacija entity managerja
    const entityManager = new entityManager_1.EntityManager();
    // Template manager
    const { TemplateManager } = await Promise.resolve().then(() => __importStar(require('./templateManager')));
    const templateManager = new TemplateManager(context.extensionUri);
    await templateManager.loadTemplates();
    templatesProvider.setTemplates(templateManager.getTemplates());
    // Force refresh so the view reflects templates immediately
    templatesProvider.refresh();
    // ensure registered disposables are tracked
    context.subscriptions.push(regProps, regTemplates, regStructure);
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
        let newValue;
        const lowerKey = String(property.key || '').toLowerCase();
        const type = property.type || 'string';
        if (true) {
            newValue = await vscode.window.showInputBox({
                prompt: `Vnesi novo vrednost za ${property.key}`,
                value: property.value,
                placeHolder: property.value
            });
        }
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
    // Ukaz: Dodaj lastnost z iskanjem in predlogi (bindings, style, resources)
    const addPropertyCommand = vscode.commands.registerCommand('mauiProperties.addProperty', async (element) => {
        if (!element)
            return;
        // 1) Izberi ali vnesi ime lastnosti
        const baseSuggestions = [
            'Text', 'TextColor', 'BackgroundColor', 'FontSize', 'FontAttributes', 'FontFamily', 'LineHeight', 'CharacterSpacing', 'TextDecorations',
            'WidthRequest', 'HeightRequest', 'MinWidthRequest', 'MinHeightRequest', 'MaxWidthRequest', 'MaxHeightRequest',
            'Margin', 'Padding', 'CornerRadius', 'BorderColor', 'BorderThickness', 'Stroke', 'StrokeThickness', 'Opacity', 'IsVisible', 'IsEnabled',
            'HorizontalOptions', 'VerticalOptions', 'HorizontalTextAlignment', 'TextAlignment', 'Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan',
            'Style', 'ClassId'
        ];
        const pickedKey = await vscode.window.showQuickPick(baseSuggestions.map(x => ({ label: x })), {
            placeHolder: 'Izberi ali vnesi ime lastnosti (lahko začnete tipkati)'
        }) || { label: '' };
        const propertyKey = pickedKey.label || await vscode.window.showInputBox({
            prompt: 'Vnesi ime lastnosti (npr. BackgroundColor, Text, Style, …)'
        });
        if (!propertyKey)
            return;
        // 2) Hitre predloge za vrednost: Binding, StaticResource, Style
        const styles = previewProvider.getStyleSuggestions();
        const resources = previewProvider.getResourceKeySuggestions();
        const colors = previewProvider.getColorSuggestions();
        const quickTemplates = [
            { label: 'Binding…', description: 'Ustvari {Binding ...}', tpl: '{Binding Path=MyProperty}' },
            { label: 'StaticResource…', description: 'Ustvari {StaticResource ...}', tpl: '{StaticResource }' },
            { label: 'Style…', description: 'Uporabi Style iz ResourceDictionary', tpl: '' },
            { label: 'Barva…', description: 'Izberi barvo ali vnesi HEX', tpl: '' }
        ];
        const tmplPick = await vscode.window.showQuickPick(quickTemplates, { placeHolder: 'Izberi predlogo vrednosti ali preskoči za ročni vnos' });
        let value;
        if (tmplPick?.label === 'Binding…') {
            value = await vscode.window.showInputBox({ prompt: 'Vnesi Binding (npr. Path=MyProperty, Mode=TwoWay)' }).then(v => v ? `{Binding ${v}}` : undefined);
        }
        else if (tmplPick?.label === 'StaticResource…') {
            const resPick = await vscode.window.showQuickPick(resources.map(r => ({ label: r })), { placeHolder: 'Izberi ključ resource' });
            value = resPick?.label ? `{StaticResource ${resPick.label}}` : await vscode.window.showInputBox({ prompt: 'Vnesi ključ za {StaticResource ...}' }).then(v => v ? `{StaticResource ${v}}` : undefined);
        }
        else if (tmplPick?.label === 'Style…') {
            const stylePick = await vscode.window.showQuickPick(styles.map(s => ({ label: s })), { placeHolder: 'Izberi StyleKey' });
            value = stylePick?.label;
        }
        else if (tmplPick?.label === 'Barva…') {
            const colorPick = await vscode.window.showQuickPick(colors.map(c => ({ label: c })), { placeHolder: 'Izberi barvo ali pritisni Esc za ročni vnos' });
            value = colorPick?.label || await vscode.window.showInputBox({ prompt: 'Vnesi barvo (#hex, rgb(), ime ali {StaticResource ...})' });
        }
        else {
            value = await vscode.window.showInputBox({ prompt: `Vnesi vrednost za ${propertyKey}` });
        }
        if (!value)
            return;
        // 3) Posodobi DOM v webview-u (če je na voljo elementType iz obstoječega propertyja, sicer best-effort)
        const bestEffortProperty = { key: propertyKey, value, type: 'string', section: 'appearance', elementType: element.type };
        previewProvider.updateElementProperty(bestEffortProperty, value);
        // 4) Vstavi ali zamenjaj atribut v XAML
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
            vscode.window.showInformationMessage(`Dodana lastnost ${propertyKey}: ${value}`);
            return;
        }
        const doc = editor.document;
        const text = doc.getText();
        const keyPattern = propertyKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRegex = new RegExp(`${keyPattern}\\s*=\\s*"([^"]*)"`, 'i');
        const edit = new vscode.WorkspaceEdit();
        if (attrRegex.test(text)) {
            const match = attrRegex.exec(text);
            const idx = match.index;
            const start = doc.positionAt(idx);
            const end = doc.positionAt(idx + match[0].length);
            const newAttr = `${propertyKey}="${value}"`;
            edit.replace(doc.uri, new vscode.Range(start, end), newAttr);
        }
        else {
            const openTag = new RegExp(`<${element.type}[^>]*>`, 'i').exec(text);
            if (openTag) {
                const insertPos = doc.positionAt(openTag.index + openTag[0].length - 1);
                const insertion = ` ${propertyKey}="${value}"`;
                edit.insert(doc.uri, insertPos, insertion);
            }
        }
        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        }
        vscode.window.showInformationMessage(`Dodana lastnost ${propertyKey}: ${value}`);
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
    // NEW: Insert template example command
    const insertTemplateCommand = vscode.commands.registerCommand('mauiTemplates.insertTemplate', async (template) => {
        if (!template)
            return;
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
            vscode.window.showWarningMessage('Odprite XAML datoteko, da vstavite template.');
            return;
        }
        const pos = editor.selection.active;
        await editor.edit(edit => edit.insert(pos, `\n${template.xaml}\n`));
        await editor.document.save();
        vscode.window.showInformationMessage(`Vstavljen template: ${template.name}`);
        // osveži preview
        previewProvider.updatePreview(editor.document);
    });
    // NEW: Select element by ID command (from Structure tree clicks)
    const selectElementByIdCommand = vscode.commands.registerCommand('mauiDesigner.selectElementById', async (elementId) => {
        try {
            await previewProvider.selectElementById(elementId);
        }
        catch (err) {
            console.warn('selectElementById failed', err);
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
    // NEW: Premik kurzorja v XAML → izberi ustrezen element
    const onDidChangeSelection = vscode.window.onDidChangeTextEditorSelection(async (e) => {
        const doc = e.textEditor?.document;
        if (!doc || !doc.fileName.toLowerCase().endsWith('.xaml'))
            return;
        const line = e.selections[0]?.active.line ?? 0;
        await previewProvider.selectElementAtLine(line);
    });
    // Registracija vseh dispozablov
    context.subscriptions.push(providerRegistration, propertiesTreeView, templatesTreeView, structureTreeView, openPreviewCommand, editPropertyCommand, addPropertyCommand, addEntityCommand, insertTemplateCommand, selectElementByIdCommand, onDidChangeDocument, onDidChangeActiveEditor, onDidChangeSelection);
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