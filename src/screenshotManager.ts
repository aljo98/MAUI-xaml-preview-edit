/**
 * Screenshot Manager for MAUI XAML Preview
 * - Capture screenshots from emulator (adb screencap)
 * - Capture screenshots from webview preview
 * - Generate and inspect HTML
 * - Compare preview vs real app screenshots
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface ScreenshotResult {
    success: boolean;
    path?: string;
    base64?: string;
    error?: string;
}

export interface ComparisonResult {
    previewPath: string;
    devicePath: string;
    diffPath?: string;
    similarity?: number;
}

export class ScreenshotManager {
    private _adbPath: string = 'adb';
    private _screenshotsDir: string;
    private _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._screenshotsDir = path.join(context.globalStorageUri.fsPath, 'screenshots');
        this._ensureScreenshotsDir();
        this._detectAdbPath();
    }

    private _ensureScreenshotsDir(): void {
        if (!fs.existsSync(this._screenshotsDir)) {
            fs.mkdirSync(this._screenshotsDir, { recursive: true });
        }
    }

    private _detectAdbPath(): void {
        const possiblePaths = [
            path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
            path.join(process.env.ANDROID_HOME || '', 'platform-tools', 'adb.exe'),
            path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb.exe'),
            'C:\\Users\\fajdi\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
        ];

        for (const adbPath of possiblePaths) {
            if (fs.existsSync(adbPath)) {
                this._adbPath = adbPath;
                break;
            }
        }
    }

    private _execCommand(cmd: string, timeout: number = 30000): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            exec(cmd, { encoding: 'utf8', timeout }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout || '', stderr: stderr || '' });
                }
            });
        });
    }

    /**
     * Capture screenshot from Android emulator/device via ADB
     */
    public async captureDeviceScreenshot(deviceId?: string): Promise<ScreenshotResult> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `device-screenshot-${timestamp}.png`;
        const remotePath = `/sdcard/${filename}`;
        const localPath = path.join(this._screenshotsDir, filename);

        try {
            // Get device ID if not provided
            if (!deviceId) {
                const devices = await this._getDevices();
                if (devices.length === 0) {
                    return { success: false, error: 'No Android device connected. Run "adb devices" first.' };
                }
                deviceId = devices[0];
            }

            // Take screenshot on device
            const deviceFlag = deviceId ? `-s ${deviceId}` : '';
            await this._execCommand(`"${this._adbPath}" ${deviceFlag} shell screencap -p "${remotePath}"`);

            // Pull screenshot to local
            await this._execCommand(`"${this._adbPath}" ${deviceFlag} pull "${remotePath}" "${localPath}"`);

            // Remove from device
            await this._execCommand(`"this._adbPath}" ${deviceFlag} shell rm "${remotePath}"`);

            return {
                success: true,
                path: localPath
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Failed to capture device screenshot'
            };
        }
    }

    /**
     * Save webview preview screenshot (base64 from webview)
     */
    public async savePreviewScreenshot(base64Data: string, label: string = 'preview'): Promise<ScreenshotResult> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${label}-${timestamp}.png`;
        const localPath = path.join(this._screenshotsDir, filename);

        try {
            // Remove data URL prefix if present
            const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64, 'base64');
            fs.writeFileSync(localPath, buffer);

            return {
                success: true,
                path: localPath
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Failed to save preview screenshot'
            };
        }
    }

    /**
     * Get the generated HTML content from the preview
     */
    public async getPreviewHtml(webviewHtml: string): Promise<{ success: boolean; html?: string; path?: string; error?: string }> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `preview-html-${timestamp}.html`;
        const localPath = path.join(this._screenshotsDir, filename);

        try {
            // Save the HTML
            fs.writeFileSync(localPath, webviewHtml);

            return {
                success: true,
                html: webviewHtml,
                path: localPath
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Failed to save HTML'
            };
        }
    }

    /**
     * Extract CSS styles from HTML for inspection
     */
    public extractStyles(html: string): string[] {
        const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
        const styles: string[] = [];
        let match;

        while ((match = styleRegex.exec(html)) !== null) {
            styles.push(match[1]);
        }

        return styles;
    }

    /**
     * Extract inline styles from HTML elements
     */
    public extractInlineStyles(html: string): Record<string, string>[] {
        const styleAttrRegex = /style="([^"]*)"/gi;
        const styles: Record<string, string>[] = [];
        let match;

        while ((match = styleAttrRegex.exec(html)) !== null) {
            const styleObj: Record<string, string> = {};
            const declarations = match[1].split(';');
            for (const decl of declarations) {
                const [prop, value] = decl.split(':').map(s => s.trim());
                if (prop && value) {
                    styleObj[prop] = value;
                }
            }
            styles.push(styleObj);
        }

        return styles;
    }

    /**
     * Get list of HTML elements with their properties
     */
    public analyzeHtmlStructure(html: string): { tag: string; count: number; styles: string[] }[] {
        const elementRegex = /<(\w+)[^>]*/gi;
        const tagCounts = new Map<string, number>();
        const tagStyles = new Map<string, Set<string>>();
        let match;

        while ((match = elementRegex.exec(html)) !== null) {
            const tag = match[1].toLowerCase();
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

            // Extract class names
            const classMatch = match[0].match(/class="([^"]*)"/i);
            if (classMatch) {
                const classes = classMatch[1].split(/\s+/);
                if (!tagStyles.has(tag)) {
                    tagStyles.set(tag, new Set());
                }
                classes.forEach(c => tagStyles.get(tag)!.add(c));
            }
        }

        return Array.from(tagCounts.entries())
            .map(([tag, count]) => ({
                tag,
                count,
                styles: Array.from(tagStyles.get(tag) || [])
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Compare two screenshots and generate a diff
     */
    public async compareScreenshots(previewPath: string, devicePath: string): Promise<ComparisonResult | null> {
        try {
            // Basic file existence check
            if (!fs.existsSync(previewPath)) {
                vscode.window.showErrorMessage(`Preview screenshot not found: ${previewPath}`);
                return null;
            }
            if (!fs.existsSync(devicePath)) {
                vscode.window.showErrorMessage(`Device screenshot not found: ${devicePath}`);
                return null;
            }

            const result: ComparisonResult = {
                previewPath,
                devicePath
            };

            // Open both images in VS Code for visual comparison
            const doc1 = await vscode.workspace.openTextDocument(previewPath);
            const doc2 = await vscode.workspace.openTextDocument(devicePath);

            await vscode.window.showTextDocument(doc1, { viewColumn: vscode.ViewColumn.One });
            await vscode.window.showTextDocument(doc2, { viewColumn: vscode.ViewColumn.Two });

            return result;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Comparison failed: ${error.message}`);
            return null;
        }
    }

    /**
     * List all screenshots in the screenshots directory
     */
    public listScreenshots(): { name: string; path: string; date: Date }[] {
        if (!fs.existsSync(this._screenshotsDir)) {
            return [];
        }

        return fs.readdirSync(this._screenshotsDir)
            .filter(f => f.endsWith('.png') || f.endsWith('.html'))
            .map(f => {
                const stats = fs.statSync(path.join(this._screenshotsDir, f));
                return {
                    name: f,
                    path: path.join(this._screenshotsDir, f),
                    date: stats.mtime
                };
            })
            .sort((a, b) => b.date.getTime() - a.date.getTime());
    }

    /**
     * Open screenshot folder in explorer
     */
    public openScreenshotsFolder(): void {
        vscode.env.openExternal(vscode.Uri.file(this._screenshotsDir));
    }

    /**
     * Get connected Android devices
     */
    private async _getDevices(): Promise<string[]> {
        try {
            const result = await this._execCommand(`"${this._adbPath}" devices -l`);
            const lines = result.stdout.split('\n');
            const devices: string[] = [];

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts[1] === 'device') {
                    devices.push(parts[0]);
                }
            }

            return devices;
        } catch {
            return [];
        }
    }

    /**
     * Quick command to list connected devices
     */
    public async listDevices(): Promise<string[]> {
        return this._getDevices();
    }

    /**
     * Run custom ADB command
     */
    public async runAdbCommand(args: string): Promise<{ success: boolean; output?: string; error?: string }> {
        try {
            const result = await this._execCommand(`"${this._adbPath}" ${args}`);
            return { success: true, output: result.stdout };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
}
