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
exports.FlowchartProvider = void 0;
const vscode = __importStar(require("vscode"));
class FlowchartProvider {
    static showFlowchartForCurrentMethod() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Odprite C# datoteko!');
            return;
        }
        if (!editor.document.fileName.toLowerCase().endsWith('.cs')) {
            vscode.window.showWarningMessage('Flowchart deluje samo z .cs datotekami!');
            return;
        }
        const content = editor.document.getText();
        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        const method = this._extractMethodAtOffset(content, cursorOffset);
        if (!method) {
            vscode.window.showWarningMessage('Postavite kurzor znotraj metode!');
            return;
        }
        const mermaid = this._buildMermaid(method.name, method.body);
        const panel = vscode.window.createWebviewPanel('mauiFlowchart', `⬡ Flow: ${method.name}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        panel.webview.html = this._getHtml(method.name, mermaid);
    }
    // ── Extraction ──────────────────────────────────────────────────────────────
    static _extractMethodAtOffset(content, offset) {
        // Match method signatures (not properties)
        const sig = /(?:public|private|protected|internal)(?:\s+(?:static|async|override|virtual|abstract|sealed))*\s+(?:async\s+)?(?:Task(?:<[^>]+>)?|void|[A-Za-z0-9_<>\[\],?]+)\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
        let best = null;
        let m;
        while ((m = sig.exec(content)) !== null) {
            if (m.index <= offset) {
                best = { name: m[1], bodyStart: m.index + m[0].length, sigEnd: m.index + m[0].length };
            }
            else
                break;
        }
        if (!best)
            return null;
        // Brace-match to find body end
        let depth = 1;
        let i = best.bodyStart;
        while (i < content.length && depth > 0) {
            const c = content[i];
            if (c === '{')
                depth++;
            else if (c === '}')
                depth--;
            i++;
        }
        // Validate cursor is inside method
        if (offset < best.bodyStart || offset > i)
            return null;
        return { name: best.name, body: content.substring(best.bodyStart, i - 1) };
    }
    // ── Mermaid generation ──────────────────────────────────────────────────────
    static _buildMermaid(methodName, body) {
        const stmts = this._parseStatements(body);
        let nodeId = 0;
        const id = () => `N${++nodeId}`;
        const lines = [
            'flowchart TD',
            `    Start(["▶ ${this._esc(methodName)}"])`
        ];
        let prev = 'Start';
        for (const s of stmts) {
            const nid = id();
            if (s.type === 'return' || s.type === 'throw') {
                lines.push(`    ${nid}(["${s.type === 'return' ? '⏎' : '⚠'} ${this._esc(s.text)}"])`);
                lines.push(`    ${prev} --> ${nid}`);
                prev = nid;
                if (s.type === 'throw')
                    continue;
                break; // return ends flow
            }
            else if (s.type === 'if') {
                const condId = nid;
                const yesId = id();
                const mergeId = id();
                lines.push(`    ${condId}{"${this._esc(s.condition ?? 'condition')}"}`);
                lines.push(`    ${prev} --> ${condId}`);
                lines.push(`    ${yesId}["${this._esc(s.trueBranch ?? 'then')}"]`);
                lines.push(`    ${condId} -->|"Da"| ${yesId}`);
                lines.push(`    ${yesId} --> ${mergeId}([" "])`);
                if (s.hasElse && s.falseBranch) {
                    const noId = id();
                    lines.push(`    ${noId}["${this._esc(s.falseBranch)}"]`);
                    lines.push(`    ${condId} -->|"Ne"| ${noId}`);
                    lines.push(`    ${noId} --> ${mergeId}`);
                }
                else {
                    lines.push(`    ${condId} -->|"Ne"| ${mergeId}`);
                }
                prev = mergeId;
            }
            else if (s.type === 'try') {
                const tryId = nid;
                const catchId = id();
                const mergeId = id();
                lines.push(`    ${tryId}["🛡 ${this._esc(s.trueBranch ?? 'try block')}"]`);
                lines.push(`    ${prev} --> ${tryId}`);
                lines.push(`    ${tryId} -->|"ok"| ${mergeId}([" "])`);
                lines.push(`    ${catchId}["⚠ catch: ${this._esc(s.falseBranch ?? 'handle error')}"]`);
                lines.push(`    ${tryId} -->|"napaka"| ${catchId}`);
                lines.push(`    ${catchId} --> ${mergeId}`);
                prev = mergeId;
            }
            else if (s.type === 'foreach' || s.type === 'for' || s.type === 'while') {
                const loopId = nid;
                const bodyId = id();
                const exitId = id();
                const icon = s.type === 'foreach' ? '∀' : s.type === 'for' ? '#' : '↺';
                lines.push(`    ${loopId}{"${icon} ${this._esc(s.condition ?? s.text)}"}`);
                lines.push(`    ${prev} --> ${loopId}`);
                lines.push(`    ${bodyId}["${this._esc(s.trueBranch ?? 'body')}"]`);
                lines.push(`    ${loopId} -->|"Da"| ${bodyId}`);
                lines.push(`    ${bodyId} --> ${loopId}`);
                lines.push(`    ${loopId} -->|"Konec"| ${exitId}([" "])`);
                prev = exitId;
            }
            else if (s.type === 'await') {
                lines.push(`    ${nid}["⏳ ${this._esc(s.text)}"]`);
                lines.push(`    ${prev} --> ${nid}`);
                prev = nid;
            }
            else {
                // generic statement
                if (!s.text || s.text.length < 2)
                    continue;
                lines.push(`    ${nid}["${this._esc(s.text)}"]`);
                lines.push(`    ${prev} --> ${nid}`);
                prev = nid;
            }
        }
        lines.push(`    End(["⏹ End"])`);
        lines.push(`    ${prev} --> End`);
        return lines.join('\n');
    }
    // ── Statement parser ────────────────────────────────────────────────────────
    static _parseStatements(body) {
        const out = [];
        const rawLines = body.split('\n');
        // Simple single-pass line analysis — good enough for most methods
        for (let i = 0; i < rawLines.length; i++) {
            const raw = rawLines[i].trim();
            if (!raw || raw.startsWith('//') || raw.startsWith('*') || raw === '{' || raw === '}')
                continue;
            const ifM = /^if\s*\((.+)\)/.exec(raw);
            const elseM = /^}\s*else\b/.exec(raw);
            const retM = /^return\b(.*)/.exec(raw);
            const throwM = /^throw\b(.*)/.exec(raw);
            const tryM = /^try\b/.exec(raw);
            const catchM = /^}\s*catch[^{]*\{?/.exec(raw);
            const foreachM = /^foreach\s*\(([^)]+)\)/.exec(raw);
            const forM = /^for\s*\(([^)]+)\)/.exec(raw);
            const whileM = /^while\s*\(([^)]+)\)/.exec(raw);
            const awaitM = /^(?:var\s+\w+\s*=\s*)?await\s+(.+)/.exec(raw);
            if (ifM) {
                // Peek for else
                const joined = rawLines.slice(i, Math.min(i + 8, rawLines.length)).join(' ');
                const hasElse = /\}\s*else\s*\{/.test(joined);
                // Extract true/false single-line branches if available
                const innerTrue = rawLines[i + 1]?.trim().replace(/[;{}]/g, '') ?? 'then';
                const innerFalse = hasElse
                    ? (rawLines.slice(i + 1, i + 8).find(l => {
                        const t = l.trim();
                        return t && t !== '{' && t !== '}' && !/^(if|else|\/\/)/.test(t);
                    })?.trim().replace(/[;{}]/g, '') ?? 'else')
                    : undefined;
                out.push({ type: 'if', text: raw, condition: `if (${ifM[1]})`, trueBranch: innerTrue, falseBranch: innerFalse, hasElse });
            }
            else if (retM) {
                out.push({ type: 'return', text: `return ${retM[1].replace(/;/, '')}`.trim() });
            }
            else if (throwM) {
                out.push({ type: 'throw', text: `throw ${throwM[1].replace(/;/, '')}`.trim() });
            }
            else if (tryM) {
                const innerTry = rawLines.slice(i + 1, i + 5)
                    .map(l => l.trim()).filter(l => l && l !== '{').slice(0, 2).join('; ') || 'try block';
                const innerCatch = rawLines.slice(i, i + 15)
                    .find(l => /catch/.test(l))?.trim() ?? 'catch';
                out.push({ type: 'try', text: raw, trueBranch: innerTry, falseBranch: innerCatch });
            }
            else if (foreachM) {
                out.push({ type: 'foreach', text: raw, condition: `foreach (${foreachM[1]})`, trueBranch: 'body' });
            }
            else if (forM) {
                out.push({ type: 'for', text: raw, condition: `for (${forM[1]})`, trueBranch: 'body' });
            }
            else if (whileM) {
                out.push({ type: 'while', text: raw, condition: `while (${whileM[1]})`, trueBranch: 'body' });
            }
            else if (awaitM) {
                out.push({ type: 'await', text: `await ${awaitM[1].replace(/;$/, '')}` });
            }
            else if (!catchM && !elseM && raw !== 'else' && !raw.startsWith('}') && !raw.startsWith('{')) {
                out.push({ type: 'statement', text: raw.replace(/;$/, '') });
            }
        }
        return out;
    }
    // ── Helpers ─────────────────────────────────────────────────────────────────
    static _esc(s) {
        return s.trim()
            .replace(/"/g, "'")
            .replace(/[<>{}|[\]]/g, ' ')
            .substring(0, 60);
    }
    static _getHtml(methodName, mermaid) {
        return `<!DOCTYPE html>
<html lang="sl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flow: ${methodName}</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        body { margin: 0; padding: 16px; background: #1e1e1e; color: #d4d4d4;
               font-family: 'Segoe UI', sans-serif; }
        h2 { margin: 0 0 12px; color: #569cd6; font-size: 16px; }
        .meta { font-size: 11px; color: #858585; margin-bottom: 16px; }
        #diagram { background: #252526; padding: 20px; border-radius: 8px;
                   overflow: auto; min-height: 200px; }
        .mermaid svg { max-width: 100%; height: auto; }
    </style>
</head>
<body>
    <h2>⬡ Flow: ${methodName}</h2>
    <div class="meta">Generirano iz C# metode · ${new Date().toLocaleTimeString('sl-SI')}</div>
    <div id="diagram">
        <div class="mermaid">
${mermaid}
        </div>
    </div>
    <script>
        mermaid.initialize({
            startOnLoad: true,
            theme: 'dark',
            flowchart: { curve: 'basis', htmlLabels: true },
            themeVariables: {
                primaryColor: '#1e3a5f',
                primaryTextColor: '#d4d4d4',
                primaryBorderColor: '#569cd6',
                lineColor: '#569cd6',
                secondaryColor: '#252526',
                tertiaryColor: '#1e1e1e'
            }
        });
    </script>
</body>
</html>`;
    }
}
exports.FlowchartProvider = FlowchartProvider;
//# sourceMappingURL=flowchartProvider.js.map