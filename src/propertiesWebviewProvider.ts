import * as vscode from 'vscode';
import { ElementProperty, XamlElement } from './propertiesProvider';

/**
 * WebviewViewProvider that renders an inline HTML form for editing
 * MAUI element properties directly in the sidebar panel.
 */
export class PropertiesWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mauiProperties';

    private _view?: vscode.WebviewView;
    private _selectedElement?: XamlElement;
    private _colorSuggestions: string[] = [];
    private _styleSuggestions: string[] = [];
    private _resourceSuggestions: string[] = [];

    private static readonly PROPERTY_SUGGESTIONS = [
        'Text', 'TextColor', 'BackgroundColor', 'FontSize', 'FontAttributes', 'FontFamily',
        'LineHeight', 'CharacterSpacing', 'TextDecorations',
        'WidthRequest', 'HeightRequest', 'MinWidthRequest', 'MinHeightRequest',
        'MaxWidthRequest', 'MaxHeightRequest',
        'Margin', 'Padding', 'CornerRadius', 'BorderColor', 'BorderThickness',
        'Stroke', 'StrokeThickness', 'Opacity', 'IsVisible', 'IsEnabled',
        'HorizontalOptions', 'VerticalOptions', 'HorizontalTextAlignment', 'TextAlignment',
        'Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan',
        'Style', 'ClassId', 'Source', 'Placeholder', 'IsPassword',
        'Command', 'CommandParameter'
    ];

    // Callback set by extension.ts to handle property changes
    public onPropertyChanged?: (property: ElementProperty, newValue: string) => void;
    public onPropertyAdded?: (elementType: string, key: string, value: string) => void;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'propertyChanged': {
                    if (this._selectedElement && this.onPropertyChanged) {
                        const prop = this._selectedElement.properties.find(p => p.key === message.key);
                        if (prop) {
                            // Inject elementId so safeEditAttribute can scope the edit
                            this.onPropertyChanged({ ...prop, elementId: this._selectedElement.id, elementType: this._selectedElement.type }, message.value);
                        }
                    }
                    break;
                }
                case 'propertyAdded': {
                    if (this._selectedElement && this.onPropertyAdded) {
                        this.onPropertyAdded(this._selectedElement.type, message.key, message.value);
                    }
                    break;
                }
            }
        });

        this._updateWebview();
    }

    public setSelectedElement(element: XamlElement | undefined) {
        this._selectedElement = element;
        this._updateWebview();
    }

    public setSuggestions(colors: string[], styles: string[], resources: string[]) {
        this._colorSuggestions = colors;
        this._styleSuggestions = styles;
        this._resourceSuggestions = resources;
    }

    private _updateWebview() {
        if (!this._view) { return; }
        this._view.webview.html = this._getHtml();
    }

    private _getHtml(): string {
        const el = this._selectedElement;

        // Group properties by section
        const appearance = el ? el.properties.filter(p => p.section === 'appearance') : [];
        const layout = el ? el.properties.filter(p => p.section === 'layout') : [];

        // Get existing keys to filter add suggestions
        const existingKeys = new Set(el ? el.properties.map(p => p.key) : []);
        const availableKeys = PropertiesWebviewProvider.PROPERTY_SUGGESTIONS
            .filter(k => !existingKeys.has(k));

        return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #cccccc);
        background: var(--vscode-sideBar-background, #252526);
        padding: 8px;
        overflow-x: hidden;
    }

    .empty-state {
        text-align: center;
        padding: 24px 12px;
        color: var(--vscode-descriptionForeground, #888);
        font-style: italic;
    }

    .element-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        margin-bottom: 8px;
        background: var(--vscode-badge-background, #333);
        border-radius: 4px;
        font-weight: 600;
        font-size: 13px;
    }
    .element-header .type-badge {
        background: var(--vscode-badge-foreground, #fff);
        color: var(--vscode-badge-background, #333);
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 700;
    }

    .section-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground, #888);
        padding: 8px 0 4px 0;
        border-bottom: 1px solid var(--vscode-panel-border, #444);
        margin-bottom: 4px;
    }

    .prop-row {
        display: flex;
        align-items: stretch;
        border-bottom: 1px solid var(--vscode-panel-border, #333);
        margin: 0;
        min-height: 24px;
    }

    .prop-key {
        flex: 0 0 45%;
        padding: 4px 6px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground, #aaa);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: default;
        border-right: 1px solid var(--vscode-panel-border, #333);
        background: var(--vscode-editorWidget-background, rgba(0,0,0,0.1));
        display: flex;
        align-items: center;
    }

    .prop-value {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
    }

    .prop-value input,
    .prop-value select {
        width: 100%;
        padding: 4px 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--vscode-input-foreground, #ccc);
        font-size: 12px;
        font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
        outline: none;
        height: 100%;
    }

    .prop-value input:focus,
    .prop-value select:focus {
        border-color: var(--vscode-focusBorder, #007acc);
        background: var(--vscode-input-background, #1e1e1e);
    }

    .prop-value input[type="color"] {
        height: 24px;
        padding: 2px;
        cursor: pointer;
    }

    .color-row {
        display: flex;
        gap: 4px;
        align-items: center;
    }
    .color-row input[type="color"] {
        flex: 0 0 28px;
        width: 28px;
    }
    .color-row input[type="text"] {
        flex: 1;
    }

    /* Add property section */
    .add-section {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--vscode-panel-border, #444);
    }

    .add-btn {
        width: 100%;
        padding: 5px 8px;
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        transition: background 0.15s;
    }
    .add-btn:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
    }

    .add-form {
        display: none;
        margin-top: 6px;
    }
    .add-form.visible { display: block; }

    .add-form select,
    .add-form input {
        width: 100%;
        padding: 4px 6px;
        margin-bottom: 4px;
        border: 1px solid var(--vscode-input-border, #444);
        background: var(--vscode-input-background, #1e1e1e);
        color: var(--vscode-input-foreground, #ccc);
        border-radius: 3px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
    }
    .add-form select:focus,
    .add-form input:focus {
        border-color: var(--vscode-focusBorder, #007acc);
    }

    .add-form-buttons {
        display: flex;
        gap: 4px;
        margin-top: 4px;
    }
    .add-form-buttons button {
        flex: 1;
        padding: 4px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        font-family: inherit;
    }
    .btn-confirm {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
    }
    .btn-cancel {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #ccc);
    }

    .binding-hint {
        font-size: 10px;
        color: var(--vscode-descriptionForeground, #777);
        font-style: italic;
        padding: 2px 0;
    }
</style>
</head>
<body>
${el ? this._renderElement(el, appearance, layout, availableKeys) : '<div class="empty-state">Izberi element v previewu za urejanje lastnosti</div>'}
<script>
    const vscode = acquireVsCodeApi();

    // Handle property value changes (debounced)
    let debounceTimers = {};
    function onPropChange(key, value) {
        if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
        debounceTimers[key] = setTimeout(() => {
            vscode.postMessage({ type: 'propertyChanged', key: key, value: value });
        }, 400);
    }

    // Color syncing
    function syncColor(key, source) {
        const textInput = document.getElementById('prop-text-' + key);
        const colorInput = document.getElementById('prop-color-' + key);
        if (source === 'color' && colorInput && textInput) {
            textInput.value = colorInput.value;
            onPropChange(key, colorInput.value);
        } else if (source === 'text' && textInput && colorInput) {
            const v = textInput.value.trim();
            if (/^#[0-9a-fA-F]{3,8}$/.test(v)) colorInput.value = v.slice(0, 7);
            onPropChange(key, v);
        }
    }

    // Add property toggle
    function toggleAddForm() {
        const form = document.getElementById('add-form');
        if (form) form.classList.toggle('visible');
    }

    function confirmAdd() {
        const keySelect = document.getElementById('add-key');
        const customKeyInput = document.getElementById('add-custom-key');
        const valueInput = document.getElementById('add-value');
        let key = keySelect ? keySelect.value : '';
        if (key === '__custom__' && customKeyInput) {
            key = customKeyInput.value.trim();
        }
        const value = valueInput ? valueInput.value : '';
        if (key && value) {
            vscode.postMessage({ type: 'propertyAdded', key: key, value: value });
        }
        toggleAddForm();
    }

    function onKeySelectChange() {
        const keySelect = document.getElementById('add-key');
        const customRow = document.getElementById('custom-key-row');
        if (keySelect && customRow) {
            customRow.style.display = keySelect.value === '__custom__' ? 'block' : 'none';
        }
    }
</script>
</body>
</html>`;
    }

    private _renderElement(el: XamlElement, appearance: ElementProperty[], layout: ElementProperty[], availableKeys: string[]): string {
        const nameDisplay = el.name ? `${el.type} <span style="opacity:0.6">(${this._escapeHtml(el.name)})</span>` : el.type;

        let html = `<div class="element-header"><span class="type-badge">${el.type}</span>${el.name ? this._escapeHtml(el.name) : ''}</div>`;

        if (appearance.length) {
            html += `<div class="section-title">Izgled</div>`;
            html += appearance.map(p => this._renderPropertyRow(p)).join('');
        }

        if (layout.length) {
            html += `<div class="section-title">Postavitev</div>`;
            html += layout.map(p => this._renderPropertyRow(p)).join('');
        }

        if (!appearance.length && !layout.length) {
            html += `<div class="binding-hint">Element nima nastavljenih lastnosti</div>`;
        }

        // Add property section
        html += `<div class="add-section">
            <button class="add-btn" onclick="toggleAddForm()">➕ Dodaj lastnost</button>
            <div id="add-form" class="add-form">
                <select id="add-key" onchange="onKeySelectChange()">
                    ${availableKeys.map(k => `<option value="${this._escapeHtml(k)}">${this._escapeHtml(k)}</option>`).join('')}
                    <option value="__custom__">— Po meri —</option>
                </select>
                <div id="custom-key-row" style="display:none">
                    <input type="text" id="add-custom-key" placeholder="Ime lastnosti…" />
                </div>
                <input type="text" id="add-value" placeholder="Vrednost…" />
                <div class="add-form-buttons">
                    <button class="btn-confirm" onclick="confirmAdd()">Dodaj</button>
                    <button class="btn-cancel" onclick="toggleAddForm()">Prekliči</button>
                </div>
            </div>
        </div>`;

        return html;
    }

    private _renderPropertyRow(prop: ElementProperty): string {
        const key = this._escapeHtml(prop.key);
        const value = this._escapeHtml(prop.value);

        let inputHtml: string;

        switch (prop.type) {
            case 'boolean':
                inputHtml = `<select onchange="onPropChange('${key}', this.value)">
                    <option value="True" ${prop.value === 'True' ? 'selected' : ''}>True</option>
                    <option value="False" ${prop.value === 'False' ? 'selected' : ''}>False</option>
                </select>`;
                break;

            case 'color':
                // Color picker + text input side by side
                const hexValue = this._toHex(prop.value);
                inputHtml = `<div class="color-row">
                    <input type="color" id="prop-color-${key}" value="${hexValue}" onchange="syncColor('${key}', 'color')" />
                    <input type="text" id="prop-text-${key}" value="${value}" onchange="syncColor('${key}', 'text')" />
                </div>`;
                break;

            case 'select':
                const options = prop.options || [];
                inputHtml = `<select onchange="onPropChange('${key}', this.value)">
                    ${options.map(o => `<option value="${this._escapeHtml(o)}" ${o === prop.value ? 'selected' : ''}>${this._escapeHtml(o)}</option>`).join('')}
                </select>`;
                break;

            case 'number':
                inputHtml = `<input type="number" value="${value}" onchange="onPropChange('${key}', this.value)" />`;
                break;

            default: // string
                inputHtml = `<input type="text" value="${value}" onchange="onPropChange('${key}', this.value)" />`;
                break;
        }

        return `<div class="prop-row">
            <div class="prop-key" title="${key}">${key}</div>
            <div class="prop-value">${inputHtml}</div>
        </div>`;
    }

    private _toHex(color: string): string {
        // Basic color name to hex conversion for the color picker
        const map: Record<string, string> = {
            'transparent': '#000000', 'white': '#ffffff', 'black': '#000000',
            'red': '#ff0000', 'green': '#008000', 'blue': '#0000ff',
            'yellow': '#ffff00', 'orange': '#ffa500', 'gray': '#808080',
            'purple': '#800080', 'cyan': '#00ffff', 'magenta': '#ff00ff'
        };
        const lower = color.toLowerCase().trim();
        if (map[lower]) { return map[lower]; }
        if (lower.startsWith('#') && (lower.length === 7 || lower.length === 4)) { return lower; }
        if (lower.startsWith('#') && lower.length === 9) { return lower.slice(0, 7); } // strip alpha
        return '#000000';
    }

    private _escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
