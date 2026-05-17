import * as vscode from 'vscode';
import * as path from 'path';
import { MauiXamlPreviewProvider } from './previewProvider';
import { EntityManager } from './entityManager';
import { PropertiesWebviewProvider } from './propertiesWebviewProvider';
import { CodeBehindProvider } from './codeBehindProvider';
import { MauiCompletionProvider } from './completionProvider';
import { emulatorManager, EmulatorDevice } from './emulatorManager';
import { ScreenshotManager } from './screenshotManager';
import { MauiMcpServer } from './mcpServer';

let mcpServerInstance: MauiMcpServer | undefined;

/**
 * Safely edit or insert an attribute ONLY within the opening tag of the selected element.
 * Uses element line range from previewProvider._elementMap to avoid touching other elements.
 */
function safeEditAttribute(
    doc: vscode.TextDocument,
    elementId: string,
    elementType: string,
    key: string,
    value: string,
    elementRange: { startLine: number; endLine: number } | undefined
): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    const text = doc.getText();

    // Determine search bounds: restrict to element line range if available
    let searchStart = 0;
    let searchEnd = text.length;
    if (elementRange) {
        searchStart = doc.offsetAt(new vscode.Position(elementRange.startLine, 0));
        // endLine + 2 extra lines as buffer for multi-line opening tags
        const endLine = Math.min(elementRange.endLine + 2, doc.lineCount - 1);
        searchEnd = doc.offsetAt(new vscode.Position(endLine, Number.MAX_SAFE_INTEGER));
    }

    const scopedText = text.slice(searchStart, searchEnd);
    const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const attrRegex = new RegExp(`${keyPattern}\\s*=\\s*"([^"]*)"`, 'i');
    const match = attrRegex.exec(scopedText);

    if (match) {
        const absIdx = searchStart + match.index;
        const start = doc.positionAt(absIdx);
        const end = doc.positionAt(absIdx + match[0].length);
        edit.replace(doc.uri, new vscode.Range(start, end), `${key}="${value}"`);
    } else {
        // Insert into the opening tag of the element within scoped range
        const openTagRegex = new RegExp(`<${elementType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s>]`, 'i');
        const tagMatch = openTagRegex.exec(scopedText);
        if (tagMatch) {
            // Find the end of the opening tag (before > or />)
            const tagStart = searchStart + tagMatch.index;
            const closeIdx = text.indexOf('>', tagStart);
            if (closeIdx !== -1) {
                const isSelfClose = text[closeIdx - 1] === '/';
                const insertOffset = isSelfClose ? closeIdx - 1 : closeIdx;
                const insertPos = doc.positionAt(insertOffset);
                edit.insert(doc.uri, insertPos, `\n    ${key}="${value}"`);
            }
        }
    }
    return edit;
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('MAUI XAML Preview extension je aktivna!');

    // Registracija preview providerja
    const previewProvider = new MauiXamlPreviewProvider(context.extensionUri);
    const providerRegistration = vscode.window.registerWebviewPanelSerializer(
        'mauiXamlPreview',
        previewProvider
    );

    // Registracija sidebar providerjev
    const propertiesModule = await import('./propertiesProvider');
    const templatesProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'templates');
    const structureProvider = new propertiesModule.MauiPropertiesProvider(context.extensionUri, 'structure');

    // Ensure providers have correct modes
    templatesProvider.setMode('templates');
    structureProvider.setMode('structure');

    // Properties panel: WebviewView (inline editing)
    const propsWebviewProvider = new PropertiesWebviewProvider(context.extensionUri);
    const regPropsWebview = vscode.window.registerWebviewViewProvider(
        PropertiesWebviewProvider.viewType,
        propsWebviewProvider
    );

    // Wire up inline webview changes to XAML code
    propsWebviewProvider.onPropertyChanged = async (property, newValue) => {
        previewProvider.updateElementProperty(property as any, newValue);

        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) return;

        const doc = editor.document;
        const elementRange = property.elementId
            ? previewProvider.getElementRange(property.elementId)
            : undefined;
        const edit = safeEditAttribute(doc, property.elementId || '', property.elementType || '', property.key, newValue, elementRange);
        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        }
    };

    propsWebviewProvider.onPropertyAdded = async (elementType, key, value) => {
        propsWebviewProvider.onPropertyChanged!({ key, value, type: 'string', section: 'appearance', elementType } as any, value);
    };

    const templatesTreeView = vscode.window.createTreeView('mauiTemplates', {
        treeDataProvider: templatesProvider,
        showCollapseAll: false
    });
    const structureTreeView = vscode.window.createTreeView('mauiStructure', {
        treeDataProvider: structureProvider,
        showCollapseAll: true
    });

    const codeBehindProvider = new CodeBehindProvider();
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

    // Tree view selection handlers - ensure clicking tree items selects elements in preview
    structureTreeView.onDidChangeSelection((e) => {
        const selected = e.selection[0];
        if (selected && selected.contextValue === 'element') {
            const elementId = (selected as any).elementId;
            if (elementId) {
                previewProvider.selectElementById(elementId);
            }
        }
    });

    // Webview message handlers for screenshot functionality
    previewProvider.addMessageCallback(async (message) => {
        const screenshotMgr = new (await import('./screenshotManager')).ScreenshotManager(context);

        if (message.type === 'requestScreenshot' && message.dataUrl) {
            // Screenshot from webview with base64 image data
            const result = await screenshotMgr.savePreviewScreenshot(message.dataUrl, 'preview');
            if (result.success) {
                vscode.window.showInformationMessage(`📸 Screenshot shranjen: ${path.basename(result.path!)}`);
                // Odpri sliko
                const doc = await vscode.workspace.openTextDocument(result.path!);
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Three });
            } else {
                vscode.window.showErrorMessage(`Napaka pri screenshot: ${result.error}`);
            }
        } else if (message.type === 'saveHtml') {
            const html = previewProvider.getCurrentHtml();
            if (!html) {
                vscode.window.showWarningMessage('Najprej odpri XAML preview!');
                return;
            }

            const result = await screenshotMgr.getPreviewHtml(html);
            if (result.success) {
                vscode.window.showInformationMessage(`HTML shranjen: ${path.basename(result.path!)}`);
                // Odpri HTML
                const doc = await vscode.workspace.openTextDocument(result.path!);
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Three });
            } else {
                vscode.window.showErrorMessage(`Napaka: ${result.error}`);
            }
        } else if (message.type === 'showError') {
            vscode.window.showErrorMessage(message.message || 'Neznana napaka');
        }
    });

    // Decoration type for highlighting selected elements v kodi
    const elementHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 255, 0, 0.15)', // Zelo prozorno rumeno
        border: '1px solid rgba(255, 255, 0, 0.4)',
        borderRadius: '2px'
    });

    // Inicializacija entity managerja
    const entityManager = new EntityManager();

    // Template manager
    const { TemplateManager } = await import('./templateManager');
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

    const updatePreviewStatusBar = (editor?: vscode.TextEditor | null) => {
        const targetEditor = editor ?? vscode.window.activeTextEditor;
        if (targetEditor && targetEditor.document.fileName.toLowerCase().endsWith('.xaml')) {
            previewStatusBar.show();
        } else {
            previewStatusBar.hide();
        }
    };

    updatePreviewStatusBar(vscode.window.activeTextEditor);

    // Ukaz za odpiranje preview-ja
    const openPreviewCommand = vscode.commands.registerCommand(
        'mauiXamlPreview.openPreview',
        () => {
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
        }
    );

    // Ukaz za urejanje lastnosti
    const editPropertyCommand = vscode.commands.registerCommand('mauiProperties.editProperty', async (property: any) => {
        if (!property) return;

        let newValue: string | undefined;

        const lowerKey = String(property.key || '').toLowerCase();
        const type: string = property.type || 'string';

        if (true) {
            newValue = await vscode.window.showInputBox({
                prompt: `Vnesi novo vrednost za ${property.key}`,
                value: property.value,
                placeHolder: property.value
            });
        }

        if (newValue === undefined) return;

        // 1) Posodobi DOM v webview-u
        previewProvider.updateElementProperty(property, newValue);

        // 2) Posodobi XAML kodo - varno samo v dosegu izbranega elementa
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
            vscode.window.showInformationMessage(`Posodobljena lastnost ${property.key}: ${newValue}`);
            return;
        }

        const doc = editor.document;
        const elementRange = property.elementId
            ? previewProvider.getElementRange(property.elementId)
            : undefined;
        const edit = safeEditAttribute(doc, property.elementId || '', property.elementType || '', property.key, newValue, elementRange);

        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        } else {
            vscode.window.showWarningMessage(`Lastnosti ${property.key} ni bilo mogoče posodobiti v izbranem elementu.`);
        }

        vscode.window.showInformationMessage(`Posodobljena lastnost ${property.key}: ${newValue}`);
    });

    // Ukaz: Dodaj lastnost z iskanjem in predlogi (bindings, style, resources)
    const addPropertyCommand = vscode.commands.registerCommand('mauiProperties.addProperty', async (element: any) => {
        if (!element) return;

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
        if (!propertyKey) return;

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
        let value: string | undefined;

        if (tmplPick?.label === 'Binding…') {
            value = await vscode.window.showInputBox({ prompt: 'Vnesi Binding (npr. Path=MyProperty, Mode=TwoWay)' }).then(v => v ? `{Binding ${v}}` : undefined);
        } else if (tmplPick?.label === 'StaticResource…') {
            const resPick = await vscode.window.showQuickPick(resources.map(r => ({ label: r })), { placeHolder: 'Izberi ključ resource' });
            value = resPick?.label ? `{StaticResource ${resPick.label}}` : await vscode.window.showInputBox({ prompt: 'Vnesi ključ za {StaticResource ...}' }).then(v => v ? `{StaticResource ${v}}` : undefined);
        } else if (tmplPick?.label === 'Style…') {
            const stylePick = await vscode.window.showQuickPick(styles.map(s => ({ label: s })), { placeHolder: 'Izberi StyleKey' });
            value = stylePick?.label;
        } else if (tmplPick?.label === 'Barva…') {
            const colorPick = await vscode.window.showQuickPick(colors.map(c => ({ label: c })), { placeHolder: 'Izberi barvo ali pritisni Esc za ročni vnos' });
            value = colorPick?.label || await vscode.window.showInputBox({ prompt: 'Vnesi barvo (#hex, rgb(), ime ali {StaticResource ...})' });
        } else {
            value = await vscode.window.showInputBox({ prompt: `Vnesi vrednost za ${propertyKey}` });
        }

        if (!value) return;

        // 3) Posodobi DOM v webview-u (če je na voljo elementType iz obstoječega propertyja, sicer best-effort)
        const bestEffortProperty = { key: propertyKey, value, type: 'string', section: 'appearance', elementType: element.type };
        previewProvider.updateElementProperty(bestEffortProperty as any, value);

        // 4) Vstavi ali zamenjaj atribut v XAML - varno samo v dosegu izbranega elementa
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
            vscode.window.showInformationMessage(`Dodana lastnost ${propertyKey}: ${value}`);
            return;
        }

        const doc = editor.document;
        const elementRange = element.elementId
            ? previewProvider.getElementRange(element.elementId)
            : undefined;
        const edit = safeEditAttribute(doc, element.elementId || '', element.type || '', propertyKey, value, elementRange);

        if (edit.size > 0) {
            await vscode.workspace.applyEdit(edit);
            await doc.save();
        } else {
            vscode.window.showWarningMessage(`Lastnosti ${propertyKey} ni bilo mogoče dodati v izbrani element.`);
        }

        vscode.window.showInformationMessage(`Dodana lastnost ${propertyKey}: ${value}`);
    });

    // Ukaz za dodajanje entitete
    const addEntityCommand = vscode.commands.registerCommand(
        'mauiXamlPreview.addEntity',
        async () => {
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
            const selectedEntity = await vscode.window.showQuickPick(
                entities.map(entity => ({
                    label: entity.name,
                    description: entity.description,
                    detail: entity.category,
                    entity: entity
                })),
                {
                    placeHolder: 'Izberi MAUI element za dodajanje',
                    matchOnDescription: true,
                    matchOnDetail: true
                }
            );

            if (selectedEntity) {
                const position = activeEditor.selection.active;
                const xamlCode = entityManager.generateXamlCode(selectedEntity.entity);

                await activeEditor.edit(editBuilder => {
                    editBuilder.insert(position, xamlCode);
                });

                vscode.window.showInformationMessage(`Dodal sem ${selectedEntity.entity.name}!`);
            }
        }
    );

    // NEW: Insert template example command
    const insertTemplateCommand = vscode.commands.registerCommand('mauiTemplates.insertTemplate', async (template: any) => {
        if (!template) return;
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
        if (!editor) return;

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

        if (!name) return;

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
        const picked = await vscode.window.showQuickPick(
            docTemplates.map(t => ({
                label: t.name,
                description: `[${t.language.toUpperCase()}] ${t.category || ''}`,
                detail: t.description,
                template: t
            })),
            {
                placeHolder: 'Izberi dokumentno predlogo za scaffold',
                matchOnDescription: true,
                matchOnDetail: true
            }
        );

        if (!picked) return;
        const template = picked.template;

        // Collect variable values from user
        const values: Record<string, string> = {};
        for (const variable of template.variables) {
            const value = await vscode.window.showInputBox({
                prompt: variable.description || `Vnesi vrednost za ${variable.name}`,
                placeHolder: variable.default || variable.name,
                value: variable.default || ''
            });
            if (value === undefined) return; // User cancelled
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
    const selectElementByIdCommand = vscode.commands.registerCommand('mauiDesigner.selectElementById', async (elementId: string) => {
        try {
            await previewProvider.selectElementById(elementId);
        } catch (err) {
            console.warn('selectElementById failed', err);
        }
    });

    // NEW: Select element by Code-Behind item command (from Code-Behind Inspector clicks)
    const selectElementByCodeCommand = vscode.commands.registerCommand('mauiCodeBehind.selectItem', async (item: import('./codeBehindProvider').CodeBehindTreeItem) => {
        try {
            await previewProvider.selectElementByCode(item.label, item.isCommand);

            // Navigate to C# Code-Behind or View Model
            if (item.filePath) {
                await openSymbolInFile(item.filePath, item.label);
            }
        } catch (err) {
            console.warn('selectElementByCodeCommand failed', err);
        }
    });

    async function openSymbolInFile(filePath: string, symbolName: string): Promise<boolean> {
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
        } catch (e) {
            // File might not exist
        }
        return false;
    }

    // Debounce optimization: Immediate update on save, delayed on typing
    let saveTimeout: NodeJS.Timeout | undefined;
    const onDidChangeDocument = vscode.workspace.onDidChangeTextDocument(
        (event) => {
            if (!event.document.fileName.toLowerCase().endsWith('.xaml')) return;

            // Check if this is a save operation (full document change) vs typing
            const isTyping = event.contentChanges.length > 0;

            if (saveTimeout) clearTimeout(saveTimeout);

            if (isTyping) {
                // Quick response for typing (debounce 100ms)
                saveTimeout = setTimeout(() => {
                    previewProvider.updatePreview(event.document);
                }, 100);
            } else {
                // Immediate update on save
                previewProvider.updatePreview(event.document);
            }
        }
    );

    // Throttle: Only update if not already pending
    let pendingUpdate: vscode.TextDocument | null = null;
    const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.toLowerCase().endsWith('.xaml')) {
            previewProvider.updatePreview(doc);
        }
    });

    // Poslusjalec za spremembe aktivnega editorja
    const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
            if (editor && editor.document.fileName.toLowerCase().endsWith('.xaml')) {
                // Posodobi context za Code-Behind Inspector
                codeBehindProvider.updateContext(editor.document.fileName);

                // Osveži properties panel za aktivno XAML datoteko
                setTimeout(() => {
                    previewProvider.updatePreview(editor.document);
                }, 100);
            }
            updatePreviewStatusBar(editor);
        }
    );

    // NEW: Premik kurzorja v XAML → izberi ustrezen element (Debounced - optimized)
    let selectionTimeout: NodeJS.Timeout | undefined;
    let lastSelectedLine = -1;
    const onDidChangeSelection = vscode.window.onDidChangeTextEditorSelection((e) => {
        const doc = e.textEditor?.document;
        if (!doc || !doc.fileName.toLowerCase().endsWith('.xaml')) return;

        const line = e.selections[0]?.active.line ?? 0;
        // Skip if same line (avoid redundant updates)
        if (line === lastSelectedLine) return;
        lastSelectedLine = line;

        if (selectionTimeout) clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(async () => {
            await previewProvider.selectElementAtLine(line);
        }, 50); // 50ms debounce - optimized for responsiveness
    });

    // Completion Provider za XAML IntelliSense
    const completionProvider = new MauiCompletionProvider();
    const completionRegistration = vscode.languages.registerCompletionItemProvider(
        { language: 'xml', scheme: 'file' },
        completionProvider,
        '<', ' ', '.', '{', ':', '='
    );

    // ═══════════════════════════════════════════════════════════════════════════════
    // EMULATOR COMMANDS - Testiranje aplikacije na emulatorju
    // ═══════════════════════════════════════════════════════════════════════════════

    // Ukaz: Prikaži seznam emulatorjev
    const listEmulatorsCommand = vscode.commands.registerCommand('mauiEmulator.listDevices', async () => {
        const devices = await emulatorManager.listDevices();

        if (devices.length === 0) {
            vscode.window.showWarningMessage('Ni najdenih emulatorjev. Preveri ali teče Android emulator.');
            return;
        }

        const items = devices.map(d => ({
            label: d.state === 'ready' ? '🟢 ' : d.state === 'booting' ? '🟡 ' : '🔴 ',
            description: d.name,
            detail: `ID: ${d.id} | Platforma: ${d.platform}`,
            device: d
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Izberi emulator za testiranje'
        });

        if (selected) {
            vscode.window.showInformationMessage(
                `Izbran emulator: ${selected.device.name} (${selected.device.id})`
            );
        }
    });

    // Ukaz: Zaženi emulator
    const startEmulatorCommand = vscode.commands.registerCommand('mauiEmulator.start', async () => {
        const avds = await emulatorManager.listAVDs();

        if (avds.length === 0) {
            vscode.window.showWarningMessage('Ni najdenih AVD. Ustvari emulator v Android Studio.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            avds.map(avd => ({ label: avd, description: 'Android emulator' })),
            { placeHolder: 'Izberi emulator za zagon' }
        );

        if (selected) {
            const success = await emulatorManager.startEmulator(selected.label);
            if (success) {
                vscode.window.showInformationMessage(`Emulator ${selected.label} se začenja...`);
            }
        }
    });

    // Ukaz: Poveži na Metro (Hot Reload)
    const connectMetroCommand = vscode.commands.registerCommand('mauiEmulator.connectMetro', async () => {
        const devices = await emulatorManager.listDevices();
        const readyDevices = devices.filter(d => d.state === 'ready');

        if (readyDevices.length === 0) {
            vscode.window.showWarningMessage('Noben emulator ni pripravljen. Zaženi emulator najprej.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            readyDevices.map(d => ({ label: d.name, description: d.id, device: d })),
            { placeHolder: 'Izberi emulator za Metro povezavo' }
        );

        if (selected) {
            const connection = await emulatorManager.connectToMetro(selected.device.id);
            if (connection) {
                vscode.window.showInformationMessage(`Povezava z Metro vzpostavljena! URL: ${connection.url}`);
            } else {
                vscode.window.showWarningMessage('Napaka pri povezovanju na Metro. Preveri ali app teče.');
            }
        }
    });

    // Ukaz: Preveri status Metro
    const checkMetroStatusCommand = vscode.commands.registerCommand('mauiEmulator.checkMetro', async () => {
        const isRunning = await emulatorManager.checkMetroStatus();

        if (isRunning) {
            vscode.window.showInformationMessage('✅ Metro je dostopen na localhost:9988');
        } else {
            vscode.window.showWarningMessage('❌ Metro ni dostopen. Zaženi app z Hot Reload v VS.');
        }
    });

    // Ukaz: Restart ADB
    const restartAdbCommand = vscode.commands.registerCommand('mauiEmulator.restartAdb', async () => {
        const success = await emulatorManager.restartAdb();
        if (success) {
            vscode.window.showInformationMessage('ADB ponovno zagnan.');
        } else {
            vscode.window.showWarningMessage('Napaka pri restartanju ADB.');
        }
    });

    // Ukaz: Info o napravi
    const deviceInfoCommand = vscode.commands.registerCommand('mauiEmulator.deviceInfo', async () => {
        const devices = await emulatorManager.listDevices();
        const readyDevices = devices.filter(d => d.state === 'ready');

        if (readyDevices.length === 0) {
            vscode.window.showWarningMessage('Noben emulator ni pripravljen.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            readyDevices.map(d => ({ label: d.name, description: d.id, device: d }))
        );

        if (selected) {
            const info = await emulatorManager.getDeviceInfo(selected.device.id);
            if (info) {
                vscode.window.showInformationMessage(
                    `📱 ${info.model}\n📌 Android ${info.os} (API ${info.api})`
                );
            }
        }
    });

    // Status bar za emulator
    const emulatorStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
    emulatorStatusBar.text = '$(device-mobile) Emulator';
    emulatorStatusBar.tooltip = 'MAUI Emulator kontrolnik';
    emulatorStatusBar.command = 'mauiEmulator.listDevices';

    // Osveži status bar ob spremembah
    const updateEmulatorStatus = async () => {
        const devices = await emulatorManager.listDevices();
        const readyCount = devices.filter(d => d.state === 'ready').length;
        if (readyCount > 0) {
            emulatorStatusBar.text = `$(device-mobile) Emulator: ${readyCount} pripravljen`;
            emulatorStatusBar.show();
        } else {
            emulatorStatusBar.text = '$(device-mobile) Emulator: Ni povezan';
            emulatorStatusBar.show();
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // SCREENSHOT MANAGER - Screenshots & HTML Inspection
    // ═══════════════════════════════════════════════════════════════════════════════
    const screenshotManager = new ScreenshotManager(context);

    // Ukaz: Screenshot iz emulatorja
    const deviceScreenshotCommand = vscode.commands.registerCommand('mauiScreenshot.deviceCapture', async () => {
        const result = await screenshotManager.captureDeviceScreenshot();
        if (result.success) {
            vscode.window.showInformationMessage(`📱 Screenshot shranjen: ${path.basename(result.path!)}`);
            // Odpri sliko
            const doc = await vscode.workspace.openTextDocument(result.path!);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Three });
        } else {
            vscode.window.showErrorMessage(`Napaka: ${result.error}`);
        }
    });

    // Ukaz: Screenshot iz preview-ja (preko webview messaging)
    const previewScreenshotCommand = vscode.commands.registerCommand('mauiScreenshot.previewCapture', async () => {
        // Pošlji sporočilo v webview da naredi screenshot
        const panel = vscode.window.visibleTextEditors.length > 0 ?
            vscode.window.activeTextEditor : undefined;

        if (panel) {
            vscode.window.showInformationMessage('📸 Screenshot preview-ja - klikni gumb v preview oknu ali uporabi Ctrl+Shift+P → "Capture Preview Screenshot"');
        }

        // Odpri screenshots folder
        screenshotManager.openScreenshotsFolder();
    });

    // Ukaz: Prikaži generirani HTML
    const showHtmlCommand = vscode.commands.registerCommand('mauiScreenshot.showHtml', async () => {
        const html = previewProvider.getCurrentHtml();
        if (!html) {
            vscode.window.showWarningMessage('Najprej odpri XAML preview!');
            return;
        }

        // Analiziraj HTML
        const structure = screenshotManager.analyzeHtmlStructure(html);
        const styles = screenshotManager.extractStyles(html);

        // Shrani HTML
        const result = await screenshotManager.getPreviewHtml(html);
        if (result.success) {
            // Odpri HTML
            const doc = await vscode.workspace.openTextDocument(result.path!);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Three });

            // Prikaži analizo
            const analysis = `HTML Analysis:\n\nTop Elements:\n` +
                structure.slice(0, 10).map(s => `  ${s.tag}: ${s.count}x`).join('\n') +
                `\n\nCSS Blocks: ${styles.length}`;
            vscode.window.showInformationMessage(analysis);
        }
    });

    // Ukaz: Primerjaj preview in device screenshots
    const compareScreenshotsCommand = vscode.commands.registerCommand('mauiScreenshot.compare', async () => {
        const screenshots = screenshotManager.listScreenshots();

        const previewScreenshots = screenshots.filter(s => s.name.includes('preview'));
        const deviceScreenshots = screenshots.filter(s => s.name.includes('device'));

        if (previewScreenshots.length === 0) {
            vscode.window.showWarningMessage('Ni preview screenshotov. Najprej naredi screenshot preview-ja.');
            return;
        }
        if (deviceScreenshots.length === 0) {
            vscode.window.showWarningMessage('Ni device screenshotov. Najprej naredi screenshot iz emulatorja.');
            return;
        }

        // Izberi preview
        const selectedPreview = await vscode.window.showQuickPick(
            previewScreenshots.map(s => ({
                label: path.basename(s.path),
                description: s.date.toLocaleString(),
                path: s.path
            })),
            { placeHolder: 'Izberi preview screenshot' }
        );

        if (!selectedPreview) return;

        // Izberi device
        const selectedDevice = await vscode.window.showQuickPick(
            deviceScreenshots.map(s => ({
                label: path.basename(s.path),
                description: s.date.toLocaleString(),
                path: s.path
            })),
            { placeHolder: 'Izberi device screenshot' }
        );

        if (!selectedDevice) return;

        // Odpri primerjavo
        const result = await screenshotManager.compareScreenshots(selectedPreview.path, selectedDevice.path);
        if (result) {
            vscode.window.showInformationMessage('📊 Side-by-side primerjava odprta v novih oknih.');
        }
    });

    // Ukaz: Analiziraj razlike med preview in realno app
    const analyzeDifferencesCommand = vscode.commands.registerCommand('mauiScreenshot.analyzeDifferences', async () => {
        const html = previewProvider.getCurrentHtml();
        if (!html) {
            vscode.window.showWarningMessage('Najprej odpri XAML preview!');
            return;
        }

        const structure = screenshotManager.analyzeHtmlStructure(html);
        const styles = screenshotManager.extractStyles(html);
        const inlineStyles = screenshotManager.extractInlineStyles(html);

        // Pripravi poročilo
        const report = `# HTML/Preview Analysis

## Element Structure
${structure.slice(0, 20).map(s => `- \`<${s.tag}>\`: ${s.count}x`).join('\n')}

## CSS Styles (${styles.length} blocks)
${styles.map((s, i) => `### Block ${i + 1}\n\`\`\`css\n${s.slice(0, 500)}...\n\`\`\``).join('\n\n')}

## Inline Styles (${inlineStyles.length} total)
Common properties:
${JSON.stringify(
            Object.entries(
                inlineStyles.flatMap(s => Object.keys(s))
                    .reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>)
            ).sort((a, b) => b[1] - a[1]).slice(0, 15)
            , null, 2)}

## Common Rendering Differences

1. **Font Rendering**: MAUI uses native fonts, HTML uses web fonts
2. **Colors**: MAUI colors may differ from CSS hex values
3. **Layout**: Flexbox vs MAUI LayoutOptions behave differently
4. **Images**: MAUI images load from local paths, HTML from relative URLs
`;

        // Shrani poročilo
        const reportPath = path.join(context.globalStorageUri.fsPath, 'analysis-report.md');
        require('fs').writeFileSync(reportPath, report);

        const doc = await vscode.workspace.openTextDocument(reportPath);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Three });
    });

    // Ukaz: Odpri screenshots folder
    const openScreenshotsFolderCommand = vscode.commands.registerCommand('mauiScreenshot.openFolder', () => {
        screenshotManager.openScreenshotsFolder();
    });

    // Ukaz: Seznam screenshotov
    const listScreenshotsCommand = vscode.commands.registerCommand('mauiScreenshot.list', async () => {
        const screenshots = screenshotManager.listScreenshots();

        if (screenshots.length === 0) {
            vscode.window.showInformationMessage('Ni screenshotov. Maps: ' + screenshotManager['_screenshotsDir']);
            return;
        }

        const items = screenshots.slice(0, 20).map(s => ({
            label: s.name,
            description: s.date.toLocaleString(),
            path: s.path
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Izberi screenshot za odpiranje'
        });

        if (selected) {
            const doc = await vscode.workspace.openTextDocument(selected.path);
            await vscode.window.showTextDocument(doc);
        }
    });

    // Registracija vseh dispozablov
    context.subscriptions.push(
        providerRegistration,
        templatesTreeView,
        structureTreeView,
        codeBehindTreeView,
        completionRegistration,
        openPreviewCommand,
        editPropertyCommand,
        addPropertyCommand,
        addEntityCommand,
        insertTemplateCommand,
        createTemplateCommand,
        scaffoldDocumentCommand,
        selectElementByIdCommand,
        selectElementByCodeCommand,
        listEmulatorsCommand,
        startEmulatorCommand,
        connectMetroCommand,
        checkMetroStatusCommand,
        restartAdbCommand,
        deviceInfoCommand,
        deviceScreenshotCommand,
        previewScreenshotCommand,
        showHtmlCommand,
        compareScreenshotsCommand,
        analyzeDifferencesCommand,
        openScreenshotsFolderCommand,
        listScreenshotsCommand,
        emulatorStatusBar,
        onDidSaveDocument,
        onDidChangeDocument,
        onDidChangeActiveEditor,
        onDidChangeSelection
    );

    // Avtomatsko posodobi status bar
    updateEmulatorStatus().catch(console.error);

    // NEW: Copy AI Design Context command
    const copyAiContextCommand = vscode.commands.registerCommand('mauiXamlPreview.copyAiContext', async () => {
        const selected = previewProvider.getSelectedElementContext();
        if (!selected) {
            vscode.window.showWarningMessage('Najprej izberi element v preview-u.');
            return;
        }
        const ctx = [
            `Current selected XAML element:`,
            `- Type: ${selected.type}`,
            `- Attributes: ${JSON.stringify(selected.attributes, null, 2)}`,
            `- Parent: ${selected.parentType || 'unknown'}`,
            `- Children: ${selected.childCount}`,
            `- Line range: ${selected.startLine}–${selected.endLine}`,
            ``,
            `Rules:`,
            `- Do not change bindings.`,
            `- Prefer StaticResource over literal values.`,
            `- Keep MAUI syntax valid.`,
            `- Desired task: [OPIŠI NALOGO TUKAJ]`,
        ].join('\n');
        await vscode.env.clipboard.writeText(ctx);
        vscode.window.showInformationMessage('AI Design Context kopiran v odložišče!');
    });
    context.subscriptions.push(copyAiContextCommand);

    // ═══════════════════════════════════════════════════════════════════════════════
    // MCP SERVER — AI agent integration
    // ═══════════════════════════════════════════════════════════════════════════════
    const mcpEnabled = vscode.workspace.getConfiguration('mauiXamlPreview').get<boolean>('mcpEnabled', true);
    if (mcpEnabled) {
        try {
            mcpServerInstance = new MauiMcpServer(previewProvider);
            await mcpServerInstance.start();
            console.log(`[MCP] Server started on port ${mcpServerInstance.port}`);
        } catch (err) {
            console.error('[MCP] Failed to start MCP server:', err);
        }
    }

    // Avtomatsko odpiranje preview-ja - spoštuje nastavitev autoOpen
    const autoOpen = vscode.workspace.getConfiguration('mauiXamlPreview').get<boolean>('autoOpen', false);
    if (autoOpen && vscode.window.activeTextEditor?.document.fileName.toLowerCase().endsWith('.xaml')) {
        codeBehindProvider.updateContext(vscode.window.activeTextEditor.document.fileName);
        previewStatusBar.show();
        vscode.commands.executeCommand('mauiXamlPreview.openPreview');
    } else if (vscode.window.activeTextEditor?.document.fileName.toLowerCase().endsWith('.xaml')) {
        codeBehindProvider.updateContext(vscode.window.activeTextEditor.document.fileName);
        previewStatusBar.show();
    }
}

export async function deactivate() {
    console.log('MAUI XAML Preview extension se deaktivira...');
    if (mcpServerInstance) {
        await mcpServerInstance.stop();
        mcpServerInstance = undefined;
    }
}