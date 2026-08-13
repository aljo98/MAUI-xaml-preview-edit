import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CSharpParser, CSharpProperty } from './csharpParser';

export type MockData = Record<string, unknown>;

export class MockDataProvider {
    private static readonly MOCK_EXT = '.maui-mock.json';
    private mockCache: Map<string, MockData> = new Map();
    private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

    /** Called when mock file changes — previewProvider can subscribe to force re-render */
    public onMockFileChanged?: (xamlPath: string) => void;

    // ── Public API ─────────────────────────────────────────────────────────────

    public getMockData(xamlFilePath: string): MockData {
        const mockPath = this._mockPath(xamlFilePath);
        if (this.mockCache.has(mockPath)) {
            return this.mockCache.get(mockPath)!;
        }
        return this._loadFromDisk(xamlFilePath);
    }

    /**
     * Resolve a {Binding Path=Foo.Bar} expression against mock data.
     * Returns the resolved string, or null if no mock value found.
     */
    public resolveBinding(bindingExpr: string, mockData: MockData): string | null {
        // Extract path from "{Binding Path=Foo.Bar}" or "{Binding Foo.Bar}"
        const pathMatch = bindingExpr.match(/\{Binding\s+(?:Path\s*=\s*)?([A-Za-z0-9_.]+)/i);
        if (!pathMatch) return null;
        const dotPath = pathMatch[1];
        const parts = dotPath.split('.');
        let value: unknown = mockData;
        for (const part of parts) {
            if (value == null || typeof value !== 'object') return null;
            value = (value as Record<string, unknown>)[part];
        }
        if (value == null) return null;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    /**
     * Generates a .maui-mock.json scaffold next to the XAML file
     * based on the ViewModel's parsed properties.
     */
    public async generateMockFile(
        xamlFilePath: string,
        vmProperties: CSharpProperty[]
    ): Promise<void> {
        const mockPath = this._mockPath(xamlFilePath);

        // Merge with existing (don't wipe user data)
        let existing: MockData = {};
        if (fs.existsSync(mockPath)) {
            try { existing = JSON.parse(fs.readFileSync(mockPath, 'utf-8')); } catch { /* ignore */ }
        }

        for (const prop of vmProperties) {
            if (prop.isCommand) continue;
            if (prop.name in existing) continue; // keep user value
            existing[prop.name] = this._defaultForType(prop.name, prop.type);
        }

        fs.writeFileSync(mockPath, JSON.stringify(existing, null, 2), 'utf-8');
        this.mockCache.delete(mockPath);
        this._watchMockFile(xamlFilePath);

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mockPath));
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        vscode.window.showInformationMessage(`Mock datoteka ustvarjena: ${path.basename(mockPath)}`);
    }

    public invalidate(xamlFilePath: string): void {
        this.mockCache.delete(this._mockPath(xamlFilePath));
    }

    public hasMockFile(xamlFilePath: string): boolean {
        return fs.existsSync(this._mockPath(xamlFilePath));
    }

    public dispose(): void {
        for (const w of this.fileWatchers.values()) w.dispose();
        this.fileWatchers.clear();
        this.mockCache.clear();
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private _mockPath(xamlPath: string): string {
        return xamlPath.replace(/\.xaml$/i, MockDataProvider.MOCK_EXT);
    }

    private _loadFromDisk(xamlFilePath: string): MockData {
        const mockPath = this._mockPath(xamlFilePath);
        if (!fs.existsSync(mockPath)) return {};
        try {
            const data = JSON.parse(fs.readFileSync(mockPath, 'utf-8')) as MockData;
            this.mockCache.set(mockPath, data);
            this._watchMockFile(xamlFilePath);
            console.log(`[MockDataProvider] Loaded ${Object.keys(data).length} keys from ${path.basename(mockPath)}`);
            return data;
        } catch (e) {
            console.warn(`[MockDataProvider] Failed to parse ${mockPath}:`, e);
            return {};
        }
    }

    private _watchMockFile(xamlFilePath: string): void {
        const mockPath = this._mockPath(xamlFilePath);
        if (this.fileWatchers.has(mockPath)) return;
        try {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(path.dirname(mockPath), path.basename(mockPath))
            );
            watcher.onDidChange(() => {
                this.mockCache.delete(mockPath);
                console.log(`[MockDataProvider] Mock file changed: ${path.basename(mockPath)}`);
                this.onMockFileChanged?.(xamlFilePath);
            });
            watcher.onDidDelete(() => {
                this.mockCache.delete(mockPath);
                this.onMockFileChanged?.(xamlFilePath);
            });
            this.fileWatchers.set(mockPath, watcher);
        } catch { /* ignore */ }
    }

    private _defaultForType(name: string, type: string): unknown {
        const t = type.toLowerCase();
        if (t === 'string') return `Mock ${name}`;
        if (t === 'int' || t === 'long' || t === 'short') return 42;
        if (t === 'double' || t === 'float' || t === 'decimal') return 3.14;
        if (t === 'bool' || t === 'boolean') return true;
        if (t === 'datetime' || t === 'dateonly') return '2026-02-24';
        if (t.startsWith('ilist') || t.startsWith('list') || t.startsWith('observablecollection')
            || t.startsWith('ienumerable')) {
            return [
                { Id: 1, Name: `${name} item 1` },
                { Id: 2, Name: `${name} item 2` },
                { Id: 3, Name: `${name} item 3` }
            ];
        }
        return `[${name}]`;
    }
}
