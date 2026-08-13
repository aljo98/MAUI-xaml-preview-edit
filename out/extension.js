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
const propertiesWebviewProvider_1 = require("./propertiesWebviewProvider");
const codeBehindProvider_1 = require("./codeBehindProvider");
const flowchartProvider_1 = require("./flowchartProvider");
const dependencyGraphProvider_1 = require("./dependencyGraphProvider");
const classHierarchyProvider_1 = require("./classHierarchyProvider");
const xamlCodeLensProvider_1 = require("./xamlCodeLensProvider");
const csharpParser_1 = require("./csharpParser");
const mockDataProvider_1 = require("./mockDataProvider");
async function activate(context) {
    console.log('MAUI XAML Preview extension je aktivna!');
    // Registracija preview providerja
    const previewProvider = new previewProvider_1.MauiXamlPreviewProvider(context.extensionUri);
    const providerRegistration = vscode.window.registerWebviewPanelSerializer('mauiXamlPreview', previewProvider);
    // Registracija sidebar providerjev
    const propertiesModule = await Promise.resolve().then(() => __importStar(require('./propertiesProvider')));
    const templatesProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'templates');
    const structureProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'structure');
    // Ensure providers have correct modes
    templatesProvider.setMode('templates');
    structureProvider.setMode('structure');
    // Properties panel: WebviewView (inline editing)
    const propsWebviewProvider = new propertiesWebviewProvider_1.PropertiesWebviewProvider(context.extensionUri);
    const regPropsWebview = vscode.window.registerWebviewViewProvider(propertiesWebviewProvider_1.PropertiesWebviewProvider.viewType, propsWebviewProvider);
    // Wire up inline webview changes to XAML code
    propsWebviewProvider.onPropertyChanged = async (property, newValue) => {
        previewProvider.updateElementProperty(property, newValue);
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml'))
            return;
        const doc = editor.document;
        const text = doc.getText();
        const keyPattern = property.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRegex = new RegExp(`${keyPattern}\\s*=\\s*"([^"]*)"`, 'i');
        const edit = new vscode.WorkspaceEdit();
        if (attrRegex.test(text)) {
            const match = attrRegex.exec(text);
            const start = doc.positionAt(match.index);
            const end = doc.positionAt(match.index + match[0].length);
            edit.replace(doc.uri, new vscode.Range(start, end), `${property.key}="${newValue}"`);
        }
        else {
            const openTag = new RegExp(`<${property.elementType}[^>]*>`, 'i').exec(text);
            if (openTag) {
                const insertPos = doc.positionAt(openTag.index + openTag[0].length - 1);
                edit.insert(doc.uri, insertPos, ` ${property.key}="${newValue}"`);
            }
        }
        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        }
    };
    propsWebviewProvider.onPropertyAdded = async (elementType, key, value) => {
        propsWebviewProvider.onPropertyChanged({ key, value, type: 'string', section: 'appearance', elementType }, value);
    };
    const templatesTreeView = vscode.window.createTreeView('mauiTemplates', {
        treeDataProvider: templatesProvider,
        showCollapseAll: false
    });
    const structureTreeView = vscode.window.createTreeView('mauiStructure', {
        treeDataProvider: structureProvider,
        showCollapseAll: true
    });
    const codeBehindProvider = new codeBehindProvider_1.CodeBehindProvider();
    const codeBehindTreeView = vscode.window.createTreeView('mauiCodeBehind', {
        treeDataProvider: codeBehindProvider,
        showCollapseAll: true
    });
    // Also register as TreeDataProviders explicitly (defensive) so VS Code always has a provider
    const regTemplates = vscode.window.registerTreeDataProvider('mauiTemplates', templatesProvider);
    const regStructure = vscode.window.registerTreeDataProvider('mauiStructure', structureProvider);
    const regCodeBehind = vscode.window.registerTreeDataProvider('mauiCodeBehind', codeBehindProvider);
    console.log('[Extension] Registered tree data providers for templates, structure, code behind, and webview for properties');
    // Povezava med preview in providerji
    previewProvider.setPropertiesWebviewProvider(propsWebviewProvider);
    previewProvider.setStructureProvider(structureProvider, structureTreeView);
    // Decoration type for highlighting selected elements v kodi
    const elementHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 220, 0, 0.32)',
        border: '2px solid rgba(255, 200, 0, 0.80)',
        borderRadius: '2px'
    });
    // Inicializacija entity managerja
    const entityManager = new entityManager_1.EntityManager();
    // Template manager
    const { TemplateManager } = await Promise.resolve().then(() => __importStar(require('./templateManager')));
    const templateManager = new TemplateManager(context.extensionUri);
    await templateManager.loadTemplates();
    templatesProvider.setTemplates(templateManager.getTemplates());
    templatesProvider.setDocumentTemplates(templateManager.getDocumentTemplates());
    // Force refresh so the view reflects templates immediately
    templatesProvider.refresh();
    // ensure registered disposables are tracked
    context.subscriptions.push(regPropsWebview, regTemplates, regStructure, regCodeBehind);
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
        let activeEditor = vscode.window.activeTextEditor;
        // Fallback: If focus was in the webview/treeview and activeEditor is null,
        // check visible editors for a XAML file.
        if (!activeEditor) {
            activeEditor = vscode.window.visibleTextEditors.find(e => e.document.fileName.toLowerCase().endsWith('.xaml'));
        }
        if (!activeEditor) {
            vscode.window.showWarningMessage('Odprite XAML datoteko za preview!');
            return;
        }
        const document = activeEditor.document;
        if (!document.fileName.toLowerCase().endsWith('.xaml')) {
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
    // NEW: Create template from selection command
    const createTemplateCommand = vscode.commands.registerCommand('mauiTemplates.createFromSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const selection = editor.selection;
        const text = editor.document.getText(selection).trim();
        if (!text) {
            vscode.window.showWarningMessage('Prosim izberite nekaj XAML kode.');
            return;
        }
        const name = await vscode.window.showInputBox({
            prompt: 'Ime novega predloga (Template Name)',
            placeHolder: 'npr. My Custom Button'
        });
        if (!name)
            return;
        await templateManager.saveTemplate(name, text);
        templatesProvider.setTemplates(templateManager.getTemplates());
        vscode.window.showInformationMessage(`Template '${name}' shranjen!`);
    });
    // NEW: Scaffold document from document template
    const scaffoldDocumentCommand = vscode.commands.registerCommand('mauiTemplates.scaffoldDocument', async () => {
        const docTemplates = templateManager.getDocumentTemplates();
        if (!docTemplates.length) {
            vscode.window.showWarningMessage('Ni na voljo dokumentnih predlog.');
            return;
        }
        // QuickPick with template selection
        const picked = await vscode.window.showQuickPick(docTemplates.map(t => ({
            label: t.name,
            description: `[${t.language.toUpperCase()}] ${t.category || ''}`,
            detail: t.description,
            template: t
        })), {
            placeHolder: 'Izberi dokumentno predlogo za scaffold',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!picked)
            return;
        const template = picked.template;
        // Collect variable values from user
        const values = {};
        for (const variable of template.variables) {
            const value = await vscode.window.showInputBox({
                prompt: variable.description || `Vnesi vrednost za ${variable.name}`,
                placeHolder: variable.default || variable.name,
                value: variable.default || ''
            });
            if (value === undefined)
                return; // User cancelled
            values[variable.name] = value;
        }
        // Resolve template with user values
        const resolvedContent = templateManager.resolveTemplate(template, values);
        // Determine file extension and language
        const langId = template.language === 'csharp' ? 'csharp' : 'xml';
        // Open as untitled document
        const doc = await vscode.workspace.openTextDocument({
            content: resolvedContent,
            language: langId
        });
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Dokumentna predloga '${template.name}' ustvarjena!`);
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
    // NEW: Select element by Code-Behind item command (from Code-Behind Inspector clicks)
    const selectElementByCodeCommand = vscode.commands.registerCommand('mauiCodeBehind.selectItem', async (item) => {
        try {
            await previewProvider.selectElementByCode(item.label, item.isCommand);
            // Navigate to C# Code-Behind or View Model
            if (item.filePath) {
                await openSymbolInFile(item.filePath, item.label);
            }
        }
        catch (err) {
            console.warn('selectElementByCodeCommand failed', err);
        }
    });
    async function openSymbolInFile(filePath, symbolName) {
        try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            // Try to find the symbol
            const regex = new RegExp(`\\b${symbolName}\\b`);
            const match = text.match(regex);
            if (match && match.index !== undefined) {
                const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                const position = doc.positionAt(match.index);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                return true;
            }
        }
        catch (e) {
            // File might not exist
        }
        return false;
    }
    // Avtomatsko osveževanje preview-ja ob spremembah (Hot Reload)
    let updateTimeout;
    const onDidChangeDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.fileName.endsWith('.xaml') && event.contentChanges.length > 0) {
            // Debounce logic: počakaj 300ms po zadnjem tipkanju
            if (updateTimeout) {
                clearTimeout(updateTimeout);
            }
            updateTimeout = setTimeout(() => {
                previewProvider.updatePreview(event.document);
            }, 300);
        }
    });
    // Poslusjalec za spremembe aktivnega editorja
    const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.fileName.endsWith('.xaml')) {
            // Posodobi context za Code-Behind Inspector
            const xamlText = editor.document.getText();
            const xDataTypeMatch = /x:DataType\s*=\s*"([^"]+)"/.exec(xamlText);
            const xDataType = xDataTypeMatch ? xDataTypeMatch[1] : undefined;
            codeBehindProvider.updateContext(editor.document.fileName, xDataType);
            // Osveži properties panel za aktivno XAML datoteko
            setTimeout(() => {
                previewProvider.updatePreview(editor.document);
            }, 100);
        }
        updatePreviewStatusBar(editor);
    });
    // NEW: Premik kurzorja v XAML → izberi ustrezen element (Debounced)
    let selectionTimeout;
    const onDidChangeSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
        const doc = e.textEditor?.document;
        if (!doc || !doc.fileName.toLowerCase().endsWith('.xaml'))
            return;
        if (selectionTimeout) {
            clearTimeout(selectionTimeout);
        }
        selectionTimeout = setTimeout(async () => {
            const line = e.selections[0]?.active.line ?? 0;
            await previewProvider.selectElementAtLine(line);
        }, 150); // 150ms debounce
    });
    // ── CodeLens: XAML ↔ ViewModel navigation ─────────────────────────────────
    const codeLensProvider = new xamlCodeLensProvider_1.XamlCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'xaml' }, codeLensProvider), vscode.languages.registerCodeLensProvider({ pattern: '**/*.xaml' }, codeLensProvider));
    (0, xamlCodeLensProvider_1.registerCodeLensCommands)(context);
    // ── Visualization commands ──────────────────────────────────────────────────
    const flowchartCommand = vscode.commands.registerCommand('mauiVisual.showFlowchart', () => flowchartProvider_1.FlowchartProvider.showFlowchartForCurrentMethod());
    const depGraphCommand = vscode.commands.registerCommand('mauiVisual.showDependencyGraph', () => dependencyGraphProvider_1.DependencyGraphProvider.show());
    const classHierarchyCommand = vscode.commands.registerCommand('mauiVisual.showClassHierarchy', () => classHierarchyProvider_1.ClassHierarchyProvider.showForCurrentFile());
    const generateMockCommand = vscode.commands.registerCommand('mauiXamlPreview.generateMockFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
            vscode.window.showWarningMessage('Odprite XAML datoteko za generiranje mock podatkov.');
            return;
        }
        const xamlPath = editor.document.fileName;
        const properties = csharpParser_1.CSharpParser.parseFile(`${xamlPath}.cs`);
        await new mockDataProvider_1.MockDataProvider().generateMockFile(xamlPath, properties);
    });
    // Registracija vseh dispozablov
    context.subscriptions.push(providerRegistration, templatesTreeView, structureTreeView, codeBehindTreeView, openPreviewCommand, editPropertyCommand, addPropertyCommand, addEntityCommand, insertTemplateCommand, createTemplateCommand, scaffoldDocumentCommand, selectElementByIdCommand, selectElementByCodeCommand, flowchartCommand, depGraphCommand, classHierarchyCommand, generateMockCommand, onDidChangeDocument, onDidChangeActiveEditor, onDidChangeSelection);
    // Avtomatsko odpiranje preview-ja če je XAML datoteka odprta
    if (vscode.window.activeTextEditor?.document.fileName.endsWith('.xaml')) {
        const initText = vscode.window.activeTextEditor.document.getText();
        const initXDataType = (/x:DataType\s*=\s*"([^"]+)"/.exec(initText))?.[1];
        codeBehindProvider.updateContext(vscode.window.activeTextEditor.document.fileName, initXDataType);
        previewStatusBar.show();
        vscode.commands.executeCommand('mauiXamlPreview.openPreview');
    }
}
function deactivate() {
    console.log('MAUI XAML Preview extension se deaktivira...');
}
//# sourceMappingURL=extension.js.map