import * as http from 'http';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import type { MauiXamlPreviewProvider } from './previewProvider';

const DEFAULT_PORT = 3100;

/**
 * MCP Server for MAUI XAML Preview extension.
 * Exposes tools so AI agents (Windsurf, Claude, etc.) can interact with the preview.
 *
 * Transport: SSE on http://localhost:{port}/sse
 * Message endpoint: POST http://localhost:{port}/message
 */
export class MauiMcpServer {
    private _server: McpServer;
    private _httpServer: http.Server | undefined;
    private _transport: SSEServerTransport | undefined;
    private _previewProvider: MauiXamlPreviewProvider;
    private _port: number;

    constructor(previewProvider: MauiXamlPreviewProvider) {
        this._previewProvider = previewProvider;
        this._port = vscode.workspace.getConfiguration('mauiXamlPreview').get<number>('mcpPort', DEFAULT_PORT);

        this._server = new McpServer({
            name: 'maui-xaml-preview',
            version: '0.1.7',
        });

        this._registerTools();
        this._registerResources();
    }

    // ─── Tools ───────────────────────────────────────────────

    private _registerTools(): void {

        // 1. Get selected element context
        this._server.tool(
            'get_selected_element',
            'Returns the currently selected XAML element with type, attributes, parent, children, and line range.',
            {},
            async () => {
                const ctx = this._previewProvider.getSelectedElementContext();
                if (!ctx) {
                    return { content: [{ type: 'text' as const, text: 'No element is currently selected in the preview.' }] };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(ctx, null, 2)
                    }]
                };
            }
        );

        // 2. List all elements in parsed tree
        this._server.tool(
            'list_elements',
            'Returns a flat list of all parsed XAML elements with id, type, name, line range, and parent.',
            {},
            async () => {
                const elements = this._previewProvider.getAllElements();
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(elements, null, 2)
                    }]
                };
            }
        );

        // 3. Get element by ID
        this._server.tool(
            'get_element',
            'Returns detailed info about a specific XAML element by its ID.',
            { elementId: z.string().describe('The element ID (e.g., "el_3")') },
            async ({ elementId }) => {
                const el = this._previewProvider.getElementById(elementId);
                if (!el) {
                    return { content: [{ type: 'text' as const, text: `Element "${elementId}" not found.` }] };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(el, null, 2)
                    }]
                };
            }
        );

        // 4. Select element in preview
        this._server.tool(
            'select_element',
            'Selects an element in the XAML preview by its ID. Highlights it in the editor and properties panel.',
            { elementId: z.string().describe('The element ID to select') },
            async ({ elementId }) => {
                try {
                    await this._previewProvider.selectElementById(elementId);
                    return { content: [{ type: 'text' as const, text: `Element "${elementId}" selected.` }] };
                } catch (e: any) {
                    return { content: [{ type: 'text' as const, text: `Failed to select: ${e.message}` }] };
                }
            }
        );

        // 5. Edit element property (safe, scoped edit)
        this._server.tool(
            'edit_property',
            'Edits a property on a specific XAML element. Only modifies the attribute within the element\'s opening tag.',
            {
                elementId: z.string().describe('The element ID to edit'),
                key: z.string().describe('Property name (e.g., "BackgroundColor", "Text", "Margin")'),
                value: z.string().describe('New property value'),
            },
            async ({ elementId, key, value }) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
                    return { content: [{ type: 'text' as const, text: 'No XAML file is open in the editor.' }] };
                }

                const el = this._previewProvider.getElementById(elementId);
                if (!el) {
                    return { content: [{ type: 'text' as const, text: `Element "${elementId}" not found.` }] };
                }

                // Use safeEditAttribute via the command
                const range = this._previewProvider.getElementRange(elementId);
                const doc = editor.document;
                const text = doc.getText();

                let searchStart = 0;
                let searchEnd = text.length;
                if (range) {
                    searchStart = doc.offsetAt(new vscode.Position(range.startLine, 0));
                    const endLine = Math.min(range.endLine + 2, doc.lineCount - 1);
                    searchEnd = doc.offsetAt(new vscode.Position(endLine, Number.MAX_SAFE_INTEGER));
                }

                const scopedText = text.slice(searchStart, searchEnd);
                const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const attrRegex = new RegExp(`${keyPattern}\\s*=\\s*"([^"]*)"`, 'i');
                const match = attrRegex.exec(scopedText);

                const edit = new vscode.WorkspaceEdit();
                if (match) {
                    const absIdx = searchStart + match.index;
                    const start = doc.positionAt(absIdx);
                    const end = doc.positionAt(absIdx + match[0].length);
                    edit.replace(doc.uri, new vscode.Range(start, end), `${key}="${value}"`);
                } else {
                    const openTagRegex = new RegExp(`<${el.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s>]`, 'i');
                    const tagMatch = openTagRegex.exec(scopedText);
                    if (tagMatch) {
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

                if (edit.size > 0) {
                    await vscode.workspace.applyEdit(edit);
                    await doc.save();
                    // Update preview DOM
                    this._previewProvider.updateElementProperty(
                        { key, value, type: 'string', section: 'appearance', elementType: el.type, elementId } as any,
                        value
                    );
                    return { content: [{ type: 'text' as const, text: `Property ${key}="${value}" applied to ${el.type} (${elementId}).` }] };
                }
                return { content: [{ type: 'text' as const, text: `Could not apply ${key}="${value}" to ${elementId}.` }] };
            }
        );

        // 6. Get current XAML file content
        this._server.tool(
            'get_xaml_content',
            'Returns the full XAML source of the currently open file.',
            {},
            async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || !editor.document.fileName.toLowerCase().endsWith('.xaml')) {
                    return { content: [{ type: 'text' as const, text: 'No XAML file is open.' }] };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: editor.document.getText()
                    }]
                };
            }
        );

        // 7. Get preview HTML
        this._server.tool(
            'get_preview_html',
            'Returns the generated HTML preview of the current XAML file.',
            {},
            async () => {
                const html = this._previewProvider.getCurrentHtml();
                if (!html) {
                    return { content: [{ type: 'text' as const, text: 'No preview is active.' }] };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: html
                    }]
                };
            }
        );

        // 8. Get resource/style/color suggestions
        this._server.tool(
            'get_design_suggestions',
            'Returns available design tokens: colors, styles, and resource keys from the current XAML context.',
            {},
            async () => {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            colors: this._previewProvider.getColorSuggestions(),
                            styles: this._previewProvider.getStyleSuggestions(),
                            resources: this._previewProvider.getResourceKeySuggestions(),
                        }, null, 2)
                    }]
                };
            }
        );
    }

    // ─── Resources ───────────────────────────────────────────

    private _registerResources(): void {
        this._server.resource(
            'element-tree',
            'maui://element-tree',
            { description: 'Current XAML element tree structure', mimeType: 'application/json' },
            async () => {
                const elements = this._previewProvider.getAllElements();
                return {
                    contents: [{
                        uri: 'maui://element-tree',
                        text: JSON.stringify(elements, null, 2),
                        mimeType: 'application/json'
                    }]
                };
            }
        );

        this._server.resource(
            'design-tokens',
            'maui://design-tokens',
            { description: 'Available design tokens (colors, styles, resources)', mimeType: 'application/json' },
            async () => {
                return {
                    contents: [{
                        uri: 'maui://design-tokens',
                        text: JSON.stringify({
                            colors: this._previewProvider.getColorSuggestions(),
                            styles: this._previewProvider.getStyleSuggestions(),
                            resources: this._previewProvider.getResourceKeySuggestions(),
                        }, null, 2),
                        mimeType: 'application/json'
                    }]
                };
            }
        );
    }

    // ─── Lifecycle ───────────────────────────────────────────

    public async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this._httpServer = http.createServer(async (req, res) => {
                // CORS headers for local connections
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                const url = new URL(req.url || '/', `http://localhost:${this._port}`);

                if (url.pathname === '/sse') {
                    // New SSE connection
                    this._transport = new SSEServerTransport('/message', res);
                    await this._server.connect(this._transport);
                } else if (url.pathname === '/message' && req.method === 'POST') {
                    // Message from client
                    if (this._transport) {
                        await this._transport.handlePostMessage(req, res);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'No active SSE connection' }));
                    }
                } else if (url.pathname === '/health') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', name: 'maui-xaml-preview-mcp', port: this._port }));
                } else {
                    res.writeHead(404);
                    res.end('Not found');
                }
            });

            this._httpServer.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.warn(`[MCP] Port ${this._port} in use, trying ${this._port + 1}`);
                    this._port++;
                    this._httpServer!.listen(this._port, '127.0.0.1');
                } else {
                    reject(err);
                }
            });

            this._httpServer.listen(this._port, '127.0.0.1', () => {
                console.log(`[MCP] MAUI XAML Preview MCP server running on http://127.0.0.1:${this._port}`);
                vscode.window.showInformationMessage(`MCP server aktiven na portu ${this._port}`);
                resolve();
            });
        });
    }

    public get port(): number {
        return this._port;
    }

    public async stop(): Promise<void> {
        if (this._transport) {
            await this._transport.close();
            this._transport = undefined;
        }
        if (this._httpServer) {
            return new Promise((resolve) => {
                this._httpServer!.close(() => {
                    console.log('[MCP] Server stopped');
                    resolve();
                });
            });
        }
    }
}
