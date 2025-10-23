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
exports.TemplateManager = void 0;
const vscode = __importStar(require("vscode"));
class TemplateManager {
    constructor(extensionUri) {
        this._templates = [];
        this._extensionUri = extensionUri;
    }
    getTemplates() {
        return this._templates;
    }
    async loadTemplates() {
        // 1) Try to load from extension bundled json
        const bundled = vscode.Uri.joinPath(this._extensionUri, 'templates', 'default-templates.json');
        try {
            const data = await vscode.workspace.fs.readFile(bundled);
            const parsed = JSON.parse(Buffer.from(data).toString('utf8'));
            if (Array.isArray(parsed) && parsed.length) {
                this._templates = parsed;
            }
        }
        catch (err) {
            // ignore; will fall back
        }
        // 2) Optional: load workspace override .vscode/maui-templates.json and merge
        try {
            const folders = vscode.workspace.workspaceFolders || [];
            for (const f of folders) {
                const candidate = vscode.Uri.joinPath(f.uri, '.vscode', 'maui-templates.json');
                const stat = await vscode.workspace.fs.stat(candidate).then(s => s, () => undefined);
                if (stat) {
                    const data = await vscode.workspace.fs.readFile(candidate);
                    const parsed = JSON.parse(Buffer.from(data).toString('utf8'));
                    if (Array.isArray(parsed)) {
                        // merge: workspace overrides extension by id
                        const map = new Map(this._templates.map(t => [t.id, t]));
                        for (const t of parsed)
                            map.set(t.id, t);
                        this._templates = Array.from(map.values());
                    }
                }
            }
        }
        catch (err) {
            // ignore
        }
        // 3) Hardcoded fallback if none loaded
        if (!this._templates.length) {
            this._templates = [
                {
                    id: 'tpl_border_basic',
                    name: 'Border – Basic',
                    category: 'Layout',
                    description: 'Border with padding and rounded corners',
                    xaml: '<Border Stroke="#1B1F2A" StrokeThickness="1" BackgroundColor="#FFFFFF" Padding="16" CornerRadius="8">\n  <StackLayout Spacing="8">\n    <Label Text="Title" FontAttributes="Bold" FontSize="18" />\n    <Label Text="Subtitle or content goes here..." TextColor="#4B5563" />\n  </StackLayout>\n</Border>'
                },
                {
                    id: 'tpl_grid_two_columns',
                    name: 'Grid – 2 Columns',
                    category: 'Layout',
                    description: 'Grid with two columns and sample content',
                    xaml: '<Grid ColumnDefinitions="Auto,*" RowDefinitions="Auto,Auto" ColumnSpacing="8" RowSpacing="8">\n  <Label Grid.Row="0" Grid.Column="0" Text="Label:" FontAttributes="Bold" />\n  <Entry Grid.Row="0" Grid.Column="1" Placeholder="Type here" />\n  <Label Grid.Row="1" Grid.Column="0" Text="Another:" FontAttributes="Bold" />\n  <Entry Grid.Row="1" Grid.Column="1" Placeholder="Value" />\n</Grid>'
                },
                {
                    id: 'tpl_boxview_separator',
                    name: 'BoxView – Separator',
                    category: 'Utility',
                    description: 'Thin separator line',
                    xaml: '<BoxView HeightRequest="1" BackgroundColor="#E5E7EB" Margin="8,12" />'
                }
            ];
        }
    }
}
exports.TemplateManager = TemplateManager;
//# sourceMappingURL=templateManager.js.map