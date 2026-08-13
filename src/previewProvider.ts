import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

import { MauiPropertiesProvider, XamlElement, ElementProperty, PropertyTreeItem } from './propertiesProvider';
import { ResourceManager, ParsedResource, StyleResource } from './resourceManager';
import { PlatformManager } from './platformManager';
import { ZoomManager } from './zoomManager';

interface ParsedElement {
    id: string;
    type: string;
    name?: string;
    attributes: Record<string, string>;
    resolvedAttributes: Record<string, string>;
    children: ParsedElement[];
    textContent?: string;
    metadata: {
        startLine?: number;
        endLine?: number;
        startIndex?: number;
        gridRows?: string[];
        gridColumns?: string[];
        cornerRadius?: string;
        gradientStops?: Array<{ color: string; offset: string }>;
        gradientStartPoint?: string;
        gradientEndPoint?: string;
        isSynthetic?: boolean;
        inlineStyles?: Array<{ targetType: string; setters: Record<string, string> }>;
        parentType?: string;
    };
}

const COLOR_NAME_MAP: Record<string, string> = {
    transparent: 'transparent',
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    orange: '#ffa500',
    gray: '#808080',
    grey: '#808080',
    lightgray: '#d3d3d3',
    darkgray: '#4d4d4d',
    lightgrey: '#d3d3d3',
    darkgrey: '#4d4d4d',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    purple: '#800080',
    brown: '#a52a2a',
    teal: '#008080',
    indigo: '#4b0082'
};

export class MauiXamlPreviewProvider implements vscode.WebviewPanelSerializer {
    private static readonly viewType = 'mauiXamlPreview';
    private static _listenerCount = 0;

    private readonly _extensionUri: vscode.Uri;
    private _currentPanel: vscode.WebviewPanel | undefined;
    private _currentDocument: vscode.TextDocument | undefined;
    private _elementHighlightDecoration: vscode.TextEditorDecorationType | undefined;
    private _elementMap: Map<string, { startLine: number; endLine: number; elementName: string }> = new Map();
    private _propertiesProvider: MauiPropertiesProvider | undefined;
    private _propertiesTreeView: vscode.TreeView<PropertyTreeItem> | undefined;
    private _structureProvider: MauiPropertiesProvider | undefined;
    private _structureTreeView: vscode.TreeView<PropertyTreeItem> | undefined;
    private _propertiesWebviewProvider: import('./propertiesWebviewProvider').PropertiesWebviewProvider | undefined;

    private _resourceManager: ResourceManager;
    private _platformManager: PlatformManager;
    private _zoomManager: ZoomManager;

    private _resources: ParsedResource[] = [];
    private _styles: StyleResource[] = [];
    private _themeColors: Map<string, string> = new Map();

    private _parsedElements: ParsedElement[] = [];
    private _elementLookup: Map<string, ParsedElement> = new Map();
    private _xamlElements: XamlElement[] = [];
    private _elementIdCounter = 0;
    private _currentSelectedElementId: string | undefined;
    private _viewMode: 'full' | 'selected' = 'full';

    // Design-time sample data loaded from ViewModel / code-behind C# files
    private _designTimeData: Map<string, string> = new Map();

    // Webview message callbacks
    private _messageCallbacks: ((msg: any) => void)[] = [];

    /**
     * Register callback for webview messages
     */
    public addMessageCallback(cb: (msg: any) => void): void {
        this._messageCallbacks.push(cb);
    }

    /**
     * Notify all message callbacks
     */
    private _notifyMessageCallbacks(msg: any): void {
        for (const cb of this._messageCallbacks) {
            try { cb(msg); } catch (e) { console.error('[PreviewProvider] Callback error:', e); }
        }
    }

    /**
     * Get current HTML content for screenshot/inspection
     */
    public getCurrentHtml(): string {
        return this._generatePreviewHtml();
    }

    /**
     * Returns the line range of a parsed element by its ID.
     * Used by extension.ts safeEditAttribute to restrict edits to the correct element.
     */
    public getElementRange(elementId: string): { startLine: number; endLine: number } | undefined {
        const info = this._elementMap.get(elementId);
        if (info) return { startLine: info.startLine, endLine: info.endLine };
        // Fallback: check parsed elements lookup
        const el = this._elementLookup.get(elementId);
        if (el?.metadata?.startLine !== undefined) {
            return { startLine: el.metadata.startLine, endLine: el.metadata.endLine ?? el.metadata.startLine };
        }
        return undefined;
    }

    /**
     * Returns context of the currently selected element for AI clipboard copy.
     */
    public getSelectedElementContext(): {
        type: string;
        attributes: Record<string, string>;
        parentType: string | undefined;
        childCount: number;
        startLine: number;
        endLine: number;
    } | undefined {
        if (!this._currentSelectedElementId) return undefined;
        const el = this._elementLookup.get(this._currentSelectedElementId);
        if (!el) return undefined;
        const range = this.getElementRange(this._currentSelectedElementId);
        return {
            type: el.type,
            attributes: el.resolvedAttributes as Record<string, string>,
            parentType: el.metadata?.parentType,
            childCount: el.children?.length ?? 0,
            startLine: range?.startLine ?? el.metadata?.startLine ?? 0,
            endLine: range?.endLine ?? el.metadata?.endLine ?? 0,
        };
    }

    /**
     * Returns a flat list of all parsed elements (for MCP tool: list_elements).
     */
    public getAllElements(): Array<{
        id: string; type: string; name?: string;
        startLine?: number; endLine?: number;
        parentType?: string; childCount: number;
        attributes: Record<string, string>;
    }> {
        const result: Array<any> = [];
        const walk = (el: ParsedElement, parentType?: string) => {
            result.push({
                id: el.id,
                type: el.type,
                name: el.name,
                startLine: el.metadata?.startLine,
                endLine: el.metadata?.endLine,
                parentType,
                childCount: el.children?.length ?? 0,
                attributes: el.resolvedAttributes,
            });
            for (const child of el.children || []) {
                walk(child, el.type);
            }
        };
        for (const root of this._parsedElements) {
            walk(root);
        }
        return result;
    }

    /**
     * Returns a single parsed element by its ID (for MCP tool: get_element).
     */
    public getElementById(elementId: string): {
        id: string; type: string; name?: string;
        startLine?: number; endLine?: number;
        attributes: Record<string, string>;
        children: Array<{ id: string; type: string }>;
    } | undefined {
        const el = this._elementLookup.get(elementId);
        if (!el) return undefined;
        return {
            id: el.id,
            type: el.type,
            name: el.name,
            startLine: el.metadata?.startLine,
            endLine: el.metadata?.endLine,
            attributes: el.resolvedAttributes,
            children: (el.children || []).map(c => ({ id: c.id, type: c.type })),
        };
    }

    // PUBLIC: Select elements by code behind binding/event name
    public async selectElementByCode(name: string, isCommand: boolean) {
        if (!this._currentPanel) return;
        this._currentPanel.webview.postMessage({ type: 'selectElementByCode', name, isCommand });
    }

    private _xmlParser: XMLParser;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._resourceManager = new ResourceManager();
        this._platformManager = new PlatformManager();
        this._zoomManager = new ZoomManager();
        this._xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            parseTagValue: false,
            parseAttributeValue: false,
            trimValues: true,
            removeNSPrefix: false,
            allowBooleanAttributes: true,
            updateTagLocation: true
        } as any);
        console.log('[PreviewProvider] Initialized with managers');
    }

    /** Build local resource roots including extension, workspace and current document directory for image loading */
    private _getLocalResourceRoots(doc?: vscode.TextDocument): vscode.Uri[] {
        const roots: vscode.Uri[] = [this._extensionUri];
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                for (const f of workspaceFolders) {
                    roots.push(f.uri);
                    // Common MAUI resource folders
                    roots.push(vscode.Uri.joinPath(f.uri, 'Resources'));
                    roots.push(vscode.Uri.joinPath(f.uri, 'Resources', 'Images'));
                }
            }
            if (doc) {
                const dir = path.dirname(doc.uri.fsPath);
                roots.push(vscode.Uri.file(dir));
            }
        } catch (e) {
            console.warn('[PreviewProvider] Failed building localResourceRoots', e);
        }
        // Deduplicate by toString
        const seen = new Set<string>();
        return roots.filter(r => { const k = r.toString(); if (seen.has(k)) return false; seen.add(k); return true; });
    }

    // Provide color suggestions for property editors
    public getColorSuggestions(): string[] {
        const suggestions = new Set<string>();
        // Theme colors
        for (const [k, v] of this._themeColors.entries()) {
            suggestions.add(k);
            suggestions.add(v);
        }
        // Parsed resources
        for (const r of this._resources) {
            if (r.type === 'Color' && r.value) {
                suggestions.add(r.key);
                suggestions.add(r.value);
            }
        }
        // Common named colors
        for (const name of Object.keys(COLOR_NAME_MAP)) {
            suggestions.add(name);
        }
        return Array.from(suggestions).filter(Boolean).slice(0, 200);
    }

    // Provide style key suggestions
    public getStyleSuggestions(): string[] {
        const styles = new Set<string>();
        for (const s of this._styles) {
            if (s.key) styles.add(s.key);
        }
        return Array.from(styles).slice(0, 200);
    }

    // Provide generic StaticResource keys (e.g., Colors, Brushes, etc.)
    public getResourceKeySuggestions(): string[] {
        const keys = new Set<string>();
        for (const r of this._resources) {
            if (r.key) keys.add(r.key);
        }
        return Array.from(keys).slice(0, 300);
    }

    public setElementHighlightDecoration(decoration: vscode.TextEditorDecorationType) {
        this._elementHighlightDecoration = decoration;
    }

    public setPropertiesProvider(provider: MauiPropertiesProvider, treeView?: vscode.TreeView<PropertyTreeItem>) {
        this._propertiesProvider = provider;
        this._propertiesTreeView = treeView; // kept for backward compatibility, not used for reveal anymore
        console.log('[PreviewProvider] Properties provider set');
    }

    public setPropertiesWebviewProvider(provider: import('./propertiesWebviewProvider').PropertiesWebviewProvider) {
        this._propertiesWebviewProvider = provider;
        console.log('[PreviewProvider] Properties webview provider set');
    }

    public setStructureProvider(provider: MauiPropertiesProvider, treeView: vscode.TreeView<PropertyTreeItem>) {
        this._structureProvider = provider;
        this._structureTreeView = treeView;
        console.log('[PreviewProvider] Structure provider set');
    }

    public updateElementProperty(property: ElementProperty, newValue: string) {
        if (this._currentPanel) {
            this._currentPanel.webview.postMessage({
                type: 'updateProperty',
                property: property.key,
                value: newValue
            });
        }

        if (this._propertiesProvider) {
            this._propertiesProvider.refresh();
        }
    }

    public async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel): Promise<void> {
        this._currentPanel = webviewPanel;
        const disp = this._configureWebview(webviewPanel.webview);
        // ensure listener disposed and panel cleared when panel is closed
        webviewPanel.onDidDispose(() => {
            try { disp.dispose(); } catch (e) { /* ignore */ }
            this._currentPanel = undefined;
            console.log('[PreviewProvider] Deserialized panel disposed');
        }, null);
    }

    public async openPreview(document: vscode.TextDocument) {
        console.log('[PreviewProvider] Opening preview for:', document.fileName);
        this._currentDocument = document;

        if (this._currentPanel) {
            try {
                this._currentPanel.reveal(vscode.ViewColumn.Beside);
                await this.updatePreview(document);
                return;
            } catch (error) {
                console.warn('[PreviewProvider] Existing panel is no longer usable, recreating.', error);
                this._currentPanel.dispose();
                this._currentPanel = undefined;
            }
        }

        this._currentPanel = vscode.window.createWebviewPanel(
            MauiXamlPreviewProvider.viewType,
            `MAUI Preview: ${path.basename(document.fileName)}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: this._getLocalResourceRoots(document)
            }
        );

        const disp = this._configureWebview(this._currentPanel.webview);
        await this.updatePreview(document);
        this._currentPanel.onDidDispose(() => {
            try { disp.dispose(); } catch (e) { /* ignore */ }
            this._currentPanel = undefined;
            console.log('[PreviewProvider] Panel disposed');
        }, null);
    }

    // ─── Design-time data loading ─────────────────────────────────────────────

    /**
     * Convert camelCase/lowerCase to PascalCase (e.g. "_partnerSearchText" → "PartnerSearchText")
     */
    private _toPascalCase(name: string): string {
        const stripped = name.startsWith('_') ? name.slice(1) : name;
        return stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }

    /**
     * Heuristic sample values based on property name patterns.
     * Used when no explicit value was extracted from the ViewModel.
     */
    private _getHeuristicSampleValue(propName: string): string | undefined {
        const lower = propName.toLowerCase();
        if (lower.includes('number') || lower.includes('code')) { return 'OR-2025-001'; }
        if (lower.includes('customername') || lower.includes('partnername')) { return 'Acme Corp d.o.o.'; }
        if (lower.includes('name')) { return 'Acme Corp d.o.o.'; }
        if (lower.includes('email')) { return 'info@example.com'; }
        if (lower.includes('phone') || lower.includes('tel')) { return '+386 1 234 5678'; }
        if (lower.includes('grandtotal') || lower.includes('grand_total')) { return '1250.00'; }
        if (lower.includes('total') || lower.includes('amount') || lower.includes('vsota')) { return '1250.00'; }
        if (lower.includes('price') || lower.includes('cena')) { return '125.00'; }
        if (lower.includes('date') || lower.includes('datum')) { return new Date().toLocaleDateString('sl-SI'); }
        if (lower.includes('status')) { return 'draft'; }
        if (lower.includes('person') || lower.includes('prodajalec')) { return 'Janez Novak'; }
        if (lower.includes('address') || lower.includes('naslov')) { return 'Slovenska 1, Ljubljana'; }
        if (lower.includes('note') || lower.includes('opomba')) { return 'Opomba...'; }
        if (lower.includes('description') || lower.includes('opis')) { return 'Opis...'; }
        if (lower.includes('display') || lower.includes('label')) { return propName; }
        if (lower.includes('error') || lower.includes('message')) { return ''; }
        if (lower.includes('text') || lower.includes('search')) { return ''; }
        if (lower.includes('title')) { return propName; }
        return undefined;
    }

    /**
     * Extract design-time sample data from a C# ViewModel or code-behind file.
     */
    private _extractDesignTimeDataFromCs(csContent: string): void {
        if (!csContent) { return; }
        let m: RegExpExecArray | null;

        // 1. Static string arrays: public static readonly string[] StatusOptions = { "a", "b" };
        const staticArrRe = /public\s+static\s+(?:readonly\s+)?(?:string\[\]|List<string>|IReadOnlyList<string>)\s+(\w+)\s*(?:=[^{]*)?\{([^}]+)\}/gm;
        while ((m = staticArrRe.exec(csContent)) !== null) {
            const pName = m[1];
            const items = (m[2].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1));
            if (items.length > 0 && !this._designTimeData.has(`${pName}__items`)) {
                this._designTimeData.set(`${pName}__items`, JSON.stringify(items));
                if (!this._designTimeData.has(pName)) { this._designTimeData.set(pName, items[0]); }
            }
        }

        // 2. Private string backing field with literal: private string _foo = "bar";
        const strFieldRe = /private\s+string\s+(_\w+)\s*=\s*"([^"]*)"/gm;
        while ((m = strFieldRe.exec(csContent)) !== null) {
            const pName = this._toPascalCase(m[1]);
            if (!this._designTimeData.has(pName)) { this._designTimeData.set(pName, m[2]); }
        }

        // 3. Simple expression-bodied string getter: public string Foo => "bar";
        const simpleGetterRe = /public\s+string\s+(\w+)\s*=>\s*"([^"]*)"\s*;/gm;
        while ((m = simpleGetterRe.exec(csContent)) !== null) {
            this._designTimeData.set(m[1], m[2]);
        }

        // 4. Ternary getter — take first literal: public string PageTitle => x == 0 ? "Novo naročilo" : ...
        const ternaryRe = /public\s+string\s+(\w+)\s*=>\s*[^?;{]+\?\s*"([^"]+)"/gm;
        while ((m = ternaryRe.exec(csContent)) !== null) {
            if (!this._designTimeData.has(m[1])) { this._designTimeData.set(m[1], m[2]); }
        }

        // 5. Null-coalesce getter: public string Foo => _x ?? "fallback"  or  ?? string.Empty
        const nullCoalRe = /public\s+string[?]?\s+(\w+)\s*=>\s*[\w._]+\s*\?\?\s*(?:"([^"]*)"|(string\.Empty))/gm;
        while ((m = nullCoalRe.exec(csContent)) !== null) {
            if (!this._designTimeData.has(m[1])) {
                this._designTimeData.set(m[1], m[2] ?? '');
            }
        }

        // 6. Bool backing field: private bool _foo = true/false;
        const boolFieldRe = /private\s+bool\s+(_\w+)\s*(?:=\s*(true|false))?[;,]/gm;
        while ((m = boolFieldRe.exec(csContent)) !== null) {
            const pName = this._toPascalCase(m[1]);
            if (!this._designTimeData.has(pName)) { this._designTimeData.set(pName, m[2] || 'false'); }
        }

        // 7. Bool computed: public bool HasError => ... → default false
        const boolComputedRe = /public\s+bool\s+(\w+)\s*=>/gm;
        while ((m = boolComputedRe.exec(csContent)) !== null) {
            if (!this._designTimeData.has(m[1])) { this._designTimeData.set(m[1], 'false'); }
        }

        // 8. Inline string assignments (e.g. in Initialise/constructor): Status = "draft"
        //    Only safe values ≤40 chars, no interpolation
        const inlineStrRe = /(?:_order\.|this\.)?([A-Z]\w{1,39})\s*=\s*"([^"]{0,40})"\s*[,;]/gm;
        while ((m = inlineStrRe.exec(csContent)) !== null) {
            if (!this._designTimeData.has(m[1])) {
                this._designTimeData.set(m[1], m[2]);
            }
        }
    }

    /**
     * Load design-time data from the .xaml.cs code-behind and from the ViewModel
     * identified by x:DataType on the root element.
     */
    private async _loadDesignTimeData(document: vscode.TextDocument): Promise<void> {
        this._designTimeData.clear();
        try {
            const xamlFilePath = document.fileName;
            const xamlContent = document.getText();

            // Read .xaml.cs code-behind (may not exist for MVVM)
            const codeBehindPath = xamlFilePath + '.cs';
            if (fs.existsSync(codeBehindPath)) {
                const cbc = fs.readFileSync(codeBehindPath, 'utf-8');
                this._extractDesignTimeDataFromCs(cbc);
            }

            // Find ViewModel class name from x:DataType="vm:SomeViewModel"
            const dtMatch = xamlContent.match(/x:DataType\s*=\s*"([^"]+)"/);
            if (!dtMatch) { return; }
            const classNameMatch = dtMatch[1].match(/(?:[a-z]\w*:)?(\w+)$/i);
            if (!classNameMatch) { return; }
            const className = classNameMatch[1];

            const files = await vscode.workspace.findFiles(`**/${className}.cs`, '**/obj/**', 3);
            for (const fileUri of files) {
                try {
                    const vmContent = fs.readFileSync(fileUri.fsPath, 'utf-8');
                    this._extractDesignTimeDataFromCs(vmContent);
                    console.log(`[PreviewProvider] Design-time data loaded from ${fileUri.fsPath}`);
                    break;
                } catch (_) { /* ignore */ }
            }
        } catch (e) {
            console.warn('[PreviewProvider] _loadDesignTimeData error:', e);
        }
    }

    /**
     * Resolve a binding property path to a design-time display string.
     * Checks _designTimeData first, then falls back to heuristic patterns.
     * Returns undefined if nothing matches (caller renders plain placeholder).
     */
    private _resolveBindingValue(propName: string, formatStr?: string): string | undefined {
        let value: string | undefined = this._designTimeData.get(propName);
        if (value === undefined) {
            value = this._getHeuristicSampleValue(propName);
        }
        if (value === undefined) { return undefined; }
        if (!formatStr) { return value; }

        // Apply StringFormat — strip leading {}
        const fmt = formatStr.replace(/^\{\}\s*/, '');
        const numVal = parseFloat(value.replace(',', '.')) || 0;
        const result = fmt
            .replace(/\{0:N(\d+)\}/ig, (_: string, d: string) =>
                numVal.toLocaleString('de-DE', { minimumFractionDigits: Number(d), maximumFractionDigits: Number(d) }))
            .replace(/\{0:F(\d+)\}/ig, (_: string, d: string) => numVal.toFixed(Number(d)))
            .replace(/\{0:dd\.MM\.yyyy\}/ig, () => value ?? '')
            .replace(/\{0:[^}]+\}/g, value ?? '')
            .replace(/\{0\}/g, value ?? '');
        return result;
    }

    // ─── End design-time data loading ────────────────────────────────────────

    public async updatePreview(document: vscode.TextDocument) {
        if (!this._currentPanel) {
            console.warn('[PreviewProvider] No panel available for update');
            return;
        }

        this._currentDocument = document;

        try {
            const xamlContent = document.getText();
            console.log('[PreviewProvider] Updating preview for:', document.fileName);

            // Load design-time sample data from code-behind / ViewModel C# files
            await this._loadDesignTimeData(document);

            const resourceData = await this._resourceManager.loadResourcesForFile(document.fileName);
            this._resources = resourceData.resources;
            this._styles = resourceData.styles;
            this._initializeThemeColors();

            this._parsedElements = this._parseXamlDocument(xamlContent);

            // NEW: Wrap non-Page roots in a Host Page for better preview context
            // Filter out XML processing instructions (e.g. ?xml) — they are not real content roots
            const contentElements = this._parsedElements.filter(e => !e.type.startsWith('?'));
            if (contentElements.length === 1) {
                const root = contentElements[0];
                const pageTypes = ['ContentPage', 'Shell', 'FlyoutPage', 'TabbedPage', 'NavigationPage', 'Application'];

                if (!pageTypes.includes(root.type)) {
                    console.log('[PreviewProvider] Root is not a page, wrapping in Host Page context');
                    this._parsedElements = [this._createHostPage(root)];
                }
            }

            this._indexParsedElements();
            this._assignElementPositions(xamlContent);
            this._xamlElements = this._convertParsedToXamlElements(this._parsedElements);

            const htmlContent = this._generatePreviewHtml();
            this._currentPanel.webview.html = htmlContent;

            this._sendPropertiesDataToSidebar();

            console.log('[PreviewProvider] Preview updated successfully');
        } catch (error) {
            console.error('[PreviewProvider] Error updating preview:', error);
            this._showErrorMessage('Failed to update preview: ' + error);
        }
    }

    // PUBLIC: Select element by id from outside (tree/cmd)
    public async selectElementById(elementId: string) {
        if (!elementId) return;
        await this._handleElementSelection(elementId);
        // also instruct webview to mark as selected
        this._currentPanel?.webview.postMessage({ type: 'selectElement', elementId });
    }

    // PUBLIC: Select element based on caret line in active XAML
    public async selectElementAtLine(line: number) {
        if (!this._currentDocument) return;
        let bestId: string | undefined;
        let bestSpan = Number.POSITIVE_INFINITY;
        for (const [id, info] of this._elementMap.entries()) {
            if (line >= info.startLine && line <= info.endLine) {
                const span = info.endLine - info.startLine;
                if (span < bestSpan) { bestSpan = span; bestId = id; }
            }
        }
        if (bestId) {
            await this.selectElementById(bestId);
        }
    }

    private _configureWebview(webview: vscode.Webview): vscode.Disposable {
        webview.options = {
            enableScripts: true,
            localResourceRoots: this._getLocalResourceRoots(this._currentDocument)
        };

        MauiXamlPreviewProvider._listenerCount++;
        console.log(`[PreviewProvider] Listener count increased to: ${MauiXamlPreviewProvider._listenerCount}`);

        const messageDisposable = webview.onDidReceiveMessage(async (message) => {
            const cmd = message?.command ?? message?.type ?? message?.cmd;
            console.log('[PreviewProvider] Received message:', cmd, message);

            switch (cmd) {
                case 'elementSelected':
                    await this._handleElementSelection(message.elementId, message.line);
                    break;
                case 'switchPlatform':
                    // accept either 'platform' or 'platformName' keys coming from webview
                    await this._handlePlatformSwitch(message.platform ?? message.platformName ?? message.value);
                    break;
                case 'zoom':
                    this._handleZoom(message.action, message.value);
                    break;
                case 'changeViewMode':
                    this._handleViewModeChange(message.mode);
                    break;
                case 'ready':
                    console.log('[PreviewProvider] Webview ready');
                    setTimeout(() => {
                        this._sendPropertiesDataToSidebar();
                        this._applyViewModeToWebview();
                    }, 50);
                    break;
                default:
                    console.warn('[PreviewProvider] Unknown command/type:', cmd, message);
            }
        });

        console.log('[PreviewProvider] Webview configured');

        // Wrap the disposable to decrement counter when disposed
        return {
            dispose: () => {
                messageDisposable.dispose();
                MauiXamlPreviewProvider._listenerCount--;
                console.log(`[PreviewProvider] Listener count decreased to: ${MauiXamlPreviewProvider._listenerCount}`);
            }
        };
    }

    private async _handleElementSelection(elementId: string, rawLine?: any) {
        if (!elementId) {
            return;
        }

        const element = this._elementLookup.get(elementId);
        if (element && element.metadata.isSynthetic) {
            // If selecting host wrapper, select the first real child instead if available
            if (element.children.length > 0) {
                await this._handleElementSelection(element.children[0].id, rawLine);
            }
            return;
        }

        this._currentSelectedElementId = elementId;

        let targetLine: number | undefined;
        if (rawLine !== undefined && rawLine !== null && rawLine !== '') {
            const parsed = Number(rawLine);
            if (!Number.isNaN(parsed)) {
                targetLine = parsed;
            }
        }

        const elementInfo = this._elementMap.get(elementId);
        console.log(`[PreviewProvider] Selection request: ID=${elementId}, RawLine=${rawLine}, MapInfo=${JSON.stringify(elementInfo)}`);

        if (!targetLine && elementInfo) {
            targetLine = elementInfo.startLine;
        }

        if (targetLine !== undefined && this._currentDocument) {
            // Find any visible editor for this document
            let editor = vscode.window.visibleTextEditors.find(e => e.document.fileName === this._currentDocument?.fileName);
            console.log(`[PreviewProvider] Found visible editor: ${editor ? 'Yes' : 'No'}`);

            // Fallback: open document beside the preview preserving webview focus
            if (!editor) {
                try {
                    const doc = await vscode.workspace.openTextDocument(this._currentDocument.fileName);
                    editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
                    console.log(`[PreviewProvider] Opened document in ViewColumn.One`);
                } catch (err) {
                    console.warn('[PreviewProvider] Could not open document for highlight:', err);
                }
            }

            if (editor) {
                const clampedLine = Math.max(0, Math.min(targetLine, editor.document.lineCount - 1));
                console.log(`[PreviewProvider] Revealing line: ${clampedLine}`);

                const position = new vscode.Position(clampedLine, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);

                // Clear previous decorations first
                if (this._elementHighlightDecoration) {
                    editor.setDecorations(this._elementHighlightDecoration, []);
                }

                // Apply new decoration
                if (this._elementHighlightDecoration && elementInfo) {
                    const endLine = Math.max(elementInfo.startLine, elementInfo.endLine);
                    const range = new vscode.Range(
                        elementInfo.startLine,
                        0,
                        endLine,
                        editor.document.lineAt(endLine).text.length
                    );
                    editor.setDecorations(this._elementHighlightDecoration, [range]);
                }
            } else {
                console.warn('[PreviewProvider] No visible editor found for document');
            }
        } else {
            console.warn(`[PreviewProvider] targetLine undefined. Info found? ${!!elementInfo}`);
        }

        await this._focusPropertiesView();
        this._sendElementPropertiesToSidebar(elementId);
        // NEW: reveal in tree view
        await this._revealElementInTree(elementId);
        this._applyViewModeToWebview(elementId);
        // Ensure selection is reflected in DOM
        this._currentPanel?.webview.postMessage({ type: 'selectElement', elementId });
    }

    private async _revealElementInTree(elementId: string) {
        try {
            const provider = this._structureProvider ?? this._propertiesProvider;
            const tree = this._structureTreeView ?? this._propertiesTreeView;
            if (!provider || !tree) return;
            const anyProvider: any = provider as any;
            const item = typeof anyProvider.getTreeItemById === 'function' ? anyProvider.getTreeItemById(elementId) : undefined;
            if (item) {
                await tree.reveal(item, { expand: true, focus: true, select: true });
            } else {
                provider.refresh();
                await new Promise(r => setTimeout(r, 80));
                const item2 = typeof anyProvider.getTreeItemById === 'function' ? anyProvider.getTreeItemById(elementId) : undefined;
                if (item2) {
                    await tree.reveal(item2, { expand: true, focus: true, select: true });
                }
            }
        } catch (err) {
            console.warn('[PreviewProvider] reveal in tree failed', err);
        }
    }

    private async _handlePlatformSwitch(platform: string) {
        if (!platform) {
            return;
        }
        console.log(`[PreviewProvider] Switching to platform (raw): ${platform}`);

        // Normalize common labels/aliases coming from the webview buttons
        const normalized = (platform || '').toString().trim();
        const map: Record<string, string> = {
            'android': 'Android',
            'android phone': 'Android',
            'androidphone': 'Android',
            'ios': 'iOS',
            'iphone': 'iOS',
            'macos': 'macOS',
            'macos desktop': 'macOS',
            'windows': 'Windows',
            'windows desktop': 'Windows'
        };

        const key = map[normalized.toLowerCase()] || normalized;

        console.log(`[PreviewProvider] Switching to platform (mapped): ${key}`);

        if (this._platformManager.setPlatform(key)) {
            if (this._currentDocument) {
                await this.updatePreview(this._currentDocument);
                // Auto-fit to window after platform switch with a small delay to ensure rendering is complete
                setTimeout(() => {
                    this._currentPanel?.webview.postMessage({ type: 'fitToViewport' });
                }, 150);
            }
        } else {
            vscode.window.showWarningMessage(`Neznana platforma: ${platform}`);
        }
    }

    private _handleZoom(action: string, value?: number) {
        switch (action) {
            case 'in':
                this._zoomManager.zoomIn();
                break;
            case 'out':
                this._zoomManager.zoomOut();
                break;
            case 'fit':
                this._currentPanel?.webview.postMessage({ type: 'fitToViewport' });
                break;
            case 'actual':
                this._zoomManager.zoomActualSize();
                break;
            case 'set':
                if (typeof value === 'number') {
                    this._zoomManager.setZoom(value);
                }
                break;
        }

        this._currentPanel?.webview.postMessage({
            type: 'updateZoom',
            zoom: this._zoomManager.getCurrentZoom()
        });
    }

    private _sendPropertiesDataToSidebar() {
        if (!this._propertiesProvider && !this._structureProvider) {
            return;
        }

        if (this._propertiesProvider) {
            this._propertiesProvider.setElements(this._xamlElements);
        }
        if (this._structureProvider) {
            this._structureProvider.setElements(this._xamlElements);
        }

        const selectedElement = this._currentSelectedElementId
            ? this._findXamlElementById(this._currentSelectedElementId, this._xamlElements)
            : this._xamlElements[0];

        this._propertiesProvider?.setSelectedElement(selectedElement);

        if (!this._currentSelectedElementId && selectedElement) {
            this._currentSelectedElementId = selectedElement.id;
        }
        // Ensure tree views refresh to pick up new items and caches
        try {
            this._propertiesProvider?.refresh();
            this._structureProvider?.refresh();
        } catch (err) {
            // ignore
        }
    }

    private async _focusPropertiesView() {
        try {
            // Show the MAUI Designer container in the activity bar. Focusing the specific tree
            // is handled via tree.reveal elsewhere; avoid calling a non-existent focus command.
            await vscode.commands.executeCommand('workbench.view.extension.maui-designer');
        } catch (error) {
            console.warn('[PreviewProvider] Unable to focus properties view:', error);
        }
    }

    private _handleViewModeChange(mode: string) {
        const normalized: 'full' | 'selected' = mode === 'selected' ? 'selected' : 'full';
        this._viewMode = normalized;

        const activeId = this._getActiveElementId();
        if (!this._currentSelectedElementId && activeId) {
            this._currentSelectedElementId = activeId;
        }

        this._applyViewModeToWebview(activeId);
    }

    private _applyViewModeToWebview(selectedId?: string) {
        if (!this._currentPanel) {
            return;
        }

        const targetId = selectedId ?? this._getActiveElementId();
        this._currentPanel.webview.postMessage({
            type: 'applyViewMode',
            mode: this._viewMode,
            selectedId: targetId
        });
    }

    private _getActiveElementId(): string | undefined {
        if (this._currentSelectedElementId) {
            return this._currentSelectedElementId;
        }
        return this._xamlElements.length > 0 ? this._xamlElements[0].id : undefined;
    }

    private _sendElementPropertiesToSidebar(elementId: string) {
        const element = this._findXamlElementById(elementId, this._xamlElements);
        if (!element) {
            return;
        }
        this._currentSelectedElementId = elementId;

        // Tree-based provider (may or may not be set)
        if (this._propertiesProvider) {
            this._propertiesProvider.setSelectedElement(element);
            try { this._propertiesProvider.refresh(); } catch { /* ignore */ }
        }

        // Webview-based sidebar panel (primary properties display)
        if (this._propertiesWebviewProvider) {
            this._propertiesWebviewProvider.setSelectedElement(element);
        }
    }

    private _findXamlElementById(id: string | undefined, elements: XamlElement[]): XamlElement | undefined {
        if (!id) {
            return undefined;
        }

        const stack: XamlElement[] = [...elements];
        while (stack.length) {
            const current = stack.shift()!;
            if (current.id === id) {
                return current;
            }
            stack.unshift(...current.children);
        }
        return undefined;
    }

    private _initializeThemeColors() {
        this._themeColors.clear();
        this._themeColors.set('Primary', '#512BD4'); // MAUI Purple
        this._themeColors.set('Secondary', '#2B0B98');
        this._themeColors.set('Success', '#28a745');
        this._themeColors.set('Info', '#17a2b8');
        this._themeColors.set('Warning', '#ffc107');
        this._themeColors.set('Danger', '#dc3545');
        this._themeColors.set('Light', '#f8f9fa');
        this._themeColors.set('Dark', '#1c1c1c');


        for (const resource of this._resources) {
            if (resource.type === 'Color') {
                this._themeColors.set(resource.key, resource.value);
            }
        }

        console.log(`[PreviewProvider] Initialized ${this._themeColors.size} theme colors`);
    }

    private _parseXamlDocument(xamlContent: string): ParsedElement[] {
        this._elementIdCounter = 0;
        const parsedElements: ParsedElement[] = [];

        if (!xamlContent.trim()) {
            return parsedElements;
        }

        try {
            const parsed = this._xmlParser.parse(xamlContent);
            for (const key in parsed) {
                const value = parsed[key];
                const nodes = Array.isArray(value) ? value : [value];
                for (const node of nodes) {
                    const element = this._convertNodeToElement(key, node);
                    if (element) {
                        parsedElements.push(element);
                    }
                }
            }
        } catch (error) {
            console.error('[PreviewProvider] Error parsing XAML:', error);
        }

        parsedElements.forEach(element => this._finalizeElementAttributes(element));
        return parsedElements;
    }

    private _createHostPage(contentElement: ParsedElement): ParsedElement {
        // Create a Host ContentPage
        const hostPage: ParsedElement = {
            id: 'host-page-root',
            type: 'ContentPage',
            name: 'PreviewHostPage',
            attributes: {
                'BackgroundColor': 'Transparent'
            },
            resolvedAttributes: {
                'BackgroundColor': 'Transparent'
            },
            children: [],
            metadata: { isSynthetic: true }
        };

        // Create a centering Grid to hold the content
        const hostGrid: ParsedElement = {
            id: 'host-grid-container',
            type: 'Grid',
            name: 'PreviewHostContainer',
            attributes: {
                'HorizontalOptions': 'Fill',
                'VerticalOptions': 'Fill',
                'Padding': '0'
            },
            resolvedAttributes: {
                'HorizontalOptions': 'Fill',
                'VerticalOptions': 'Fill',
                'Padding': '0'
            },
            children: [contentElement], // Put the original root inside
            metadata: { isSynthetic: true }
        };

        hostPage.children.push(hostGrid);
        return hostPage;
    }

    private _convertNodeToElement(type: string, node: any): ParsedElement | null {
        if (node === null || node === undefined) {
            return null;
        }

        if (typeof node === 'string') {
            if (!node.trim()) {
                return null;
            }
            return {
                id: this._nextElementId(),
                type,
                attributes: {},
                resolvedAttributes: {},
                children: [],
                textContent: node.trim(),
                metadata: {}
            };
        }

        if (typeof node !== 'object') {
            return null;
        }

        const element: ParsedElement = {
            id: this._nextElementId(),
            type,
            attributes: {},
            resolvedAttributes: {},
            children: [],
            metadata: {
                startLine: node[':@']?.['line'],
                startIndex: node[':@']?.['startIndex']
            }
        };

        for (const key in node) {
            const value = node[key];
            if (key.startsWith('@_')) {
                const attrName = key.substring(2);
                element.attributes[attrName] = value !== undefined && value !== null ? String(value).trim() : '';
            } else if (key === '#text') {
                if (typeof value === 'string' && value.trim()) {
                    element.textContent = value.trim();
                }
            } else if (key.includes('.')) {
                this._applyElementProperty(element, key, value);
            } else {
                const children = Array.isArray(value) ? value : [value];
                for (const child of children) {
                    const childElement = this._convertNodeToElement(key, child);
                    if (childElement) {
                        element.children.push(childElement);
                    }
                }
            }
        }

        element.name = element.attributes['x:Name'] || element.attributes['Name'];
        return element;
    }

    private _applyElementProperty(element: ParsedElement, propertyKey: string, rawValue: any) {
        const [owner, property] = propertyKey.split('.', 2);
        if (owner !== element.type) {
            return;
        }

        switch (property) {
            case 'Content':
            case 'Children':
                this._appendPropertyChildren(element, rawValue);
                break;
            case 'RowDefinitions':
                element.metadata.gridRows = this._extractGridDefinitions(rawValue, 'RowDefinition', 'Height');
                break;
            case 'ColumnDefinitions':
                element.metadata.gridColumns = this._extractGridDefinitions(rawValue, 'ColumnDefinition', 'Width');
                break;
            case 'StrokeShape':
                this._extractStrokeShape(element, rawValue);
                break;
            case 'Background':
                this._extractBackgroundBrush(element, rawValue);
                break;
            case 'Resources':
                // Parse implicit styles (TargetType without x:Key) from inline resources
                this._extractInlineStyles(element, rawValue);
                break;
            default:
                this._appendPropertyChildren(element, rawValue);
                break;
        }
    }

    private _appendPropertyChildren(element: ParsedElement, propertyValue: any) {
        if (!propertyValue || typeof propertyValue !== 'object') {
            return;
        }

        for (const key in propertyValue) {
            if (key.startsWith('@_') || key === '#text') {
                continue;
            }

            const value = propertyValue[key];
            const nodes = Array.isArray(value) ? value : [value];
            for (const node of nodes) {
                const childElement = this._convertNodeToElement(key, node);
                if (childElement) {
                    element.children.push(childElement);
                }
            }
        }
    }

    private _extractGridDefinitions(propertyValue: any, elementName: string, attributeName: string): string[] {
        const result: string[] = [];
        if (!propertyValue || typeof propertyValue !== 'object') {
            return result;
        }

        const definitions = propertyValue[elementName];
        const defArray = Array.isArray(definitions) ? definitions : definitions ? [definitions] : [];
        for (const def of defArray) {
            if (def && typeof def === 'object') {
                const value = def[`@_${attributeName}`] ?? def[attributeName] ?? def['#text'];
                result.push(value ? String(value).trim() : '*');
            }
        }

        return result;
    }

    private _extractStrokeShape(element: ParsedElement, propertyValue: any) {
        if (!propertyValue || typeof propertyValue !== 'object') {
            return;
        }

        const shape = propertyValue['RoundRectangle'];
        if (!shape) {
            return;
        }

        const shapes = Array.isArray(shape) ? shape : [shape];
        for (const item of shapes) {
            if (item && typeof item === 'object') {
                const corner = item['@_CornerRadius'] ?? item['CornerRadius'];
                if (corner) {
                    element.metadata.cornerRadius = String(corner).trim();
                }
            }
        }
    }

    private _extractBackgroundBrush(element: ParsedElement, propertyValue: any) {
        if (!propertyValue || typeof propertyValue !== 'object') {
            return;
        }

        // Look for LinearGradientBrush
        const linearBrush = propertyValue['LinearGradientBrush'];
        if (linearBrush) {
            const brushes = Array.isArray(linearBrush) ? linearBrush : [linearBrush];
            for (const brush of brushes) {
                if (brush && typeof brush === 'object') {
                    const startPoint = brush['@_StartPoint'] || '0,0';
                    const endPoint = brush['@_EndPoint'] || '1,1';

                    // Extract gradient stops
                    const gradientStops: Array<{ color: string; offset: string }> = [];
                    const stopsValue = brush['GradientStop'];
                    if (stopsValue) {
                        const stops = Array.isArray(stopsValue) ? stopsValue : [stopsValue];
                        for (const stop of stops) {
                            if (stop && typeof stop === 'object') {
                                const color = stop['@_Color'] || '';
                                const offset = stop['@_Offset'] || '0';
                                if (color) {
                                    gradientStops.push({ color, offset });
                                }
                            }
                        }
                    }

                    if (gradientStops.length > 0) {
                        // Store gradient info in metadata
                        element.metadata.gradientStops = gradientStops;
                        element.metadata.gradientStartPoint = startPoint;
                        element.metadata.gradientEndPoint = endPoint;
                    }
                }
            }
        }
    }

    private _extractInlineStyles(element: ParsedElement, resourceValue: any) {
        if (!resourceValue || typeof resourceValue !== 'object') {
            return;
        }

        // Look for Style entries inside the resource dictionary
        // The XML parser may give us ResourceDictionary wrapper or direct Style children
        let styleContainer = resourceValue;
        if (resourceValue['ResourceDictionary']) {
            styleContainer = resourceValue['ResourceDictionary'];
        }

        const styleNodes = styleContainer['Style'];
        if (!styleNodes) {
            return;
        }

        const styles = Array.isArray(styleNodes) ? styleNodes : [styleNodes];
        const inlineStyles: Array<{ targetType: string; setters: Record<string, string> }> = [];

        for (const styleNode of styles) {
            if (!styleNode || typeof styleNode !== 'object') {
                continue;
            }

            const targetType = styleNode['@_TargetType'];
            const hasKey = styleNode['@_x:Key'];

            // Only process implicit styles (TargetType without explicit x:Key)
            if (!targetType || hasKey) {
                continue;
            }

            const setters: Record<string, string> = {};
            const setterNodes = styleNode['Setter'];
            if (setterNodes) {
                const setterArray = Array.isArray(setterNodes) ? setterNodes : [setterNodes];
                for (const setter of setterArray) {
                    if (setter && typeof setter === 'object' && setter['@_Property'] && setter['@_Value'] !== undefined) {
                        setters[setter['@_Property']] = String(setter['@_Value']).trim();
                    }
                }
            }

            if (Object.keys(setters).length > 0) {
                inlineStyles.push({ targetType, setters });
            }
        }

        if (inlineStyles.length > 0) {
            element.metadata.inlineStyles = inlineStyles;
            console.log(`[PreviewProvider] Extracted ${inlineStyles.length} implicit styles from ${element.type}.Resources`);
        }
    }

    private _finalizeElementAttributes(element: ParsedElement, inheritedInlineStyles: Array<{ targetType: string; setters: Record<string, string> }> = []) {
        const resolved: Record<string, string> = { ...element.attributes };

        // Apply implicit styles from inherited inline styles (TargetType matching)
        for (const implicitStyle of inheritedInlineStyles) {
            if (implicitStyle.targetType === element.type) {
                for (const [prop, val] of Object.entries(implicitStyle.setters)) {
                    // Don't override VisualStateManager or complex properties
                    if (prop.includes('VisualState') || prop.includes('.')) {
                        continue;
                    }
                    if (!resolved[prop]) {
                        resolved[prop] = val;
                    }
                }
            }
        }

        const styleKey = this._extractResourceKey(resolved['Style']);
        if (styleKey) {
            const styleResource = this._resourceManager.resolveStyleResource(styleKey, this._styles);
            if (styleResource) {
                for (const setter in styleResource.setters) {
                    if (!resolved[setter]) {
                        resolved[setter] = styleResource.setters[setter];
                    }
                }
            }
        }

        for (const key of Object.keys(resolved)) {
            if (key.toLowerCase().includes('color')) {
                const color = this._resolveColor(resolved[key]);
                if (color) {
                    resolved[key] = color;
                }
            } else if (resolved[key] && resolved[key].startsWith('{StaticResource')) {
                const resourceKey = this._extractResourceKey(resolved[key]);
                if (resourceKey) {
                    const resourceValue = this._resourceManager.resolveStaticResource(resourceKey, this._resources);
                    if (resourceValue) {
                        resolved[key] = resourceValue;
                    }
                }
            }
        }

        element.resolvedAttributes = resolved;

        // Merge current element's inline styles with inherited ones for children
        const childInlineStyles = element.metadata.inlineStyles
            ? [...inheritedInlineStyles, ...element.metadata.inlineStyles]
            : inheritedInlineStyles;
        element.children.forEach(child => this._finalizeElementAttributes(child, childInlineStyles));
    }

    private _extractResourceKey(value?: string): string | undefined {
        if (!value) {
            return undefined;
        }
        const match = value.match(/\{(?:StaticResource|DynamicResource)\s+([^}]+)\}/);
        return match ? match[1].trim() : undefined;
    }

    private _indexParsedElements() {
        this._elementLookup.clear();
        const stack = [...this._parsedElements];
        while (stack.length) {
            const element = stack.shift()!;
            this._elementLookup.set(element.id, element);
            stack.unshift(...element.children);
        }
    }

    private _assignElementPositions(xamlContent: string) {
        this._elementMap.clear();

        const assign = (element: ParsedElement) => {
            if (element.metadata.isSynthetic) {
                element.children.forEach(assign);
                return;
            }

            // use the location from parser if available
            let startLine = element.metadata.startLine;
            let startIndex = element.metadata.startIndex;

            if (startLine !== undefined && startIndex !== undefined) {
                // fast-xml-parser lines are 1-based, we use 0-based
                startLine = Math.max(0, startLine - 1);

                // estimate end line
                let endLine = startLine;
                const remaining = xamlContent.substring(startIndex);
                const tagEnd = remaining.indexOf('>');

                if (tagEnd !== -1) {
                    const tagContent = remaining.substring(0, tagEnd + 1);
                    if (tagContent.trim().endsWith('/>')) {
                        // self-closing
                        const contentBeforeEnd = xamlContent.substring(0, startIndex + tagEnd);
                        endLine = contentBeforeEnd.split('\n').length - 1;
                    } else {
                        // find closing tag
                        const closingTag = `</${element.type}>`;
                        const closingIndex = xamlContent.indexOf(closingTag, startIndex);
                        if (closingIndex !== -1) {
                            const contentBeforeClosingEnd = xamlContent.substring(0, closingIndex + closingTag.length);
                            endLine = contentBeforeClosingEnd.split('\n').length - 1;
                        }
                    }
                }

                this._elementMap.set(element.id, {
                    startLine,
                    endLine,
                    elementName: element.type
                });
            }

            element.children.forEach(assign);
        };

        this._parsedElements.forEach(assign);
    }

    private _calculateLineOffsets(text: string): number[] {
        const offsets: number[] = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') {
                offsets.push(i + 1);
            }
        }
        return offsets;
    }

    private _getLineForIndex(index: number, offsets: number[]): number {
        if (index <= 0) {
            return 0;
        }
        let low = 0;
        let high = offsets.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (offsets[mid] === index) {
                return mid;
            }
            if (offsets[mid] < index) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return Math.max(0, low - 1);
    }

    private _generatePreviewHtml(): string {
        const platformSelector = this._platformManager.generatePlatformSelectorHtml();
        const deviceFrameCss = this._platformManager.generateDeviceFrameCss();
        const statusBarContent = this._platformManager.generateStatusBarContent();
        const navigationBarContent = this._platformManager.generateNavigationBarContent();
        const platformSwitchScript = this._platformManager.generatePlatformSwitchScript();
        const zoomScript = this._zoomManager.getWebviewZoomScript();
        const renderedContent = this._renderElements(this._parsedElements);

        // ── v0.2.3: Detect active module from file path for dynamic app shell ──
        const fp = (this._currentDocument?.uri?.fsPath ?? '').replace(/\\/g, '/');
        const fileName = fp.split('/').pop()?.replace(/\.xaml$/i, '') ?? '';
        let activeModule = 'Dashboard';
        if (/\/Sales\/|\/Prodaja\//i.test(fp))                     { activeModule = 'Prodaja'; }
        else if (/\/Purchases\/|\/Nabava\//i.test(fp))             { activeModule = 'Nabava'; }
        else if (/\/CRM\//i.test(fp))                              { activeModule = 'CRM'; }
        else if (/\/Finance\//i.test(fp))                          { activeModule = 'Finance'; }
        else if (/\/Inventory\/|\/Warehouse\/|\/Skladi/i.test(fp)) { activeModule = 'Skladišče'; }
        else if (/\/Manufacturing\/|\/Proizvodnja\//i.test(fp))    { activeModule = 'Proizvodnja'; }
        else if (/\/Projects\/|\/Projekti\//i.test(fp))            { activeModule = 'Projekti'; }
        else if (/\/Quality\/|\/Kakovost\//i.test(fp))             { activeModule = 'Kakovost'; }
        else if (/\/Service\/|\/Servis\//i.test(fp))               { activeModule = 'Servis'; }
        else if (/\/Products\/|\/Izdelki\//i.test(fp))             { activeModule = 'Izdelki'; }
        else if (/\/HRM\/|\/Kadri\//i.test(fp))                    { activeModule = 'HRM'; }
        // Human-readable tab label from file name
        const tabLabel = fileName.replace(/([A-Z])/g, ' $1').trim() || activeModule;
        // Helper: returns data-active attr string when module matches
        const sa = (mod: string) => activeModule === mod ? ' data-active="true"' : '';
        // shell-hidden when in selected mode
        const shellHidden = this._viewMode === 'selected' ? 'shell-hidden' : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MAUI XAML Preview</title>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<style>
    :root {
        color-scheme: light dark;
        --toolbar-bg: rgba(10, 25, 18, 0.85); /* Dark Green-Black Glass */
        --toolbar-border: rgba(255, 255, 255, 0.05);
        --toolbar-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        --accent-color: #512BD4;
        --sidebar-bg: #05100a; /* Very Dark Forest Green/Black */
        --text-main: #e2e8f0;
        --text-muted: #94a3b8;
    }

    @media (prefers-color-scheme: dark) {
        :root {
            --toolbar-bg: rgba(10, 25, 18, 0.9);
            --toolbar-border: rgba(255, 255, 255, 0.08);
            --sidebar-bg: #05100a;
            --text-main: #f1f5f9;
        }
    }

    body {
        margin: 0;
        padding: 0;
        background: var(--sidebar-bg);
        color: var(--text-main);
        overflow: hidden;
        height: 100vh;
        width: 100vw;
        display: flex;
        flex-direction: column;
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }


    .preview-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
    }

    .toolbar {
        background: var(--toolbar-bg);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--toolbar-border);
        padding: 12px 20px;
        display: flex;
        flex-wrap: nowrap;
        gap: 16px;
        align-items: center;
        z-index: 1000;
        box-shadow: var(--toolbar-shadow);
    }


    .zoom-controls, .view-mode-toggle {
        display: flex;
        align-items: center;
        gap: 2px;
        background: rgba(0,0,0,0.05);
        border-radius: 8px;
        padding: 2px;
    }

    .zoom-btn, .view-btn {
        padding: 6px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-main);
        transition: all 0.2s ease;
    }

    .zoom-btn:hover, .view-btn:hover {
        background: rgba(0,0,0,0.08);
    }

    .view-btn.active {
        background: var(--accent-color);
        color: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }


    .preview-viewport {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: stretch; /* was flex-start */
        overflow: auto;
        padding: 0; /* was 20px */
        background: var(--sidebar-bg);
    }


    .device-wrapper {
        transition: transform 0.3s ease;
        transform-origin: center top;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: stretch; /* was flex-start */
    }

    ${deviceFrameCss}

    .content-area {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: visible;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }

    .xaml-root {
        width: 100%;
        height: 100%;
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: stretch;
    }

    /* ── App Shell (Celoten pogled) ── */
    .app-shell {
        display: flex;
        width: 100%;
        height: 100%;
        flex: 1;
        min-width: 0;
        min-height: 0;
    }

    .app-shell-sidebar {
        width: 60px;
        min-width: 60px;
        background: #123a2f;
        display: flex;
        flex-direction: column;
        padding: 6px 4px;
        gap: 1px;
        overflow-y: auto;
        overflow-x: hidden;
        flex-shrink: 0;
        scrollbar-width: none;
    }
    .app-shell-sidebar::-webkit-scrollbar { display: none; }

    .app-shell-sidebar.shell-hidden {
        display: none;
    }

    .sidebar-icon-btn {
        width: 36px;
        height: 34px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #a0b3b0;
        font-family: 'Segoe Fluent Icons', 'Segoe MDL2 Assets', sans-serif;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        margin: 0 auto;
        flex-shrink: 0;
        transition: background 0.15s;
        position: relative;
    }
    .sidebar-icon-btn:hover {
        background: #1a4d3e;
        color: #e6f2ef;
    }
    .sidebar-icon-btn[data-active="true"] {
        background: rgba(102,126,234,0.18);
        color: #667eea;
    }
    .sidebar-icon-btn[title]:hover::after {
        content: attr(title);
        position: absolute;
        left: calc(100% + 10px);
        top: 50%;
        transform: translateY(-50%);
        background: #1a4d3e;
        color: #e6f2ef;
        padding: 3px 8px;
        border-radius: 4px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 12px;
        white-space: nowrap;
        pointer-events: none;
        z-index: 9999;
        border: 1px solid #2d5a4e;
    }

    .sidebar-sep {
        height: 1px;
        background: #2d5a4e;
        margin: 3px 4px;
        opacity: 0.5;
        flex-shrink: 0;
    }

    .app-shell-content {
        flex: 1;
        width: 0;          /* prevent flex child from overflowing */
        min-width: 0;
        min-height: 0;
        height: 100%;      /* concrete height so * rows resolve */
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    /* ── v0.2.3: Top toolbar ── */
    .app-shell-topbar {
        display: flex;
        align-items: center;
        background: #141922;
        border-bottom: 1px solid #2d5a4e;
        padding: 0 6px;
        height: 30px;
        min-height: 30px;
        flex-shrink: 0;
        overflow: hidden;
        gap: 2px;
    }
    .app-shell-topbar.shell-hidden { display: none; }

    .tb-btn {
        height: 22px;
        min-width: 22px;
        padding: 0 6px;
        background: #123a2f;
        border: none;
        border-radius: 4px;
        color: #a0b3b0;
        font-size: 11px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: default;
        flex-shrink: 0;
        white-space: nowrap;
    }
    .tb-btn:hover { background: #1a4d3e; color: #e6f2ef; }

    .tb-sep {
        width: 1px;
        height: 16px;
        background: #2d5a4e;
        margin: 0 3px;
        flex-shrink: 0;
    }

    .tb-search {
        height: 20px;
        background: #0b2b22;
        border: 1px solid #2d5a4e;
        border-radius: 4px;
        color: #e6f2ef;
        font-size: 10px;
        padding: 0 6px;
        width: 110px;
        outline: none;
        flex-shrink: 0;
    }

    .tb-zoom-label {
        color: #a0b3b0;
        font-size: 10px;
        padding: 0 3px;
        min-width: 34px;
        text-align: center;
        flex-shrink: 0;
    }

    .tb-spacer { flex: 1; }

    /* ── v0.2.3: Tab strip ── */
    .app-shell-tabstrip {
        display: flex;
        align-items: stretch;
        background: #0b2b22;
        border-bottom: 1px solid #2d5a4e;
        height: 30px;
        min-height: 30px;
        flex-shrink: 0;
        padding: 0 4px;
        gap: 2px;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
    }
    .app-shell-tabstrip.shell-hidden { display: none; }
    .app-shell-tabstrip::-webkit-scrollbar { display: none; }

    .tab-item {
        display: inline-flex;
        align-items: center;
        padding: 0 10px;
        font-size: 11px;
        color: #a0b3b0;
        border-bottom: 2px solid transparent;
        cursor: default;
        white-space: nowrap;
        gap: 6px;
        flex-shrink: 0;
        font-family: 'Segoe UI', sans-serif;
    }
    .tab-item.tab-active {
        color: #e6f2ef;
        border-bottom-color: #667eea;
    }
    .tab-close { opacity: 0.4; font-size: 10px; }

    .maui-element {
        box-sizing: border-box;
        position: relative;
        transition: box-shadow 0.15s ease, transform 0.15s ease;
        cursor: pointer;
        min-width: 0;
        flex-shrink: 0;
        width: 100%;
    }

    .maui-element:hover {
        box-shadow: 0 0 0 2px rgba(0,122,204,0.18);
    }

    .maui-element.hidden-element {
        display: none !important;
    }

    .maui-element.focused-element {
        box-shadow: 0 0 0 2px rgba(37,99,235,0.35), 0 8px 18px rgba(37,99,235,0.15);
    }

    .maui-element.selected {
        box-shadow: 0 0 0 3px #512BD4, 0 4px 12px rgba(81,43,212,0.3) !important;
        outline: 2px solid #512BD4;
        z-index: 100;
        position: relative;
    }

    .maui-element.ancestor-element {
        outline: 1px dashed rgba(37,99,235,0.35);
    }

    .maui-stacklayout {
        /* Layout set via inline styles */
    }

    .maui-stacklayout.is-horizontal {
        /* Handled by inline styles */
    }

    /* Children of HorizontalStackLayout should NOT stretch to 100% width */
    .maui-horizontalstacklayout > .maui-element {
        width: auto !important;
        flex-shrink: 0;
    }

    /* ContentPage and ContentView fill the full area */
    .maui-contentpage,
    .maui-contentview {
        width: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        overflow: hidden;
    }

    .maui-grid {
        /* Grid layout set via inline styles */
    }

    .maui-label {
        display: block;
        white-space: pre-wrap;
    }

    .maui-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }
        box-shadow: 0 3px 10px rgba(37,99,235,0.25);
    }

    .maui-button:disabled {
        opacity: 0.6;
    }

    .maui-border {
        box-sizing: border-box;
        /* All styles set via inline */
    }

    .maui-frame {
        box-sizing: border-box;
        /* All styles set via inline */
    }

    .maui-boxview {
        display: block;
        /* Size and colors set via inline */
    }

    .maui-entry {
        outline: none;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 6px;
        padding: 10px 14px;
        font-size: 14px;
        background: white;
        width: 100%;
        box-sizing: border-box;
        transition: border-color 0.2s;
    }

    .maui-entry:focus {
        border-color: var(--accent-color);
    }

    .maui-picker-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    .maui-picker-wrapper::after {
        content: '▼';
        position: absolute;
        right: 12px;
        font-size: 10px;
        pointer-events: none;
        opacity: 0.5;
    }

    .maui-picker {
        width: 100%;
        appearance: none;
        -webkit-appearance: none;
        padding: 10px 32px 10px 12px;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 6px;
        font-size: 14px;
        background: white;
        cursor: pointer;
        outline: none;
    }

    .maui-picker:focus {
        border-color: var(--accent-color);
    }

    .maui-activityindicator {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 24px;
    }

    .activity-spinner {
        border: 3px solid rgba(0,0,0,0.1);
        border-top: 3px solid #007acc;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    .maui-scrollview {
        width: 100%;
        max-height: 100%;
        overflow: auto;
        flex-shrink: 1;
    }

    .binding-placeholder {
        font-style: italic;
        color: #64748b;
    }

    .binding-value {
        /* design-time sample value — looks like real content */
        color: inherit;
        opacity: 0.85;
    }

    .structure-outline {
        border: 1px dashed rgba(148,163,184,0.6);
        border-radius: 6px;
    }
</style>
</head>
<body>
<div class="preview-container">
    <div class="toolbar">
        <div class="zoom-controls">
            <button id="zoomOut" class="zoom-btn" title="Zoom Out">−</button>
            <div id="zoomLevel" class="zoom-level">${this._zoomManager.getCurrentZoom()}%</div>
            <button id="zoomIn" class="zoom-btn" title="Zoom In">+</button>
            <button id="zoomFit" class="zoom-btn" title="Fit to Window">⌂</button>
            <button id="zoomActual" class="zoom-btn" title="Actual Size">1:1</button>
        </div>
        <div class="view-mode-toggle">
            <button class="view-btn ${this._viewMode === 'full' ? 'active' : ''}" data-mode="full" title="Prikaži celotno hierarhijo">Celoten pogled</button>
            <button class="view-btn ${this._viewMode === 'selected' ? 'active' : ''}" data-mode="selected" title="Prikaži samo izbrani element">Izbrani element</button>
        </div>
        <div class="view-mode-toggle" id="viewModeContainer">
             <button id="btnViewMain" class="view-btn active" title="Prikaži samo osnovno stran (brez popupov)">Osnovni</button>
             <button id="btnViewPopup" class="view-btn" title="Prikaži samo popup okna">Popup</button>
        </div>
        ${platformSelector}
        <div class="screenshot-controls" style="margin-left: auto;">
            <button id="btnScreenshot" class="zoom-btn" title="Naredi screenshot">📸</button>
        </div>
    </div>
    <div class="preview-viewport">
        <div class="device-wrapper">
            <div class="device-frame" id="deviceFrame">
                <div class="device-screen">
                    ${statusBarContent ? `<div class="status-bar">${statusBarContent}</div>` : ''}
                    ${navigationBarContent ? `<div class="navigation-bar">${navigationBarContent}</div>` : ''}
                    <div class="content-area">
                        <div class="app-shell">
                            <div class="app-shell-sidebar ${shellHidden}" id="appShellSidebar">
                                <!-- Hamburger -->
                                <div class="sidebar-icon-btn" title="">&#xE700;</div>
                                <div class="sidebar-sep"></div>
                                <!-- Group 1: CRM & Sales -->
                                <div class="sidebar-icon-btn" title="Dashboard"${sa('Dashboard')}>&#xE80F;</div>
                                <div class="sidebar-icon-btn" title="CRM"${sa('CRM')}>&#xE77B;</div>
                                <div class="sidebar-icon-btn" title="Prodaja"${sa('Prodaja')}>&#xE7BF;</div>
                                <div class="sidebar-icon-btn" title="Servis"${sa('Servis')}>&#xE90F;</div>
                                <div class="sidebar-sep"></div>
                                <!-- Group 2: Finance & Supply -->
                                <div class="sidebar-icon-btn" title="Finance"${sa('Finance')}>&#xE8C7;</div>
                                <div class="sidebar-icon-btn" title="Nabava"${sa('Nabava')}>&#xE7AC;</div>
                                <div class="sidebar-icon-btn" title="Skladi&#x161;&#x10D;e"${sa('Skladišče')}>&#xE7B8;</div>
                                <div class="sidebar-sep"></div>
                                <!-- Group 3: Manufacturing -->
                                <div class="sidebar-icon-btn" title="Izdelki"${sa('Izdelki')}>&#xECAD;</div>
                                <div class="sidebar-icon-btn" title="Proizvodnja"${sa('Proizvodnja')}>&#xE99A;</div>
                                <div class="sidebar-icon-btn" title="Projekti"${sa('Projekti')}>&#xE8FD;</div>
                                <div class="sidebar-icon-btn" title="Kakovost"${sa('Kakovost')}>&#xE73E;</div>
                            </div>
                            <div class="app-shell-content">
                                <!-- v0.2.3: Synthetic top toolbar -->
                                <div class="app-shell-topbar ${shellHidden}" id="appShellTopbar">
                                    <span class="tb-btn" title="Novo">&#xFF0B;</span>
                                    <span class="tb-btn" title="Uredi">&#x270F;</span>
                                    <span class="tb-btn" title="Izbri&#x161;i">&#xE74D;</span>
                                    <span class="tb-btn" title="Shrani">&#xE74E;</span>
                                    <span class="tb-sep"></span>
                                    <span class="tb-btn" title="Osvezi">&#xE72C;</span>
                                    <span class="tb-btn" title="Filter">&#xE71C;</span>
                                    <span class="tb-btn" title="Razvrsti">&#xE8CB;</span>
                                    <span class="tb-sep"></span>
                                    <span class="tb-btn" title="Natisni">&#xE749;</span>
                                    <span class="tb-btn" title="Excel">&#xE9F9;</span>
                                    <span class="tb-btn" title="PDF">&#xEA90;</span>
                                    <span class="tb-sep"></span>
                                    <span class="tb-btn" title="I&#x161;&#x10D;i">&#xE721;</span>
                                    <input class="tb-search" type="text" placeholder="I&#x161;&#x10D;i&#x2026;" readonly />
                                    <span class="tb-spacer"></span>
                                    <span class="tb-btn" title="Pomanj&#x161;aj">&#x2212;</span>
                                    <span class="tb-zoom-label">1.00&#xD7;</span>
                                    <span class="tb-btn" title="Pove&#x10D;aj">&#xFF0B;</span>
                                    <span class="tb-sep"></span>
                                    <span class="tb-btn" title="Obvestila">&#xE7E7;</span>
                                    <span class="tb-btn" title="Nastavitve">&#xE713;</span>
                                </div>
                                <!-- v0.2.3: Synthetic tab strip -->
                                <div class="app-shell-tabstrip ${shellHidden}" id="appShellTabstrip">
                                    <div class="tab-item tab-active"><span>${tabLabel}</span><span class="tab-close">&#xD7;</span></div>
                                </div>
                                <div class="xaml-root">
                                    ${renderedContent}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<script>
    const vscode = acquireVsCodeApi();
    window.vscode = vscode; // Make vscode API available globally for platform script
    ${platformSwitchScript}
    ${zoomScript}

    let currentViewMode = '${this._viewMode}';

    // Popup View Mode Logic
    const btnViewMain = document.getElementById('btnViewMain');
    const btnViewPopup = document.getElementById('btnViewPopup');
    
    const setPopupMode = (isPopup) => {
        if (btnViewMain) btnViewMain.classList.toggle('active', !isPopup);
        if (btnViewPopup) btnViewPopup.classList.toggle('active', isPopup);
        
        const root = document.querySelector('.xaml-root');
        if (!root) return;

        const simulatedPopups = document.querySelectorAll('.maui-detected-popup');
        const realPopups = document.querySelectorAll('.maui-popup-backdrop');

        if (isPopup) {
            // POPUP MODE: Show ONLY popups
            // Hide everything in root space
            root.style.visibility = 'hidden';
            
            // Re-enable visibility for popups
            simulatedPopups.forEach(el => {
                el.style.visibility = 'visible';
                el.style.display = ''; // Restore default display
            });
            realPopups.forEach(el => {
                el.style.visibility = 'visible';
                el.style.display = 'flex';
            });

        } else {
            // BASIC MODE: Show Main Content, Hide Popups
            root.style.visibility = ''; // Restore root visibility
            
            // Hide popups explicitly
            simulatedPopups.forEach(el => {
                el.style.display = 'none';
            });
            realPopups.forEach(el => {
                el.style.display = 'none';
            });
            
            // NEW: Hide Dynamic Screens (e.g. IsBusy overlays) in Basic Mode
            document.querySelectorAll('.maui-dynamic-screen').forEach(el => {
                el.style.display = 'none';
            });
        }
    };

    // Initialize: Main mode default (Popups hidden)
    setTimeout(() => {
        setPopupMode(false);
        detectDynamicScreens();
    }, 100);

    if (btnViewMain) {
        btnViewMain.addEventListener('click', () => {
            setPopupMode(false);
            activateTab(btnViewMain);
        });
    }
    if (btnViewPopup) {
        btnViewPopup.addEventListener('click', () => {
            setPopupMode(true);
            activateTab(btnViewPopup);
        });
    }

    // Dynamic Screen Detection
    const detectDynamicScreens = () => {
        const screens = document.querySelectorAll('.maui-dynamic-screen');
        const container = document.getElementById('viewModeContainer');
        if (!container) return;

        // Clear old dynamic buttons (if re-running)
        const oldBtns = container.querySelectorAll('.dynamic-tab-btn');
        oldBtns.forEach(b => b.remove());

        // Find unique binding names
        const uniqueBindings = new Set();
        screens.forEach(s => {
            const name = s.getAttribute('data-binding-name');
            if (name) uniqueBindings.add(name);
        });

        uniqueBindings.forEach(bindingName => {
            const btn = document.createElement('button');
            btn.className = 'view-btn dynamic-tab-btn';
            btn.textContent = bindingName; // e.g. "IsDetailVisible"
            btn.title = 'Switch to ' + bindingName + ' View';
            btn.onclick = () => {
                activateTab(btn);
                switchToDynamicScreen(bindingName);
            };
            container.appendChild(btn);
        });
    };

    const activateTab = (activeBtn) => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
    };

    const switchToDynamicScreen = (bindingName) => {
        const root = document.querySelector('.xaml-root');
        if (!root) return;

        // Standard Mode logic (hide popups)
        setPopupMode(false); 
        // But additionally:
        // Hide ALL dynamic screens
        document.querySelectorAll('.maui-dynamic-screen').forEach(el => {
            el.style.display = 'none';
        });
        
        // Show ONLY the target screens
        // And make sure they are visible inside root
        root.style.visibility = ''; 
        
        const targets = document.querySelectorAll('.maui-dynamic-screen[data-binding-name="' + bindingName + '"]');
        targets.forEach(el => {
            el.style.display = ''; // default
            // Potentially ensure parent visibility if needed?
        });
    };
    
    // Add Click Handler for Selection Highlighting
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'elementClicked') {
            vscode.postMessage({ type: 'selectElement', elementId: message.elementId });
        }
    });

    // Helpers for mapping MAUI-like values to CSS
    const toPx = (v) => {
        if (v == null) return '';
        const s = String(v).trim();
        if (!s) return '';
        // Preserve if looks like CSS unit already
        if (/^(\d+\.?\d*)(px|em|rem|%)$/i.test(s)) return s;
        // number -> px
        if (/^\d+(\.\d+)?$/.test(s)) return s + 'px';
        return s;
    };

    const parseThickness = (val) => {
        if (!val && val !== 0) return '';
        const raw = String(val).trim();
        if (!raw) return '';
        // Allow comma or space separated
        const parts = raw.split(/[ ,]+/).filter(Boolean).map(n => n.trim());
        if (parts.length === 1) {
            const a = toPx(parts[0]);
            return a + ' ' + a + ' ' + a + ' ' + a;
        }
        if (parts.length === 2) {
            // MAUI: h, v -> CSS: top right bottom left = v h v h
            const h = toPx(parts[0]);
            const v = toPx(parts[1]);
            return v + ' ' + h + ' ' + v + ' ' + h;
        }
        if (parts.length === 4) {
            const t = toPx(parts[0]);
            const r = toPx(parts[1]);
            const b = toPx(parts[2]);
            const l = toPx(parts[3]);
            return t + ' ' + r + ' ' + b + ' ' + l;
        }
        // Fallback: join as-is
        return parts.map(toPx).join(' ');
    };

    const parseCornerRadius = (val) => {
        if (!val && val !== 0) return '';
        const raw = String(val).trim();
        if (!raw) return '';
        const parts = raw.split(/[ ,]+/).filter(Boolean).map(n => n.trim());
        if (parts.length === 1) {
            const a = toPx(parts[0]);
            return a;
        }
        if (parts.length === 2) {
            // CSS semantics: tl/br then tr/bl
            const a = toPx(parts[0]);
            const b = toPx(parts[1]);
            return a + ' ' + b;
        }
        if (parts.length === 3) {
            // CSS: tl tr br
            const a = toPx(parts[0]);
            const b = toPx(parts[1]);
            const c = toPx(parts[2]);
            return a + ' ' + b + ' ' + c;
        }
        if (parts.length >= 4) {
            // Assume order tl, tr, br, bl which matches CSS
            const tl = toPx(parts[0]);
            const tr = toPx(parts[1]);
            const br = toPx(parts[2]);
            const bl = toPx(parts[3]);
            return tl + ' ' + tr + ' ' + br + ' ' + bl;
        }
        return '';
    };

    const setViewModeButtons = (mode) => {
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
        });
    };

    const applyViewMode = (mode, selectedId) => {
        currentViewMode = mode || currentViewMode || 'full';
        setViewModeButtons(currentViewMode);

        // Toggle app-shell sidebar based on view mode
        const sidebar = document.getElementById('appShellSidebar');
        if (sidebar) {
            if (currentViewMode === 'selected') {
                sidebar.classList.add('shell-hidden');
            } else {
                sidebar.classList.remove('shell-hidden');
            }
        }
        // v0.2.3: toggle topbar + tabstrip
        const topbar = document.getElementById('appShellTopbar');
        const tabstrip = document.getElementById('appShellTabstrip');
        if (topbar)   { topbar.classList.toggle('shell-hidden',   currentViewMode === 'selected'); }
        if (tabstrip) { tabstrip.classList.toggle('shell-hidden', currentViewMode === 'selected'); }

        const root = document.querySelector('.xaml-root');
        if (!root) {
            return;
        }

        const elements = root.querySelectorAll('.maui-element');
        elements.forEach(el => el.classList.remove('hidden-element', 'focused-element', 'ancestor-element'));

        if (currentViewMode !== 'selected' || !selectedId) {
            return;
        }

        elements.forEach(el => el.classList.add('hidden-element'));

        const target = root.querySelector('[data-element-id="' + selectedId + '"]');
        if (!target) {
            elements.forEach(el => el.classList.remove('hidden-element'));
            return;
        }

        target.classList.remove('hidden-element');
        target.classList.add('focused-element');

        target.querySelectorAll('.maui-element').forEach(child => child.classList.remove('hidden-element'));

        let ancestor = target.parentElement ? target.parentElement.closest('.maui-element') : null;
        while (ancestor) {
            ancestor.classList.remove('hidden-element');
            ancestor.classList.add('ancestor-element');
            ancestor = ancestor.parentElement ? ancestor.parentElement.closest('.maui-element') : null;
        }
    };

    const setupViewModeToggle = () => {
        const buttons = document.querySelectorAll('.view-btn');
        if (!buttons.length) {
            return;
        }

        const activeButton = document.querySelector('.view-btn.active');
        if (activeButton) {
            currentViewMode = activeButton.getAttribute('data-mode') || 'full';
        }

        buttons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const mode = btn.getAttribute('data-mode') || 'full';
                if (mode === currentViewMode) {
                    return;
                }
                vscode.postMessage({ command: 'changeViewMode', mode });
            });
        });
    };

    setupViewModeToggle();
    applyViewMode(currentViewMode);

    const notifySelection = (element) => {
        if (!element) return;
        vscode.postMessage({
            command: 'elementSelected',
            elementId: element.getAttribute('data-element-id'),
            line: element.getAttribute('data-line')
        });
    };

    document.addEventListener('click', (event) => {
        const target = event.target.closest('.maui-element');
        if (!target) {
            return;
        }

        document.querySelectorAll('.maui-element.selected').forEach(el => el.classList.remove('selected'));
        target.classList.add('selected');
        applyViewMode(currentViewMode, target.getAttribute('data-element-id'));
        notifySelection(target);
        event.preventDefault();
        event.stopPropagation();
    });

    // Ensure platform buttons work even if inline handler is blocked
    setTimeout(() => {
        document.querySelectorAll('.platform-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pf = btn.getAttribute('data-platform');
                if (pf && typeof window.switchPlatform === 'function') {
                    window.switchPlatform(pf);
                }
            }, { once: false });
        });
    }, 0);

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message) {
            return;
        }

        if (message.type === 'updateZoom' && window.webViewZoomManager) {
            window.webViewZoomManager.setZoom(message.zoom);
        }

        if (message.type === 'fitToViewport' && window.webViewZoomManager) {
            window.webViewZoomManager.fitToViewport();
        }

        if (message.type === 'applyViewMode') {
            applyViewMode(message.mode, message.selectedId);
        }

        if (message.type === 'selectElement') {
            const elId = message.elementId;
            const targetEl = document.querySelector('[data-element-id="' + elId + '"]');
            if (targetEl) {
                document.querySelectorAll('.maui-element.selected').forEach(el => el.classList.remove('selected'));
                targetEl.classList.add('selected');
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (currentViewMode === 'selected') {
                    applyViewMode('selected', elId);
                }
            }
        }

        if (message.type === 'updateProperty') {
            try {
                const selected = document.querySelector('.maui-element.selected');
                if (selected) {
                    const key = message.property || '';
                    const val = String(message.value ?? '').trim();

                    const setStyle = (k, v) => selected && (selected.style[k] = v);
                    const px = (v) => (/^\d+(\.\d+)?$/.test(v) ? (v + 'px') : v);

                    const kLower = key.toLowerCase();
                    if (kLower === 'background' || kLower.includes('backgroundcolor')) setStyle('backgroundColor', val);
                    else if (kLower.includes('textcolor') || kLower === 'color') setStyle('color', val);
                    else if (kLower === 'widthrequest' || kLower === 'width') setStyle('width', px(val));
                    else if (kLower === 'heightrequest' || kLower === 'height') setStyle('height', px(val));
                    else if (kLower === 'maxwidthrequest' || kLower === 'maxwidth') setStyle('maxWidth', px(val));
                    else if (kLower === 'maxheightrequest' || kLower === 'maxheight') setStyle('maxHeight', px(val));
                    else if (kLower === 'minwidthrequest' || kLower === 'minwidth') setStyle('minWidth', px(val));
                    else if (kLower === 'minheightrequest' || kLower === 'minheight') setStyle('minHeight', px(val));
                    else if (kLower === 'padding') setStyle('padding', parseThickness(val));
                    else if (kLower === 'margin') setStyle('margin', parseThickness(val));
                    else if (kLower === 'cornerradius') setStyle('borderRadius', parseCornerRadius(val));
                    else if (kLower === 'bordercolor' || kLower === 'stroke') setStyle('borderColor', val);
                    else if (kLower === 'borderthickness' || kLower === 'strokethickness') setStyle('borderWidth', parseThickness(val));
                    else if (kLower === 'grid.row') setStyle('gridRowStart', val);
                    else if (kLower === 'grid.column') setStyle('gridColumnStart', val);
                    else if (kLower === 'grid.rowspan') selected.style.gridRowEnd = 'span ' + (parseInt(val, 10) || 1);
                    else if (kLower === 'grid.columnspan') selected.style.gridColumnEnd = 'span ' + (parseInt(val, 10) || 1);
                    else if (kLower === 'opacity') setStyle('opacity', val);
                    else if (kLower === 'isvisible') setStyle('display', (val.toLowerCase() === 'false' || val === '0') ? 'none' : '');
                    else if (kLower === 'isenabled') { setStyle('pointerEvents', (val.toLowerCase() === 'false' || val === '0') ? 'none' : ''); setStyle('opacity', (val.toLowerCase() === 'false' || val === '0') ? '0.6' : ''); }
                    else if (kLower === 'fontsize') setStyle('fontSize', px(val));
                    else if (kLower === 'fontfamily') setStyle('fontFamily', val);
                    else if (kLower === 'lineheight') setStyle('lineHeight', val);
                    else if (kLower === 'characterspacing') setStyle('letterSpacing', px(val));
                    else if (kLower === 'textdecorations') setStyle('textDecoration', val.toLowerCase());
                    else if (kLower === 'fontattributes') {
                        const low = val.toLowerCase();
                        if (low.includes('bold')) setStyle('fontWeight', '600');
                        else setStyle('fontWeight', '');
                        if (low.includes('italic')) setStyle('fontStyle', 'italic');
                        else setStyle('fontStyle', '');
                    }
                    else if (kLower === 'horizontaltextalignment' || kLower === 'textalignment') {
                        const map = { start: 'left', center: 'center', end: 'right' };
                        setStyle('textAlign', map[val.toLowerCase()] || val);
                    }
                    else if (kLower === 'horizontaloptions') {
                        const low = val.toLowerCase();
                        const map = { start: 'flex-start', center: 'center', end: 'flex-end', fill: 'stretch' };
                        setStyle('alignSelf', map[low] || '');
                    }
                    else if (kLower === 'verticaloptions') {
                        const low = val.toLowerCase();
                        const map = { start: 'flex-start', center: 'center', end: 'flex-end', fill: 'stretch' };
                        setStyle('alignSelf', map[low] || '');
                    }
                    else if (kLower === 'aspect') {
                        const map = { aspectfit: 'contain', aspectfill: 'cover', fill: 'fill' };
                        setStyle('objectFit', map[val.toLowerCase()] || 'contain');
                    }

                    if (key === 'Text') {
                        selected.innerText = val;
                    }
                }
            } catch (e) {
                console.warn('[Webview] Failed to apply property update', e);
            }
        }

        if (message.type === 'selectElement') {
            const root = document.querySelector('.xaml-root');
            if (!root) return;
            const target = root.querySelector('[data-element-id="' + message.elementId + '"]');
            if (!target) return;
            document.querySelectorAll('.maui-element.selected').forEach(el => el.classList.remove('selected'));
            target.classList.add('selected');
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            applyViewMode(currentViewMode, message.elementId);
        }
    });

    // Screenshot functionality
    const btnScreenshot = document.getElementById('btnScreenshot');
    if (btnScreenshot) {
        btnScreenshot.addEventListener('click', async () => {
            try {
                btnScreenshot.textContent = '⏳';
                btnScreenshot.disabled = true;
                
                const deviceFrame = document.getElementById('deviceFrame');
                if (!deviceFrame) {
                    vscode.postMessage({ type: 'showError', message: 'Device frame not found' });
                    return;
                }
                
                const canvas = await html2canvas(deviceFrame, {
                    backgroundColor: null,
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    logging: false
                });
                
                const dataUrl = canvas.toDataURL('image/png');
                vscode.postMessage({ 
                    type: 'requestScreenshot', 
                    dataUrl: dataUrl,
                    timestamp: new Date().toISOString()
                });
                
                btnScreenshot.textContent = '✓';
                setTimeout(() => {
                    btnScreenshot.textContent = '📸';
                    btnScreenshot.disabled = false;
                }, 1500);
            } catch (err) {
                console.error('Screenshot failed:', err);
                vscode.postMessage({ type: 'showError', message: 'Screenshot failed: ' + err.message });
                btnScreenshot.textContent = '⚠';
                setTimeout(() => {
                    btnScreenshot.textContent = '📸';
                    btnScreenshot.disabled = false;
                }, 2000);
            }
        });
    }

    vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
    }

    private _renderElements(elements: ParsedElement[]): string {
        return elements.map(element => this._renderElement(element)).join('');
    }

    private _renderElement(element: ParsedElement): string {
        const classes = ['maui-element'];
        const typeClass = `maui-${element.type.toLowerCase()}`;
        classes.push(typeClass);

        // Detect Simulated Popup (High ZIndex)
        const zIdxStr = element.resolvedAttributes['ZIndex'];
        if (zIdxStr) {
            const z = parseInt(zIdxStr, 10);
            if (!isNaN(z) && z >= 10) {
                classes.push('maui-detected-popup');
            }
        }
        if (element.type === 'Popup' || element.type === 'toolkit:Popup') {
            classes.push('maui-detected-popup');
        }

        // Detect Dynamic Screen (IsVisible Binding)
        // Only major layout containers should be treated as dynamic screens (overlay/toggle)
        // Simple elements like Button, Label, BoxView, Entry should remain visible in preview
        let bindingName = '';
        const isVisibleAttr = element.attributes['IsVisible'] || element.resolvedAttributes['IsVisible'];
        if (isVisibleAttr && typeof isVisibleAttr === 'string' && isVisibleAttr.includes('{Binding')) {
            const match = isVisibleAttr.match(/Binding\s+(?:Path=)?([A-Za-z0-9_.]+)/);
            if (match && match[1]) {
                bindingName = match[1];
                // Only classify full-screen overlays (Grid, StackLayout, AbsoluteLayout) as dynamic screens
                const dynamicScreenTypes = ['Grid', 'StackLayout', 'VerticalStackLayout', 'AbsoluteLayout', 'ContentView'];
                if (dynamicScreenTypes.includes(element.type)) {
                    classes.push('maui-dynamic-screen');
                }
                // Simple elements with IsVisible bindings remain visible for preview
            }
        }

        const childrenHtml = element.children.map(child => this._renderElement(child)).join('');
        const text = this._renderElementText(element);

        // Helper variables for HTML attributes
        const dataId = `data-element-id="${element.id}"`;
        const dataLine = `data-line="${element.metadata.startLine !== undefined ? element.metadata.startLine : ''}"`;
        const dataBinding = bindingName ? `data-binding-name="${bindingName}"` : '';
        // NOTE: styleAttr is computed AFTER the switch so layout-specific properties are included
        // Each case that uses styles will call _buildInlineStyle inline
        let styleAttr = '';
        // Fix 4: Use ToolTipProperties.Text for tooltip if available
        const tooltipText = element.resolvedAttributes['ToolTipProperties.Text'];
        const titleContent = tooltipText && !tooltipText.includes('{Binding')
            ? this._escapeHtml(tooltipText)
            : `${element.type}${element.name ? ' (' + element.name + ')' : ''}`;
        const titleAttr = `title="${titleContent}"`;
        const onClick = `onclick="notifySelection(this)"`;

        switch (element.type) {
            case 'Popup':
            case 'toolkit:Popup':
                // Popup needs to be an overlay
                // We'll create a backdrop + the popup content centered
                const backdropStyle = `
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: rgba(0,0,0,0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                `;
                // Verify if explicit size is set, otherwise auto
                const contentStyle = this._buildInlineStyle(element) + '; box-shadow: 0 4px 16px rgba(0,0,0,0.2); max-height: 90vh; max-width: 90vw; overflow: auto;';

                return `
                <div class="maui-popup-backdrop" style="${backdropStyle}">
                    <div class="${classes.join(' ')}" ${dataId}${dataLine}${dataBinding} style="${contentStyle}"${titleAttr} ${onClick}>
                        ${this._renderElementText(element)}
                        ${childrenHtml}
                    </div>
                </div>`;
            case 'Label': {
                const labelStyle = this._buildInlineStyle(element);
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine}${dataBinding} style="${labelStyle}"${titleAttr} ${onClick}>${text}</div>`;
            }
            case 'Button': {
                const buttonStyle = this._buildInlineStyle(element);
                return `<button class="${classes.join(' ')}" ${dataId}${dataLine}${dataBinding} style="${buttonStyle}" ${titleAttr} ${onClick}>
                            <span>${text || 'Button'}</span>
                        </button>`;
            }
            case 'Entry': {
                const textValue = element.resolvedAttributes['Text'] ?? element.textContent;
                const placeholder = element.resolvedAttributes['Placeholder'] || '';
                const isPassword = element.resolvedAttributes['IsPassword'] === 'True';
                const inputType = isPassword ? 'password' : 'text';

                let displayValue = '';
                let displayPlaceholder = placeholder;

                if (textValue && textValue.includes('{Binding')) {
                    const bindingMatch = textValue.match(/\{Binding\s+([^}]+)\}/i);
                    if (bindingMatch) {
                        const propName = bindingMatch[1].split(',')[0].trim().replace(/^Path\s*=\s*/i, '');
                        const designValue = this._resolveBindingValue(propName);
                        if (designValue !== undefined && designValue !== '') {
                            displayValue = designValue;
                        } else {
                            displayPlaceholder = displayPlaceholder || `[${propName}]`;
                        }
                    }
                } else {
                    displayValue = textValue || '';
                }

                // If no placeholder and no text, show type as hint
                if (!displayPlaceholder && !displayValue) {
                    displayPlaceholder = element.type;
                }

                return `<input type="${inputType}" class="${classes.join(' ')}" ${dataId}${dataLine}${dataBinding} style="${this._buildInlineStyle(element)}" ${titleAttr} value="${this._escapeHtml(displayValue)}" placeholder="${this._escapeHtml(displayPlaceholder)}" ${onClick} />`;
            }
            case 'Editor': {
                const editorStyle = this._buildInlineStyle(element);
                return `<textarea class="${classes.join(' ')}" ${dataId}${dataLine} style="${editorStyle}"${titleAttr}>${this._escapeHtml(text || '')}</textarea>`;
            }
            case 'ScrollView': {
                const scrollStyle = this._buildInlineStyle(element);
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine} style="${scrollStyle}"${titleAttr}><div class="scroll-content">${childrenHtml}</div></div>`;
            }
            case 'Image': {
                const imgStyle = this._buildInlineStyle(element);
                const source = element.resolvedAttributes['Source'];
                if (source && !source.includes('{Binding')) {
                    const webviewUri = this._getImageWebviewUri(source);
                    if (webviewUri) {
                        return `<div class="${classes.join(' ')}" ${dataId}${dataLine} style="${imgStyle}"${titleAttr}>
                            <img src="${webviewUri}" alt="${text || 'Image'}" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.style.display='none'; this.parentElement.innerHTML='<span class=\\'binding-placeholder\\'>Image not found</span>'" />
                        </div>`;
                    } else {
                        return `<div class="${classes.join(' ')}" ${dataId}${dataLine} style="${imgStyle}"${titleAttr}><span class="binding-placeholder">${source}</span></div>`;
                    }
                } else {
                    return `<div class="${classes.join(' ')}" ${dataId}${dataLine} style="${imgStyle}"${titleAttr}><span class="binding-placeholder">${text || source || 'Image'}</span></div>`;
                }
            }
            case 'ActivityIndicator': {
                const isRunning = element.resolvedAttributes['IsRunning'] === 'True';
                const indicatorColor = this._resolveColor(element.resolvedAttributes['Color']) || '#007acc';
                const actStyle = this._buildInlineStyle(element);
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine} style="${actStyle}"${titleAttr}>
                    ${isRunning ? `<div class="activity-spinner" style="border-top-color: ${indicatorColor}"></div>` : ''}
                </div>`;
            }
            case 'Picker': {
                const pickerTitle = element.resolvedAttributes['Title'] || 'Select...';
                const pickerStyle = this._buildInlineStyle(element);

                // Resolve items from x:Static or {Binding} on ItemsSource
                let pickerItems: string[] = [];
                const itemsSource = element.resolvedAttributes['ItemsSource'];
                if (itemsSource) {
                    // {x:Static vm:ClassName.StaticProp}
                    const xStaticMatch = itemsSource.match(/x:Static\s+(?:\w+:)?\w+\.(\w+)/i);
                    if (xStaticMatch) {
                        const itemsJson = this._designTimeData.get(`${xStaticMatch[1]}__items`);
                        if (itemsJson) { try { pickerItems = JSON.parse(itemsJson); } catch (_) {} }
                    }
                    // {Binding SomeProp}
                    if (pickerItems.length === 0 && itemsSource.includes('{Binding')) {
                        const bm = itemsSource.match(/Binding\s+([^,}]+)/i);
                        if (bm) {
                            const propName = bm[1].trim().replace(/^Path\s*=\s*/i, '');
                            const itemsJson = this._designTimeData.get(`${propName}__items`);
                            if (itemsJson) { try { pickerItems = JSON.parse(itemsJson); } catch (_) {} }
                        }
                    }
                }

                const optionsHtml = pickerItems.length > 0
                    ? pickerItems.map(item => `<option>${this._escapeHtml(item)}</option>`).join('')
                    : `<option>Item 1</option><option>Item 2</option>`;

                return `<div class="maui-picker-wrapper" style="${pickerStyle}">
                            <select class="${classes.join(' ')}" ${dataId}${dataLine}${titleAttr} ${onClick}>
                                <option disabled selected>${this._escapeHtml(pickerTitle)}</option>
                                ${optionsHtml}
                            </select>
                        </div>`;
            }
            case 'CollectionView': {
                // Render CollectionView as a flex container with placeholder items
                const cvLayout = element.resolvedAttributes['ItemsLayout'] || '';
                const isHorizontal = cvLayout.toLowerCase().includes('horizontal');
                const cvStyle = this._buildInlineStyle(element);
                // Check for LinearItemsLayout child that specifies orientation
                let orientation = 'vertical';
                for (const child of element.children) {
                    if (child.type === 'LinearItemsLayout') {
                        const orient = child.resolvedAttributes['Orientation'] || child.attributes['Orientation'];
                        if (orient && orient.toLowerCase() === 'horizontal') {
                            orientation = 'horizontal';
                        }
                    }
                }
                const flexDir = orientation === 'horizontal' ? 'row' : 'column';
                const itemSpacing = element.children.find(c => c.type === 'LinearItemsLayout')?.resolvedAttributes['ItemSpacing'] || '4';
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine}${dataBinding} style="${cvStyle}; display: flex; flex-direction: ${flexDir}; gap: ${itemSpacing}px;" ${titleAttr} ${onClick}>
                    <span class="binding-placeholder" style="font-size: 10px; opacity: 0.6;">CollectionView [data-bound]</span>
                </div>`;
            }
            default: {
                const defaultStyle = this._buildInlineStyle(element);
                return `<div class="${classes.join(' ')}" ${dataId}${dataLine} style="${defaultStyle}"${titleAttr}>${text}${childrenHtml}</div>`;
            }
        }
    }

    private _renderElementText(element: ParsedElement): string {
        const textValue = element.resolvedAttributes['Text'] ?? element.textContent;
        if (!textValue) {
            return '';
        }

        const bindingMatch = textValue.match(/\{Binding\s+([^}]+)\}/i);
        if (bindingMatch) {
            const bindingContent = bindingMatch[1].trim();

            // Extract property path
            const bindingPath = bindingContent.split(',')[0].trim().replace(/^Path\s*=\s*/i, '');

            // Extract optional StringFormat
            const stringFormatMatch = bindingContent.match(/StringFormat\s*=\s*'([^']+)'/i)
                || bindingContent.match(/StringFormat\s*=\s*([^,}]+)/i);
            const formatStr = stringFormatMatch?.[1]?.trim();

            // Try design-time value (ViewModel data + heuristics)
            const resolved = this._resolveBindingValue(bindingPath, formatStr);
            if (resolved !== undefined) {
                if (resolved === '') { return ''; }
                return `<span class="binding-value">${this._escapeHtml(resolved)}</span>`;
            }

            // Fallback: show formatted placeholder (legacy behaviour)
            if (formatStr) {
                let displayText = formatStr
                    .replace(/\{0:F(\d+)\}/i, (_, digits) => (1.0).toFixed(Number(digits)))
                    .replace(/\{0:N(\d+)\}/i, (_, digits) => (1000).toFixed(Number(digits)))
                    .replace(/\{0:P(\d+)\}/i, (_, digits) => (50).toFixed(Number(digits)) + '%')
                    .replace(/\{0:C(\d+)\}/i, (_, digits) => '$' + (100).toFixed(Number(digits)))
                    .replace(/\{0\}/g, '...')
                    .replace(/\{0:[^}]+\}/g, '...');
                return `<span class="binding-placeholder">${this._escapeHtml(displayText)}</span>`;
            }
            return `<span class="binding-placeholder">${this._escapeHtml(bindingPath)}</span>`;
        }

        return this._escapeHtml(textValue);
    }

    private _buildInlineStyle(element: ParsedElement): string {
        const style = new Map<string, string>();
        const attrs = element.resolvedAttributes;

        // Check for gradient background first
        if (element.metadata.gradientStops && element.metadata.gradientStops.length > 0) {
            const gradient = this._buildGradientCss(element.metadata.gradientStops,
                element.metadata.gradientStartPoint,
                element.metadata.gradientEndPoint);
            if (gradient) {
                style.set('background', gradient);
            }
        } else {
            // Regular solid background
            const background = attrs['Background'] || attrs['BackgroundColor'];
            const resolvedBackground = this._resolveColor(background);
            if (resolvedBackground) {
                style.set('background-color', resolvedBackground);
            }
        }

        const textColor = this._resolveColor(attrs['TextColor'] || attrs['Color']);
        if (textColor) {
            style.set('color', textColor);
        }

        if (attrs['Opacity']) {
            const opacityValue = Number(attrs['Opacity']);
            if (!Number.isNaN(opacityValue)) {
                style.set('opacity', Math.max(0, Math.min(opacityValue, 1)).toString());
            }
        }

        if (attrs['WidthRequest']) {
            style.set('width', this._toPixels(attrs['WidthRequest']));
        }

        if (attrs['HeightRequest']) {
            style.set('height', this._toPixels(attrs['HeightRequest']));
        }

        if (attrs['MinWidth']) {
            style.set('min-width', this._toPixels(attrs['MinWidth']));
        }

        if (attrs['MinHeight']) {
            style.set('min-height', this._toPixels(attrs['MinHeight']));
        }

        if (attrs['MaxWidth']) {
            style.set('max-width', this._toPixels(attrs['MaxWidth']));
        }

        if (attrs['MaxHeight']) {
            style.set('max-height', this._toPixels(attrs['MaxHeight']));
        }

        if (attrs['Padding']) {
            style.set('padding', this._convertThickness(attrs['Padding']));
        }

        if (attrs['Margin']) {
            style.set('margin', this._convertThickness(attrs['Margin']));
        }

        if (attrs['HorizontalOptions']) {
            this._applyLayoutOptions(style, 'horizontal', attrs['HorizontalOptions']);
        }

        if (attrs['VerticalOptions']) {
            this._applyLayoutOptions(style, 'vertical', attrs['VerticalOptions']);
        }

        if (attrs['FontSize']) {
            style.set('font-size', this._toPixels(attrs['FontSize']));
        }

        if (attrs['FontAttributes']) {
            const fontAttributes = attrs['FontAttributes'].toLowerCase();
            if (fontAttributes.includes('bold')) {
                style.set('font-weight', '600');
            }
            if (fontAttributes.includes('italic')) {
                style.set('font-style', 'italic');
            }
        }

        if (attrs['FontFamily']) {
            style.set('font-family', attrs['FontFamily']);
        }

        if (attrs['HorizontalTextAlignment']) {
            style.set('text-align', attrs['HorizontalTextAlignment'].toLowerCase());
        }

        if (attrs['LineHeight']) {
            style.set('line-height', attrs['LineHeight']);
        }

        if (attrs['Grid.Row']) {
            const rowIndex = Number(attrs['Grid.Row']);
            if (!Number.isNaN(rowIndex)) {
                const span = Number(attrs['Grid.RowSpan'] ?? '1');
                const rowValue = `${rowIndex + 1} / span ${Number.isNaN(span) ? 1 : span}`;
                style.set('grid-row', rowValue);
            }
        }

        if (attrs['Grid.Column']) {
            const colIndex = Number(attrs['Grid.Column']);
            if (!Number.isNaN(colIndex)) {
                const span = Number(attrs['Grid.ColumnSpan'] ?? '1');
                const colValue = `${colIndex + 1} / span ${Number.isNaN(span) ? 1 : span}`;
                style.set('grid-column', colValue);
            }
        }

        // Synthetic ContentPage host: fill .xaml-root so device height propagates into the layout chain
        if (element.metadata.isSynthetic && element.type === 'ContentPage') {
            style.set('width', '100%');
            style.set('height', '100%');
            style.set('display', 'flex');
            style.set('flex-direction', 'column');
        }

        switch (element.type) {
            case 'StackLayout':
            case 'VerticalStackLayout': {
                style.set('display', 'flex');
                style.set('flex-direction', 'column');
                style.set('width', '100%'); // CRITICAL: Must use width, not flex
                style.set('box-sizing', 'border-box');
                style.set('align-items', 'stretch'); // Children stretch to full width
                const spacing = attrs['Spacing'] || '0';
                if (spacing && spacing !== '0') {
                    style.set('gap', this._toPixels(spacing));
                }
                break;
            }
            case 'HorizontalStackLayout': {
                style.set('display', 'flex');
                style.set('flex-direction', 'row');
                style.set('width', '100%'); // CRITICAL: Must use width, not flex
                style.set('box-sizing', 'border-box');
                const spacing = attrs['Spacing'] || '0';
                if (spacing && spacing !== '0') {
                    style.set('gap', this._toPixels(spacing));
                }
                break;
            }
            case 'Grid': {
                style.set('display', 'grid');
                style.set('width', '100%'); // CRITICAL: Must use width, not flex
                style.set('box-sizing', 'border-box');
                style.set('align-items', 'stretch');
                style.set('min-height', '0');

                // Synthetic host Grid: single full-height cell so the wrapped ContentView fills the device screen
                if (element.metadata.isSynthetic) {
                    style.set('grid-template-columns', '1fr');
                    style.set('grid-template-rows', '1fr');
                    style.set('flex', '1');
                    if (!style.has('height')) {
                        style.set('height', '100%');
                    }
                    break;
                }

                // Get defined columns and rows
                let columns = element.metadata.gridColumns && element.metadata.gridColumns.length
                    ? element.metadata.gridColumns.map(g => this._convertGridLength(g)).join(' ')
                    : '1fr';
                let rows = element.metadata.gridRows && element.metadata.gridRows.length
                    ? element.metadata.gridRows.map(g => this._convertGridLength(g)).join(' ')
                    : 'auto';

                // Find the maximum Grid.Row and Grid.Column used by children
                let maxRow = (element.metadata.gridRows?.length || 1) - 1;
                let maxCol = (element.metadata.gridColumns?.length || 1) - 1;

                const checkChildren = (children: ParsedElement[]) => {
                    // Only check DIRECT children — Grid.Row/Grid.Column attached properties
                    // are scoped to the immediate parent Grid. Recursing into grandchildren
                    // would incorrectly inherit column/row indices from nested Grids.
                    for (const child of children) {
                        const rowAttr = child.resolvedAttributes['Grid.Row'];
                        const colAttr = child.resolvedAttributes['Grid.Column'];
                        if (rowAttr) {
                            const rowNum = Number(rowAttr);
                            if (!Number.isNaN(rowNum)) {
                                maxRow = Math.max(maxRow, rowNum);
                            }
                        }
                        if (colAttr) {
                            const colNum = Number(colAttr);
                            if (!Number.isNaN(colNum)) {
                                maxCol = Math.max(maxCol, colNum);
                            }
                        }
                    }
                };
                checkChildren(element.children);

                // Add auto rows/columns if needed to cover max Grid.Row/Column
                const definedRows = element.metadata.gridRows?.length || 0;
                const definedCols = element.metadata.gridColumns?.length || 0;

                if (maxRow >= definedRows) {
                    const needRows = maxRow - definedRows + 1;
                    const autoRows = Array(needRows).fill('auto').join(' ');
                    rows = definedRows > 0 ? rows + ' ' + autoRows : autoRows;
                }

                if (maxCol >= definedCols) {
                    const needCols = maxCol - definedCols + 1;
                    const frCols = Array(needCols).fill('1fr').join(' ');
                    columns = definedCols > 0 ? columns + ' ' + frCols : frCols;
                }

                style.set('grid-template-columns', columns);
                style.set('grid-template-rows', rows);
                // If any row uses fr/*, grid needs a defined height to fill parent
                const hasFrRow = (element.metadata.gridRows || []).some(r => r.trim() === '*' || r.trim().endsWith('*'));
                if (hasFrRow) {
                    style.set('flex', '1');
                    style.set('min-height', '0');
                    style.set('align-self', 'stretch');
                    // height: 100% ensures 1fr rows can expand (fr units require a concrete container height)
                    if (!style.has('height')) {
                        style.set('height', '100%');
                    }
                }

                const colSpacing = attrs['ColumnSpacing'] || '0';
                const rowSpacing = attrs['RowSpacing'] || '0';
                if (colSpacing && colSpacing !== '0') {
                    style.set('column-gap', this._toPixels(colSpacing));
                }
                if (rowSpacing && rowSpacing !== '0') {
                    style.set('row-gap', this._toPixels(rowSpacing));
                }
                break;
            }
            case 'Border':
            case 'Frame': {
                const stroke = this._resolveColor(attrs['Stroke'] || attrs['BorderColor']);
                const strokeThickness = this._toPixels(attrs['StrokeThickness'] || '1');
                style.set('border-style', 'solid');
                style.set('border-width', stroke ? strokeThickness : '1px');
                style.set('border-color', stroke || 'rgba(0,0,0,0.12)');
                const radius = element.metadata.cornerRadius || attrs['CornerRadius'];
                if (radius) {
                    style.set('border-radius', this._convertCornerRadius(radius));
                } else if (element.type === 'Frame') {
                    style.set('border-radius', '12px');
                }
                break;
            }
            case 'BoxView': {
                style.set('min-height', this._toPixels(attrs['HeightRequest'] || '36'));
                style.set('border-radius', this._convertCornerRadius(attrs['CornerRadius'] || '0'));
                break;
            }
            case 'Button': {
                if (!style.has('background-color')) {
                    style.set('background-color', '#2563eb');
                }
                if (!style.has('color')) {
                    style.set('color', '#ffffff');
                }
                style.set('display', 'inline-flex');
                style.set('align-items', 'center');
                style.set('justify-content', 'center');
                style.set('cursor', 'pointer');
                // Buttons shrink to content unless explicit WidthRequest or HorizontalOptions=Fill
                if (!style.has('width') || style.get('width') === '100%') {
                    if (!attrs['WidthRequest'] && attrs['HorizontalOptions']?.toLowerCase() !== 'fill' && attrs['HorizontalOptions']?.toLowerCase() !== 'fillandexpand') {
                        style.set('width', 'fit-content');
                        style.set('align-self', 'flex-start');
                    }
                }
                if (!style.has('padding')) {
                    style.set('padding', '10px 20px');
                }
                if (!style.has('border')) {
                    style.set('border', 'none');
                }
                if (!style.has('font-size')) {
                    style.set('font-size', '14px');
                }
                if (!style.has('border-radius')) {
                    const radius = attrs['CornerRadius'];
                    if (radius) {
                        style.set('border-radius', this._convertCornerRadius(radius));
                    } else {
                        style.set('border-radius', '8px');
                    }
                }
                break;
            }
            case 'ScrollView': {
                const scrollOrientation = (attrs['Orientation'] || 'vertical').toLowerCase();
                if (scrollOrientation === 'horizontal') {
                    style.set('overflow-x', 'auto');
                    style.set('overflow-y', 'hidden');
                    style.set('width', '100%');
                } else {
                    style.set('overflow-x', 'hidden');
                    style.set('overflow-y', 'auto');
                    style.set('width', '100%');
                    style.set('flex', '1');
                    style.set('min-height', '0');
                }
                break;
            }
            case 'Label': {
                style.set('display', 'block');
                // Labels shrink to content unless HorizontalOptions=Fill or inside Grid
                if (!attrs['WidthRequest'] && attrs['HorizontalOptions']?.toLowerCase() === 'center') {
                    style.set('width', 'fit-content');
                }
                break;
            }
            case 'Entry': {
                style.set('display', 'block');
                style.set('width', '100%');
                style.set('box-sizing', 'border-box');
                if (!style.has('padding')) {
                    style.set('padding', '10px 12px');
                }
                if (!style.has('border')) {
                    style.set('border', '1px solid rgba(0,0,0,0.12)');
                }
                if (!style.has('border-radius')) {
                    style.set('border-radius', '4px');
                }
                if (!style.has('font-size')) {
                    style.set('font-size', '14px');
                }
                if (!style.has('background-color')) {
                    style.set('background-color', '#ffffff');
                }
                break;
            }
        }

        return Array.from(style.entries()).map(([key, value]) => `${key}: ${value}`).join('; ');
    }

    private _resolveColor(raw?: string, visited: Set<string> = new Set()): string | undefined {
        if (!raw) {
            return undefined;
        }

        let value = raw.trim();
        if (!value) {
            return undefined;
        }

        const appThemeMatch = value.match(/\{AppThemeBinding\s+Light=([^,}]+)(?:,\s*Dark=([^}]+))?/i);
        if (appThemeMatch) {
            const lightCandidate = appThemeMatch[1] ? appThemeMatch[1].trim() : undefined;
            if (lightCandidate) {
                const resolved = this._resolveColor(lightCandidate, visited);
                if (resolved) {
                    return resolved;
                }
            }
            const darkCandidate = appThemeMatch[2] ? appThemeMatch[2].trim() : undefined;
            if (darkCandidate) {
                const resolvedDark = this._resolveColor(darkCandidate, visited);
                if (resolvedDark) {
                    return resolvedDark;
                }
            }
        }

        const resourceKey = this._extractResourceKey(value);
        if (resourceKey && !visited.has(resourceKey)) {
            visited.add(resourceKey);
            const resourceValue = this._resourceManager.resolveStaticResource(resourceKey, this._resources);
            if (resourceValue) {
                const resolved = this._resolveColor(resourceValue, visited);
                if (resolved) {
                    return resolved;
                }
            }
            const themeColor = this._themeColors.get(resourceKey);
            if (themeColor) {
                return themeColor;
            }
        }

        value = this._normalizeColorValue(value);
        if (!value) {
            return undefined;
        }

        if (value.startsWith('#') && (value.length === 4 || value.length === 5 || value.length === 7 || value.length === 9)) {
            return value;
        }

        if (/^(rgb|rgba|hsl|hsla)\(/i.test(value)) {
            return value;
        }

        const lower = value.toLowerCase();
        if (COLOR_NAME_MAP[lower]) {
            return COLOR_NAME_MAP[lower];
        }

        if (this._themeColors.has(value)) {
            return this._themeColors.get(value);
        }

        return undefined;
    }

    private _buildGradientCss(stops: Array<{ color: string; offset: string }>, startPoint?: string, endPoint?: string): string | undefined {
        if (!stops || stops.length === 0) {
            return undefined;
        }

        // Parse start and end points (format: "x,y")
        const parsePoint = (point: string) => {
            const parts = point.split(',').map(p => parseFloat(p.trim()));
            return { x: parts[0] || 0, y: parts[1] || 0 };
        };

        const start = parsePoint(startPoint || '0,0');
        const end = parsePoint(endPoint || '1,1');

        // Calculate angle for linear gradient
        // MAUI uses StartPoint (0,0) = top-left, (1,1) = bottom-right
        // CSS uses degrees where 0deg = to top, 90deg = to right
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const angleRad = Math.atan2(dy, dx);
        const angleDeg = (angleRad * 180 / Math.PI) + 90; // Adjust for CSS coordinate system

        // Build gradient stops with resolved colors
        const gradientStops = stops.map(stop => {
            const color = this._resolveColor(stop.color) || stop.color;
            const offset = parseFloat(stop.offset) * 100;
            return `${color} ${offset}%`;
        }).join(', ');

        return `linear-gradient(${angleDeg}deg, ${gradientStops})`;
    }

    private _normalizeColorValue(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) {
            return trimmed;
        }

        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            if (trimmed.includes('"')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    const candidate = this._findColorInParsedValue(parsed);
                    if (candidate) {
                        return candidate;
                    }
                } catch (error) {
                    // ignore JSON parse errors and fall back to trimmed string
                }
            }
        }

        if (/^Color\s+/i.test(trimmed)) {
            return trimmed.replace(/^Color\s+/i, '');
        }

        return trimmed;
    }

    private _findColorInParsedValue(value: any): string | undefined {
        if (!value) {
            return undefined;
        }

        if (typeof value === 'string') {
            return value;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const result = this._findColorInParsedValue(item);
                if (result) {
                    return result;
                }
            }
            return undefined;
        }

        if (typeof value === 'object') {
            const directKeys = ['@_Color', 'Color', '#text', '@_Light', 'Light', '@_Value', 'Value'];
            for (const key of directKeys) {
                const candidate = (value as Record<string, unknown>)[key];
                if (typeof candidate === 'string' && candidate.trim()) {
                    return candidate;
                }
            }

            for (const key of Object.keys(value)) {
                const result = this._findColorInParsedValue((value as Record<string, unknown>)[key]);
                if (result) {
                    return result;
                }
            }
        }

        return undefined;
    }

    private _applyLayoutOptions(style: Map<string, string>, axis: 'horizontal' | 'vertical', option: string) {
        const normalized = option.toLowerCase();
        if (axis === 'horizontal') {
            if (normalized === 'center') {
                style.set('width', 'fit-content');
                style.set('margin-left', 'auto');
                style.set('margin-right', 'auto');
            } else if (normalized === 'end') {
                style.set('width', 'fit-content');
                style.set('margin-left', 'auto');
                style.set('margin-right', '0');
            } else if (normalized === 'start') {
                style.set('width', 'fit-content');
                style.set('margin-left', '0');
                style.set('margin-right', 'auto');
            } else if (normalized === 'fill' || normalized === 'fillandexpand') {
                style.set('width', '100%');
            }
        } else {
            if (normalized === 'center') {
                style.set('align-self', 'center');
            } else if (normalized === 'end') {
                style.set('align-self', 'flex-end');
            } else if (normalized === 'start') {
                style.set('align-self', 'flex-start');
            } else if (normalized === 'fill' || normalized === 'fillandexpand') {
                style.set('align-self', 'stretch');
                style.set('flex', '1');
                style.set('min-height', '0');
            }
        }
    }

    private _convertThickness(value: string): string {
        const parts = value.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) {
            return '0px';
        }
        if (parts.length === 1) {
            const px = this._toPixels(parts[0]);
            return `${px}`;
        }
        if (parts.length === 2) {
            const vertical = this._toPixels(parts[0]);
            const horizontal = this._toPixels(parts[1]);
            return `${vertical} ${horizontal}`;
        }
        if (parts.length === 3) {
            const top = this._toPixels(parts[0]);
            const horizontal = this._toPixels(parts[1]);
            const bottom = this._toPixels(parts[2]);
            return `${top} ${horizontal} ${bottom}`;
        }
        const top = this._toPixels(parts[0]);
        const right = this._toPixels(parts[1]);
        const bottom = this._toPixels(parts[2]);
        const left = this._toPixels(parts[3]);
        return `${top} ${right} ${bottom} ${left}`;
    }

    private _getImageWebviewUri(source: string): string {
        if (!source || source.includes('{Binding')) {
            return '';
        }

        // If it's already an HTTP URL, return as-is
        if (source.startsWith('http://') || source.startsWith('https://')) {
            return source;
        }

        if (!this._currentPanel || !this._currentDocument) {
            return '';
        }

        try {
            const docDir = path.dirname(this._currentDocument.uri.fsPath);
            let resolvedPath = '';

            // Try relative to document
            let candidate = path.resolve(docDir, source);
            if (fs.existsSync(candidate)) {
                resolvedPath = candidate;
            } else {
                // Try relative to workspace root
                const workspace = vscode.workspace.getWorkspaceFolder(this._currentDocument.uri);
                if (workspace) {
                    candidate = path.resolve(workspace.uri.fsPath, source);
                    if (fs.existsSync(candidate)) {
                        resolvedPath = candidate;
                    } else {
                        // Try Resources/Images
                        candidate = path.resolve(workspace.uri.fsPath, 'Resources', source);
                        if (fs.existsSync(candidate)) {
                            resolvedPath = candidate;
                        } else {
                            candidate = path.resolve(workspace.uri.fsPath, 'Resources', 'Images', source);
                            if (fs.existsSync(candidate)) {
                                resolvedPath = candidate;
                            }
                        }
                    }
                }
            }

            if (!resolvedPath) {
                console.warn(`[PreviewProvider] Image not found: ${source}`);
                return '';
            }

            const imageUri = vscode.Uri.file(resolvedPath);
            const webviewUri = this._currentPanel.webview.asWebviewUri(imageUri);
            return webviewUri.toString();
        } catch (error) {
            console.error('[PreviewProvider] Failed to resolve image path:', source, error);
            return '';
        }
    }

    private _convertCornerRadius(value: string): string {
        if (!value) {
            return '0px';
        }
        const parts = value.split(/[ ,]+/).map(p => p.trim()).filter(Boolean);
        if (parts.length === 1) {
            return this._toPixels(parts[0]);
        }
        if (parts.length === 2) {
            // MAUI: TopL/BotR, TopR/BotL -> CSS: TL, TR, BR, BL
            const a = this._toPixels(parts[0]);
            const b = this._toPixels(parts[1]);
            return `${a} ${b} ${a} ${b}`;
        }
        if (parts.length === 4) {
            // MAUI: TL, TR, BL, BR -> CSS: TL, TR, BR, BL
            const tl = this._toPixels(parts[0]);
            const tr = this._toPixels(parts[1]);
            const bl = this._toPixels(parts[2]);
            const br = this._toPixels(parts[3]);
            return `${tl} ${tr} ${br} ${bl}`; // Swap BL/BR for CSS order
        }
        return this._convertThickness(value);
    }

    private _convertGridLength(value: string): string {
        if (!value) {
            return '1fr';
        }
        const trimmed = value.trim();
        if (!trimmed || trimmed === '*') {
            return '1fr';
        }
        if (trimmed.toLowerCase() === 'auto') {
            return 'auto';
        }
        if (trimmed.endsWith('*')) {
            const factor = parseFloat(trimmed.slice(0, -1));
            return `${Number.isNaN(factor) ? 1 : factor}fr`;
        }
        const numeric = parseFloat(trimmed);
        if (!Number.isNaN(numeric)) {
            return `${numeric}px`;
        }
        return trimmed;
    }

    private _toPixels(value: string): string {
        if (!value) {
            return '0px';
        }
        const normalized = value.trim();
        if (normalized.endsWith('px') || normalized.endsWith('%')) {
            return normalized;
        }
        const numeric = parseFloat(normalized);
        if (!Number.isNaN(numeric)) {
            return `${numeric}px`;
        }
        return normalized;
    }

    private _escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private _convertParsedToXamlElements(elements: ParsedElement[]): XamlElement[] {
        return elements.map(element => this._convertParsedElement(element));
    }

    private _convertParsedElement(element: ParsedElement): XamlElement {
        const properties = this._buildElementProperties(element);
        return {
            id: element.id,
            type: element.type,
            name: element.name || element.type,
            properties,
            children: element.children.map(child => this._convertParsedElement(child))
        };
    }

    private _buildElementProperties(element: ParsedElement): ElementProperty[] {
        const properties: ElementProperty[] = [];
        const entries = Object.entries(element.resolvedAttributes);
        for (const [key, value] of entries) {
            if (!value) {
                continue;
            }
            const normalizedValue = this._normalizePropertyValue(key, value);
            properties.push({
                key,
                value: normalizedValue,
                type: this._determinePropertyType(key, normalizedValue),
                section: this._getPropertySection(key),
                elementType: element.type
            });
        }

        properties.push({
            key: 'Type',
            value: element.type,
            type: 'string',
            section: 'structure'
        });

        if (element.name) {
            properties.push({
                key: 'Name',
                value: element.name,
                type: 'string',
                section: 'structure'
            });
        }

        if (element.textContent) {
            properties.push({
                key: 'Text',
                value: element.textContent,
                type: 'string',
                section: 'appearance'
            });
        }

        return properties;
    }

    private _normalizePropertyValue(key: string, value: string): string {
        if (!value) {
            return value;
        }
        if (key.toLowerCase().includes('color')) {
            return this._resolveColor(value) ?? value;
        }
        return value;
    }

    private _determinePropertyType(key: string, value: string): ElementProperty['type'] {
        if (!value || typeof value !== 'string') {
            return 'string';
        }
        const lowerKey = key.toLowerCase();
        const lowerValue = value.toLowerCase();
        if (lowerKey.includes('color') || lowerValue.startsWith('#') || lowerValue.startsWith('rgb')) {
            return 'color';
        }
        if (lowerValue === 'true' || lowerValue === 'false') {
            return 'boolean';
        }
        if (!Number.isNaN(Number(value)) && !lowerKey.includes('margin') && !lowerKey.includes('padding') && !lowerKey.includes('spacing')) {
            return 'number';
        }
        return 'string';
    }

    private _getPropertySection(propertyName: string): 'appearance' | 'layout' | 'structure' {
        const lower = propertyName.toLowerCase();
        const layoutProps = ['margin', 'padding', 'width', 'widthrequest', 'height', 'heightrequest', 'horizontaloptions', 'verticaloptions', 'grid.row', 'grid.column', 'grid.rowspan', 'grid.columnspan'];
        const appearanceProps = ['background', 'backgroundcolor', 'textcolor', 'color', 'font', 'opacity', 'corner', 'border', 'stroke'];

        if (layoutProps.some(prop => lower.includes(prop))) {
            return 'layout';
        }
        if (appearanceProps.some(prop => lower.includes(prop))) {
            return 'appearance';
        }
        return 'structure';
    }

    private _showErrorMessage(message: string) {
        if (!this._currentPanel) {
            return;
        }

        this._currentPanel.webview.html = `<!DOCTYPE html>
        <html>
        <head>
        <meta charset="UTF-8" />
        <title>MAUI XAML Preview - Error</title>
        <style>
        body {
        font-family: Segoe UI, sans-serif;
        background: #f6f8fa;
        color: #b91c1c;
        padding: 24px;
        }
        .error {
        background: #fff;
        border-left: 4px solid #dc2626;
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        </style>
        </head>
        <body>
        <div class="error">
        <h2>⚠️ Napaka pri generiranju predogleda</h2>
        <p>${this._escapeHtml(message)}</p>
        </div>
        </body>
        </html>`;
    }

    private _nextElementId(): string {
        return `element_${this._elementIdCounter++}`;
    }
}
