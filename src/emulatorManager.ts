import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface EmulatorDevice {
    id: string;
    name: string;
    state: 'booting' | 'ready' | 'offline';
    platform: 'android' | 'ios' | 'windows' | 'macos';
}

export interface MetroConnection {
    url: string;
    platform: string;
    connected: boolean;
}

export class EmulatorManager {
    private _devices: EmulatorDevice[] = [];
    private _metroConnections: Map<string, MetroConnection> = new Map();
    private _adbPath: string = 'adb';

    constructor() {
        this._detectAdbPath();
    }

    private async _detectAdbPath(): Promise<void> {
        // Common Android SDK locations
        const possiblePaths = [
            path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
            path.join(process.env.ANDROID_HOME || '', 'platform-tools', 'adb.exe'),
            path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb.exe'),
            'C:\\Users\\fajdi\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
        ];

        for (const adbPath of possiblePaths) {
            if (fs.existsSync(adbPath)) {
                this._adbPath = adbPath;
                console.log('[EmulatorManager] Found ADB at:', adbPath);
                return;
            }
        }

        console.log('[EmulatorManager] Using ADB from PATH:', this._adbPath);
    }

    private _execCommand(cmd: string): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            exec(cmd, { encoding: 'utf8', timeout: 15000 }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject(error);
                } else {
                    resolve({ stdout: stdout || '', stderr: stderr || '' });
                }
            });
        });
    }

    /**
     * List all connected Android devices
     */
    public async listDevices(): Promise<EmulatorDevice[]> {
        try {
            const result = await this._execCommand(`"${this._adbPath}" devices -l`);
            const lines = result.stdout.split('\n').filter(l => l.trim());
            this._devices = [];

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const parts = line.split(/\s+/);
                const id = parts[0];
                const state = parts[1]?.toLowerCase() || 'offline';

                // Parse additional info - safe string scanning
                const product = this._safeExtract(line, 'product:');
                const model = this._safeExtract(line, 'model:');
                const device = this._safeExtract(line, 'device:');

                let deviceState: EmulatorDevice['state'] = 'offline';
                if (state === 'device') deviceState = 'ready';
                else if (state.includes('bootloader') || state.includes('recovery')) deviceState = 'booting';

                this._devices.push({
                    id,
                    name: model || device || id,
                    state: deviceState,
                    platform: 'android'
                });
            }

            return this._devices;
        } catch (error) {
            console.error('[EmulatorManager] Error listing devices:', error);
            return [];
        }
    }

    // Safe string extraction without dynamic regex
    private _safeExtract(line: string, key: string): string | undefined {
        const idx = line.indexOf(key);
        if (idx === -1) return undefined;
        const after = line.substring(idx + key.length).trimStart();
        const match = after.match(/^(\S+)/);
        return match ? match[1] : undefined;
    }

    /**
     * Start an emulator by name or AVD
     */
    public async startEmulator(avdName: string): Promise<boolean> {
        try {
            const emulatorPath = await this._findEmulatorPath();
            if (emulatorPath) {
                // Start emulator in background
                spawn(emulatorPath, ['-avd', avdName, '-no-snapshot-load'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
                console.log(`[EmulatorManager] Starting emulator: ${avdName}`);
                return true;
            }

            vscode.window.showInformationMessage(`Zaženite emulator ročno: emulator -avd ${avdName}`);
            return false;
        } catch (error) {
            console.error('[EmulatorManager] Error starting emulator:', error);
            return false;
        }
    }

    private async _findEmulatorPath(): Promise<string | null> {
        const possiblePaths = [
            path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'emulator', 'emulator.exe'),
            path.join(process.env.ANDROID_HOME || '', 'emulator', 'emulator.exe'),
            path.join(process.env.ANDROID_SDK_ROOT || '', 'emulator', 'emulator.exe'),
            'C:\\Users\\fajdi\\AppData\\Local\\Android\\Sdk\\emulator\\emulator.exe',
        ];

        for (const emulatorPath of possiblePaths) {
            if (fs.existsSync(emulatorPath)) {
                return emulatorPath;
            }
        }
        return null;
    }

    /**
     * Install APK on device
     */
    public async installApk(deviceId: string, apkPath: string): Promise<boolean> {
        try {
            const result = await this._execCommand(`"${this._adbPath}" -s ${deviceId} install -r "${apkPath}"`);
            return result.stdout.includes('Success');
        } catch (error) {
            console.error('[EmulatorManager] Error installing APK:', error);
            return false;
        }
    }

    /**
     * Launch app on device
     */
    public async launchApp(deviceId: string, packageName: string, activityName?: string): Promise<boolean> {
        try {
            const activity = activityName || '.MainActivity';
            await this._execCommand(
                `"${this._adbPath}" -s ${deviceId} shell am start -n ${packageName}/${activity} -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`
            );
            return true;
        } catch (error) {
            console.error('[EmulatorManager] Error launching app:', error);
            return false;
        }
    }

    /**
     * Connect to Metro bundler (Hot Reload)
     */
    public async connectToMetro(deviceId: string): Promise<MetroConnection | null> {
        try {
            // Forward Metro port
            await this._execCommand(`"${this._adbPath}" -s ${deviceId} forward tcp:9988 tcp:9988`);
            
            const connection: MetroConnection = {
                url: 'http://localhost:9988',
                platform: 'android',
                connected: true
            };

            this._metroConnections.set(deviceId, connection);
            console.log('[EmulatorManager] Connected to Metro:', connection.url);
            
            return connection;
        } catch (error) {
            console.error('[EmulatorManager] Error connecting to Metro:', error);
            return null;
        }
    }

    /**
     * Disconnect from Metro
     */
    public disconnectFromMetro(deviceId: string): void {
        this._metroConnections.delete(deviceId);
    }

    /**
     * Check if app is running
     */
    public async isAppRunning(deviceId: string, packageName: string): Promise<boolean> {
        try {
            const result = await this._execCommand(
                `"${this._adbPath}" -s ${deviceId} shell pm list packages ${packageName}`
            );
            return result.stdout.includes(packageName);
        } catch {
            return false;
        }
    }

    /**
     * Check if Metro is accessible
     */
    public async checkMetroStatus(): Promise<boolean> {
        try {
            const result = await this._execCommand(`curl -s --connect-timeout 3 http://localhost:9988 2>nul`);
            return result.stdout.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get available AVDs
     */
    public async listAVDs(): Promise<string[]> {
        try {
            const emulatorPath = await this._findEmulatorPath();
            if (!emulatorPath) return [];

            const result = await this._execCommand(`"${emulatorPath}" -list-avds`);
            return result.stdout.split('\n').filter(l => l.trim());
        } catch {
            return [];
        }
    }

    /**
     * Restart ADB server
     */
    public async restartAdb(): Promise<boolean> {
        try {
            await this._execCommand(`"${this._adbPath}" kill-server`);
            await new Promise(r => setTimeout(r, 1000));
            await this._execCommand(`"${this._adbPath}" start-server`);
            return true;
        } catch (error) {
            console.error('[EmulatorManager] Error restarting ADB:', error);
            return false;
        }
    }

    /**
     * Get device screen info
     */
    public async getDeviceInfo(deviceId: string): Promise<{ model: string; os: string; api: string } | null> {
        try {
            const modelResult = await this._execCommand(
                `"${this._adbPath}" -s ${deviceId} shell getprop ro.product.model`
            );
            const osResult = await this._execCommand(
                `"${this._adbPath}" -s ${deviceId} shell getprop ro.build.version.release`
            );
            const apiResult = await this._execCommand(
                `"${this._adbPath}" -s ${deviceId} shell getprop ro.build.version.sdk`
            );

            return {
                model: modelResult.stdout.trim(),
                os: osResult.stdout.trim(),
                api: apiResult.stdout.trim()
            };
        } catch {
            return null;
        }
    }

    public getConnection(deviceId: string): MetroConnection | undefined {
        return this._metroConnections.get(deviceId);
    }

    public getAllConnections(): MetroConnection[] {
        return Array.from(this._metroConnections.values());
    }
}

// Singleton instance
export const emulatorManager = new EmulatorManager();