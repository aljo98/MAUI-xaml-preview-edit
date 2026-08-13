import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface GraphNode {
    name: string;
    filePath: string;
    kind: 'viewmodel' | 'service' | 'other';
    deps: string[];
}

export class DependencyGraphProvider {

    public static async show(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.cs', '**/node_modules/**', 500);
        if (!files.length) {
            vscode.window.showWarningMessage('Ni C# datotek v workspace-u!');
            return;
        }

        const nodes: GraphNode[] = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(file.fsPath, 'utf-8');
                const node = this._parse(file.fsPath, content);
                if (node) nodes.push(node);
            } catch { /* skip unreadable files */ }
        }

        // Filter: only VMs and Services that are actually referenced
        const allNames = new Set(nodes.map(n => n.name));
        const relevant = nodes.filter(n =>
            n.kind === 'viewmodel' ||
            (n.kind === 'service' && nodes.some(other => other.deps.includes(n.name)))
        );

        if (!relevant.length) {
            vscode.window.showWarningMessage('Ni najdenih ViewModelov!');
            return;
        }

        const mermaid = this._buildMermaid(relevant);

        const panel = vscode.window.createWebviewPanel(
            'mauiDepGraph',
            'ViewModel Dependency Graph',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        panel.webview.html = this._getHtml(mermaid, relevant.length);
    }

    // ── Parser ──────────────────────────────────────────────────────────────────

    private static _parse(filePath: string, content: string): GraphNode | null {
        const classM = /(?:public|internal)\s+(?:partial\s+|abstract\s+|sealed\s+)?(?:class|record)\s+([A-Za-z0-9_]+)/.exec(content);
        if (!classM) return null;

        const className = classM[1];
        const isVm = className.endsWith('ViewModel') || className.endsWith('VM');
        const isSvc = className.endsWith('Service') || className.endsWith('Client')
            || className.endsWith('Repository') || className.endsWith('Provider')
            || className.endsWith('Manager') || className.endsWith('Handler');
        const kind: GraphNode['kind'] = isVm ? 'viewmodel' : isSvc ? 'service' : 'other';

        if (kind === 'other') return null;

        // Extract constructor DI parameters
        const ctorRe = new RegExp(
            `${className}\\s*\\(([^)]*)\\)\\s*(?::\\s*base[^{]*)?\\s*\\{`, 'm'
        );
        const ctorM = ctorRe.exec(content);
        const deps: string[] = [];

        if (ctorM) {
            const paramList = ctorM[1];
            // Match: TypeName? paramName  or  ITypeName paramName
            const paramRe = /([A-Za-z][A-Za-z0-9_<>]*)\??\s+[a-z][A-Za-z0-9_]*/g;
            let pm: RegExpExecArray | null;
            const skip = new Set(['string', 'int', 'bool', 'double', 'float', 'decimal',
                'long', 'object', 'void', 'Task', 'CancellationToken']);
            while ((pm = paramRe.exec(paramList)) !== null) {
                const t = pm[1].replace(/<.*>/, '');
                if (!skip.has(t)) deps.push(t);
            }
        }

        return { name: className, filePath, kind, deps };
    }

    // ── Mermaid ─────────────────────────────────────────────────────────────────

    private static _buildMermaid(nodes: GraphNode[]): string {
        const lines: string[] = [
            'graph LR',
            '    classDef vm fill:#1e3a5f,stroke:#569cd6,color:#d4d4d4,rx:6',
            '    classDef svc fill:#1e4a2a,stroke:#4ec9b0,color:#d4d4d4',
            '    classDef iface fill:#3a2a1e,stroke:#ce9178,color:#d4d4d4,stroke-dasharray:5 5'
        ];

        const knownNames = new Set(nodes.map(n => n.name));

        for (const n of nodes) {
            const sid = this._safeId(n.name);
            if (n.kind === 'viewmodel') {
                lines.push(`    ${sid}["📋 ${n.name}"]:::vm`);
            } else {
                lines.push(`    ${sid}["⚙ ${n.name}"]:::svc`);
            }

            for (const dep of n.deps) {
                const depId = this._safeId(dep);
                if (!knownNames.has(dep)) {
                    // External dep: add a ghost node
                    lines.push(`    ${depId}(["${dep}"]):::iface`);
                }
                lines.push(`    ${sid} --> ${depId}`);
            }
        }

        return lines.join('\n');
    }

    private static _safeId(name: string): string {
        return name.replace(/[^A-Za-z0-9]/g, '_');
    }

    // ── HTML ────────────────────────────────────────────────────────────────────

    private static _getHtml(mermaid: string, count: number): string {
        return `<!DOCTYPE html>
<html lang="sl">
<head>
    <meta charset="UTF-8">
    <title>Dependency Graph</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        body { margin: 0; padding: 16px; background: #1e1e1e; color: #d4d4d4;
               font-family: 'Segoe UI', sans-serif; }
        h2 { color: #4ec9b0; margin: 0 0 8px; font-size: 16px; }
        .meta { font-size: 11px; color: #858585; margin-bottom: 16px; }
        .legend { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .leg { padding: 3px 10px; border-radius: 4px; font-size: 11px; }
        #diagram { background: #252526; padding: 20px; border-radius: 8px; overflow: auto; }
    </style>
</head>
<body>
    <h2>ViewModel Dependency Graph</h2>
    <div class="meta">${count} razredov · ${new Date().toLocaleTimeString('sl-SI')}</div>
    <div class="legend">
        <span class="leg" style="background:#1e3a5f;border:1px solid #569cd6">📋 ViewModel</span>
        <span class="leg" style="background:#1e4a2a;border:1px solid #4ec9b0">⚙ Service</span>
        <span class="leg" style="background:#3a2a1e;border:1px dashed #ce9178">Zunanja odvisnost</span>
    </div>
    <div id="diagram">
        <div class="mermaid">
${mermaid}
        </div>
    </div>
    <script>
        mermaid.initialize({
            startOnLoad: true, theme: 'dark',
            flowchart: { curve: 'basis', nodeSpacing: 50, rankSpacing: 80 },
            themeVariables: {
                primaryColor: '#1e3a5f', primaryTextColor: '#d4d4d4',
                primaryBorderColor: '#569cd6', lineColor: '#569cd6',
                secondaryColor: '#252526', tertiaryColor: '#1e1e1e'
            }
        });
    </script>
</body>
</html>`;
    }
}
