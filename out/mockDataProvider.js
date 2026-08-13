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
exports.MockDataProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class MockDataProvider {
    constructor() {
        this.mockCache = new Map();
        this.fileWatchers = new Map();
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    getMockData(xamlFilePath) {
        const mockPath = this._mockPath(xamlFilePath);
        if (this.mockCache.has(mockPath)) {
            return this.mockCache.get(mockPath);
        }
        return this._loadFromDisk(xamlFilePath);
    }
    /**
     * Resolve a {Binding Path=Foo.Bar} expression against mock data.
     * Returns the resolved string, or null if no mock value found.
     */
    resolveBinding(bindingExpr, mockData) {
        // Extract path from "{Binding Path=Foo.Bar}" or "{Binding Foo.Bar}"
        const pathMatch = bindingExpr.match(/\{Binding\s+(?:Path\s*=\s*)?([A-Za-z0-9_.]+)/i);
        if (!pathMatch)
            return null;
        const dotPath = pathMatch[1];
        const parts = dotPath.split('.');
        let value = mockData;
        for (const part of parts) {
            if (value == null || typeof value !== 'object')
                return null;
            value = value[part];
        }
        if (value == null)
            return null;
        if (typeof value === 'object')
            return JSON.stringify(value);
        return String(value);
    }
    /**
     * Generates a .maui-mock.json scaffold next to the XAML file
     * based on the ViewModel's parsed properties.
     */
    async generateMockFile(xamlFilePath, vmProperties) {
        const mockPath = this._mockPath(xamlFilePath);
        // Merge with existing (don't wipe user data)
        let existing = {};
        if (fs.existsSync(mockPath)) {
            try {
                existing = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));
            }
            catch { /* ignore */ }
        }
        for (const prop of vmProperties) {
            if (prop.isCommand)
                continue;
            if (prop.name in existing)
                continue; // keep user value
            existing[prop.name] = this._defaultForType(prop.name, prop.type);
        }
        fs.writeFileSync(mockPath, JSON.stringify(existing, null, 2), 'utf-8');
        this.mockCache.delete(mockPath);
        this._watchMockFile(xamlFilePath);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mockPath));
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        vscode.window.showInformationMessage(`Mock datoteka ustvarjena: ${path.basename(mockPath)}`);
    }
    invalidate(xamlFilePath) {
        this.mockCache.delete(this._mockPath(xamlFilePath));
    }
    hasMockFile(xamlFilePath) {
        return fs.existsSync(this._mockPath(xamlFilePath));
    }
    dispose() {
        for (const w of this.fileWatchers.values())
            w.dispose();
        this.fileWatchers.clear();
        this.mockCache.clear();
    }
    // ── Private helpers ────────────────────────────────────────────────────────
    _mockPath(xamlPath) {
        return xamlPath.replace(/\.xaml$/i, MockDataProvider.MOCK_EXT);
    }
    _loadFromDisk(xamlFilePath) {
        const mockPath = this._mockPath(xamlFilePath);
        if (!fs.existsSync(mockPath))
            return {};
        try {
            const data = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));
            this.mockCache.set(mockPath, data);
            this._watchMockFile(xamlFilePath);
            console.log(`[MockDataProvider] Loaded ${Object.keys(data).length} keys from ${path.basename(mockPath)}`);
            return data;
        }
        catch (e) {
            console.warn(`[MockDataProvider] Failed to parse ${mockPath}:`, e);
            return {};
        }
    }
    _watchMockFile(xamlFilePath) {
        const mockPath = this._mockPath(xamlFilePath);
        if (this.fileWatchers.has(mockPath))
            return;
        try {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(mockPath), path.basename(mockPath)));
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
        }
        catch { /* ignore */ }
    }
    _defaultForType(name, type) {
        const t = type.toLowerCase();
        if (t === 'string')
            return `Mock ${name}`;
        if (t === 'int' || t === 'long' || t === 'short')
            return 42;
        if (t === 'double' || t === 'float' || t === 'decimal')
            return 3.14;
        if (t === 'bool' || t === 'boolean')
            return true;
        if (t === 'datetime' || t === 'dateonly')
            return '2026-02-24';
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
exports.MockDataProvider = MockDataProvider;
MockDataProvider.MOCK_EXT = '.maui-mock.json';
//# sourceMappingURL=mockDataProvider.js.map