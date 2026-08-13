import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface ClassInfo {
    name: string;
    baseClass?: string;
    interfaces: string[];
    filePath: string;
    isAbstract: boolean;
    isInterface: boolean;
}

export class ClassHierarchyProvider {

    public static async showForCurrentFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.toLowerCase().endsWith('.cs')) {
            vscode.window.showWarningMessage('Odprite C# datoteko!');
            return;
        }

        const content = editor.document.getText();
        const classM = /(?:class|interface|record)\s+([A-Za-z0-9_]+)/.exec(content);
        if (!classM) {
            vscode.window.showWarningMessage('Razred/vmesnik ni najden v datoteki!');
            return;
        }
        const targetName = classM[1];

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Gradim hierarhijo za ${targetName}…` },
            async () => {
                const allFiles = await vscode.workspace.findFiles('**/*.cs', '**/node_modules/**', 800);
                const allClasses: ClassInfo[] = [];

                for (const f of allFiles) {
                    try {
                        const c = fs.readFileSync(f.fsPath, 'utf-8');
                        allClasses.push(...this._parseFile(f.fsPath, c));
                    } catch { /* skip */ }
                }

                const mermaid = this._buildMermaid(targetName, allClasses);

                const panel = vscode.window.createWebviewPanel(
                    'mauiClassHierarchy',
                    `Hierarhija: ${targetName}`,
                    vscode.ViewColumn.Beside,
                    { enableScripts: true, retainContextWhenHidden: true }
                );
                panel.webview.html = this._getHtml(targetName, mermaid);
            }
        );
    }

    // ── Parser ──────────────────────────────────────────────────────────────────

    private static _parseFile(filePath: string, content: string): ClassInfo[] {
        const results: ClassInfo[] = [];
        // Matches: [abstract] class/record/interface Name<...> : Base, IFace1, IFace2
        const re = /(?:(abstract|sealed)\s+)?(?:(interface)\s+|(class|record)\s+)([A-Za-z0-9_]+)(?:<[^>]+>)?(?:\s*:\s*([^{]+))?\s*\{/g;
        let m: RegExpExecArray | null;

        while ((m = re.exec(content)) !== null) {
            const modifier = m[1];
            const isInterface = !!m[2];
            const rawName = m[4];
            const inherits = m[5]?.trim();

            if (!rawName || rawName === 'string') continue;

            let baseClass: string | undefined;
            const interfaces: string[] = [];

            if (inherits) {
                const parts = inherits.split(',').map(p => {
                    // Strip generics and whitespace
                    return p.trim().replace(/<[^>]+>/g, '').trim();
                });
                for (const p of parts) {
                    if (!p) continue;
                    if (p.startsWith('I') && p.length > 1 && p[1] === p[1].toUpperCase()) {
                        interfaces.push(p);
                    } else if (!baseClass) {
                        baseClass = p;
                    }
                }
            }

            results.push({
                name: rawName,
                baseClass,
                interfaces,
                filePath,
                isAbstract: modifier === 'abstract',
                isInterface
            });
        }

        return results;
    }

    // ── Mermaid ─────────────────────────────────────────────────────────────────

    private static _buildMermaid(target: string, all: ClassInfo[]): string {
        const byName = new Map<string, ClassInfo>();
        for (const c of all) byName.set(c.name, c);

        const lines: string[] = [
            'graph TD',
            '    classDef target fill:#6b2fb3,stroke:#c586c0,color:white,font-weight:bold',
            '    classDef base fill:#1e3a5f,stroke:#569cd6,color:#d4d4d4',
            '    classDef iface fill:#1e4a2a,stroke:#4ec9b0,color:#d4d4d4',
            '    classDef child fill:#3a2a1e,stroke:#ce9178,color:#d4d4d4',
            '    classDef abstract fill:#2a1e3a,stroke:#c586c0,color:#d4d4d4,stroke-dasharray:4 2'
        ];

        const added = new Set<string>();
        const addNode = (name: string, cssClass: string) => {
            if (added.has(name)) return;
            added.add(name);
            const info = byName.get(name);
            const icon = info?.isInterface ? '«I»' : info?.isAbstract ? '«A»' : '';
            const label = icon ? `${icon} ${name}` : name;
            lines.push(`    ${name}["${label}"]:::${cssClass}`);
        };

        addNode(target, 'target');

        // Walk parents up
        const addParents = (name: string) => {
            const info = byName.get(name);
            if (!info) return;
            if (info.baseClass) {
                addNode(info.baseClass, 'base');
                lines.push(`    ${info.baseClass} --> ${name}`);
                addParents(info.baseClass);
            }
            for (const iface of info.interfaces) {
                addNode(iface, 'iface');
                lines.push(`    ${iface} -.-> ${name}`);
            }
        };

        // Walk children down (direct subclasses)
        const addChildren = (name: string, depth = 0) => {
            if (depth > 3) return; // max depth
            for (const info of all) {
                if (info.baseClass === name && !added.has(info.name)) {
                    addNode(info.name, info.isAbstract ? 'abstract' : 'child');
                    lines.push(`    ${name} --> ${info.name}`);
                    addChildren(info.name, depth + 1);
                }
            }
        };

        addParents(target);
        addChildren(target);

        return lines.join('\n');
    }

    // ── HTML ────────────────────────────────────────────────────────────────────

    private static _getHtml(className: string, mermaid: string): string {
        return `<!DOCTYPE html>
<html lang="sl">
<head>
    <meta charset="UTF-8">
    <title>Hierarhija: ${className}</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        body { margin: 0; padding: 16px; background: #1e1e1e; color: #d4d4d4;
               font-family: 'Segoe UI', sans-serif; }
        h2 { color: #c586c0; margin: 0 0 8px; font-size: 16px; }
        .meta { font-size: 11px; color: #858585; margin-bottom: 12px; }
        .legend { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .leg { padding: 3px 10px; border-radius: 4px; font-size: 11px; }
        #diagram { background: #252526; padding: 20px; border-radius: 8px; overflow: auto; }
    </style>
</head>
<body>
    <h2>Hierarhija: ${className}</h2>
    <div class="meta">${new Date().toLocaleTimeString('sl-SI')}</div>
    <div class="legend">
        <span class="leg" style="background:#6b2fb3;border:1px solid #c586c0">Target</span>
        <span class="leg" style="background:#1e3a5f;border:1px solid #569cd6">Starš</span>
        <span class="leg" style="background:#1e4a2a;border:1px solid #4ec9b0">Vmesnik</span>
        <span class="leg" style="background:#3a2a1e;border:1px solid #ce9178">Otrok</span>
        <span class="leg" style="background:#2a1e3a;border:1px dashed #c586c0">Abstrakten</span>
    </div>
    <div id="diagram">
        <div class="mermaid">
${mermaid}
        </div>
    </div>
    <script>
        mermaid.initialize({
            startOnLoad: true, theme: 'dark',
            flowchart: { curve: 'basis' },
            themeVariables: {
                primaryColor: '#1e3a5f', primaryTextColor: '#d4d4d4',
                primaryBorderColor: '#569cd6', lineColor: '#569cd6',
                secondaryColor: '#252526'
            }
        });
    </script>
</body>
</html>`;
    }
}
