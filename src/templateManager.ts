import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface TemplateItem {
  id: string;
  name: string;
  category?: string;
  description?: string;
  xaml: string;
}

export interface DocumentTemplateVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  category?: string;
  description?: string;
  language: 'csharp' | 'xaml';
  variables: DocumentTemplateVariable[];
  content: string;
}

export class TemplateManager {
  private _templates: TemplateItem[] = [];
  private _documentTemplates: DocumentTemplate[] = [];
  private _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public getTemplates(): TemplateItem[] {
    return this._templates;
  }

  public getDocumentTemplates(): DocumentTemplate[] {
    return this._documentTemplates;
  }

  public async loadTemplates(): Promise<void> {
    // 1) Try to load from extension bundled json
    const bundled = vscode.Uri.joinPath(this._extensionUri, 'templates', 'default-templates.json');
    try {
      const data = await vscode.workspace.fs.readFile(bundled);
      const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as TemplateItem[];
      if (Array.isArray(parsed) && parsed.length) {
        this._templates = parsed;
      }
    } catch (err) {
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
          const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as TemplateItem[];
          if (Array.isArray(parsed)) {
            // merge: workspace overrides extension by id
            const map = new Map<string, TemplateItem>(this._templates.map(t => [t.id, t]));
            for (const t of parsed) map.set(t.id, t);
            this._templates = Array.from(map.values());
          }
        }
      }
    } catch (err) {
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

    // 4) Load document templates
    await this.loadDocumentTemplates();
  }

  public async loadDocumentTemplates(): Promise<void> {
    // Load from extension bundled document-templates.json
    const bundled = vscode.Uri.joinPath(this._extensionUri, 'templates', 'document-templates.json');
    try {
      const data = await vscode.workspace.fs.readFile(bundled);
      const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as DocumentTemplate[];
      if (Array.isArray(parsed) && parsed.length) {
        this._documentTemplates = parsed;
      }
    } catch (err) {
      console.warn('[TemplateManager] Failed to load document templates:', err);
    }

    // Merge workspace overrides from .vscode/document-templates.json
    try {
      const folders = vscode.workspace.workspaceFolders || [];
      for (const f of folders) {
        const candidate = vscode.Uri.joinPath(f.uri, '.vscode', 'document-templates.json');
        const stat = await vscode.workspace.fs.stat(candidate).then(s => s, () => undefined);
        if (stat) {
          const data = await vscode.workspace.fs.readFile(candidate);
          const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as DocumentTemplate[];
          if (Array.isArray(parsed)) {
            const map = new Map<string, DocumentTemplate>(this._documentTemplates.map(t => [t.id, t]));
            for (const t of parsed) map.set(t.id, t);
            this._documentTemplates = Array.from(map.values());
          }
        }
      }
    } catch (err) {
      // ignore
    }

    console.log(`[TemplateManager] Loaded ${this._documentTemplates.length} document templates`);
  }

  public resolveTemplate(template: DocumentTemplate, values: Record<string, string>): string {
    let content = template.content;
    for (const variable of template.variables) {
      const value = values[variable.name] ?? variable.default ?? '';
      // Replace all occurrences of ${VarName} with the provided value
      const pattern = new RegExp('\\$\\{' + variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'g');
      content = content.replace(pattern, value);
    }
    return content;
  }

  public async saveTemplate(name: string, xaml: string): Promise<void> {
    const newId = 'tpl_custom_' + Date.now();
    const newTemplate: TemplateItem = {
      id: newId,
      name,
      category: 'Custom',
      description: 'User created template',
      xaml
    };

    this._templates.push(newTemplate);

    // Persist to .vscode/maui-templates.json
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const vscodeDir = vscode.Uri.joinPath(folders[0].uri, '.vscode');
        await vscode.workspace.fs.createDirectory(vscodeDir);
        const fileUri = vscode.Uri.joinPath(vscodeDir, 'maui-templates.json');

        // Read existing if any
        let existing: TemplateItem[] = [];
        try {
          const data = await vscode.workspace.fs.readFile(fileUri);
          existing = JSON.parse(Buffer.from(data).toString('utf8'));
        } catch { /* ignore */ }

        existing.push(newTemplate);

        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(existing, null, 2), 'utf8'));
      }
    } catch (err) {
      console.warn('Failed to save template to disk', err);
      vscode.window.showErrorMessage('Failed to save template: ' + err);
    }
  }
}
