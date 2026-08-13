import * as vscode from 'vscode';

// Platform configurations for device simulation
export interface PlatformConfig {
  name: string;
  displayName: string;
  width: number;
  height: number;
  devicePixelRatio: number;
  userAgent: string;
  statusBarHeight: number;
  navigationBarHeight: number;
  borderRadius: number;
  backgroundColor: string;
  frameColor: string;
}

export class PlatformManager {
  private currentPlatform: string = 'Android';
  private platforms: Map<string, PlatformConfig> = new Map();

  constructor() {
    this.initializePlatforms();
    console.log('[PlatformManager] Initialized with platforms:', Array.from(this.platforms.keys()));
  }

  private initializePlatforms(): void {
    this.platforms.set('Android', {
      name: 'Android',
      displayName: 'Android Phone',
      width: 360,
      height: 640,
      devicePixelRatio: 3,
      userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36',
      statusBarHeight: 24,
      navigationBarHeight: 48,
      borderRadius: 20,
      backgroundColor: '#000000',
      frameColor: '#2c2c2c'
    });

    this.platforms.set('iOS', {
      name: 'iOS',
      displayName: 'iPhone',
      width: 375,
      height: 667,
      devicePixelRatio: 2,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
      statusBarHeight: 20,
      navigationBarHeight: 44,
      borderRadius: 25,
      backgroundColor: '#000000',
      frameColor: '#1c1c1e'
    });

    this.platforms.set('Windows', {
      name: 'Windows',
      displayName: 'Windows Desktop',
      width: 1200,
      height: 800,
      devicePixelRatio: 1,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      statusBarHeight: 0,
      navigationBarHeight: 0,
      borderRadius: 8,
      backgroundColor: '#05100a',
      frameColor: '#0a1912'
    });

    this.platforms.set('macOS', {
      name: 'macOS',
      displayName: 'macOS Desktop',
      width: 1200,
      height: 800,
      devicePixelRatio: 2,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      statusBarHeight: 0,
      navigationBarHeight: 0,
      borderRadius: 12,
      backgroundColor: '#05100a',
      frameColor: '#0a1912'
    });

    console.log('[PlatformManager] Initialized platforms:', Array.from(this.platforms.keys()));
  }

  public getCurrentPlatform(): string {
    return this.currentPlatform;
  }

  public setPlatform(platformName: string): boolean {
    if (this.platforms.has(platformName)) {
      this.currentPlatform = platformName;
      console.log(`[PlatformManager] Platform switched to: ${platformName}`);
      return true;
    }
    console.warn(`[PlatformManager] Unknown platform: ${platformName}`);
    return false;
  }

  public getCurrentConfig(): PlatformConfig {
    return this.platforms.get(this.currentPlatform) || this.platforms.get('Android')!;
  }

  public getAllPlatforms(): PlatformConfig[] {
    return Array.from(this.platforms.values());
  }

  public generatePlatformSelectorHtml(): string {
    const platforms = this.getAllPlatforms();
    let html = '<div class="platform-selector">';

    for (const platform of platforms) {
      const isActive = platform.name === this.currentPlatform;
      html += `
        <button class="platform-btn ${isActive ? 'active' : ''}" 
            data-platform="${platform.name}"
            title="${platform.displayName}">
          ${this.getPlatformIcon(platform.name)} ${platform.displayName}
        </button>
      `;
    }

    html += '</div>';
    return html;
  }

  private getPlatformIcon(platformName: string): string {
    switch (platformName) {
      case 'Android': return '🤖';
      case 'iOS': return '📱';
      case 'Windows': return '🪟';
      case 'macOS': return '🍎';
      default: return '📱';
    }
  }

  public generateDeviceFrameCss(): string {
    const config = this.getCurrentConfig();
    const isDesktop = config.name === 'Windows' || config.name === 'macOS';

    return `
            .device-wrapper {
                ${isDesktop ? 'width: 100%; height: 100%; display: flex; flex-direction: column;' : ''}
            }

            .device-frame {
                width: ${isDesktop ? '100%' : config.width + 'px'};
                height: ${isDesktop ? '100%' : config.height + 'px'};
                min-width: ${isDesktop ? '400px' : '320px'};
                min-height: ${isDesktop ? '300px' : '400px'};
                max-width: 100%;
                max-height: ${isDesktop ? '100%' : 'none'};
                border-radius: ${config.borderRadius}px;
                background-color: ${isDesktop ? config.backgroundColor : config.frameColor};
                box-shadow: ${isDesktop ? '0 0 0 1px #3e3e42' : '0 20px 60px rgba(0, 0, 0, 0.4)'};
                position: relative;
                overflow: hidden;
                margin: ${isDesktop ? '0' : '20px auto'};
                resize: ${isDesktop ? 'both' : 'none'};
                border: ${isDesktop ? '1px solid #3e3e42' : '4px solid ' + config.frameColor};
                ${isDesktop ? 'display: flex; flex-direction: column;' : ''}
            }

            .device-screen {
                width: 100%;
                ${isDesktop ? 'flex: 1; min-height: 0;' : 'height: 100%;'}
                background-color: ${config.backgroundColor};
                border-radius: ${Math.max(0, config.borderRadius - 4)}px;
                position: relative;
                overflow: ${isDesktop ? 'auto' : 'hidden'};
                ${isDesktop ? 'display: flex; flex-direction: column;' : ''}
            }

            .status-bar {
                height: ${config.statusBarHeight}px;
                background: linear-gradient(90deg, 
                    ${config.name === 'iOS' ? '#000' : '#212121'} 0%, 
                    ${config.name === 'iOS' ? '#000' : '#424242'} 100%);
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 12px;
                font-size: 12px;
                color: white;
            }

            .navigation-bar {
                height: ${config.navigationBarHeight}px;
                background: ${config.name === 'Windows' ? '#f0f0f0' : config.name === 'macOS' ? '#f5f5f7' : 'transparent'};
                border-bottom: ${config.name === 'Windows' || config.name === 'macOS' ? '1px solid #e0e0e0' : 'none'};
                display: flex;
                align-items: center;
                padding: 0 16px;
            }

            .content-area {
                ${isDesktop ? 'flex: 1; min-height: 0;' : `height: calc(100% - ${config.statusBarHeight + config.navigationBarHeight}px);`}
                width: 100%;
                overflow: ${isDesktop ? 'visible' : 'auto'};
                background-color: ${this.getContentBackgroundColor(config.name)};
            }

            ${isDesktop ? `
            .device-frame::after {
                content: '';
                position: absolute;
                bottom: 0;
                right: 0;
                width: 16px;
                height: 16px;
                background: linear-gradient(135deg, transparent 50%, #007acc 50%);
                cursor: nwse-resize;
                pointer-events: none;
            }
            ` : ''}

            .platform-selector {
                display: flex;
                gap: 8px;
                margin: 0;
                flex-wrap: wrap;
            }

            .platform-btn {
                padding: 6px 12px;
                border: 1px solid #3e3e42;
                border-radius: 6px;
                background: #2d2d30;
                color: #cccccc;
                cursor: pointer;
                transition: all 0.15s ease;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 5px;
                white-space: nowrap;
            }

            .platform-btn:hover {
                border-color: #007acc;
                background: #1e3a5f;
                color: #ffffff;
            }

            .platform-btn.active {
                border-color: #007acc;
                background: #007acc;
                color: #ffffff;
                font-weight: 600;
            }

        `;
  }

  private getContentBackgroundColor(platformName: string): string {
    switch (platformName) {
      case 'Android': return '#05100a';
      case 'iOS': return '#05100a';
      case 'Windows': return '#05100a';
      case 'macOS': return '#05100a';
      default: return '#05100a';
    }
  }

  public generateStatusBarContent(): string {
    const config = this.getCurrentConfig();

    if (config.statusBarHeight === 0) {
      return '';
    }

    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });

    switch (config.name) {
      case 'Android':
        return `
                    <div class="status-left">
                        <span>${time}</span>
                    </div>
                    <div class="status-right">
                        <span>📶 📱 🔋</span>
                    </div>
                `;
      case 'iOS':
        return `
                    <div class="status-left">
                        <span>${time}</span>
                    </div>
                    <div class="status-right">
                        <span>📶 📱 🔋</span>
                    </div>
                `;
      default:
        return '';
    }
  }

  public generateNavigationBarContent(): string {
    const config = this.getCurrentConfig();

    if (config.navigationBarHeight === 0) {
      return '';
    }

    switch (config.name) {
      case 'Windows':
        return `
                    <div style="display:flex;align-items:center;width:100%;padding:0 8px;height:32px;background:#1f1f1f;border-bottom:1px solid #333">
                        <span style="color:#888;font-size:11px;font-family:Segoe UI,sans-serif;flex:1">MAUI App</span>
                        <span style="color:#888;font-size:16px;padding:0 8px;cursor:default">─</span>
                        <span style="color:#888;font-size:13px;padding:0 8px;cursor:default">⬜</span>
                        <span style="color:#888;font-size:14px;padding:0 8px;cursor:default">✕</span>
                    </div>
                `;
      case 'macOS':
        return `
                    <div class="nav-controls-mac">
                        <div class="mac-btn mac-close"></div>
                        <div class="mac-btn mac-minimize"></div>
                        <div class="mac-btn mac-maximize"></div>
                    </div>
                    <div class="nav-title-mac">MAUI App</div>
                `;
      default:
        return '<div class="nav-title">MAUI App</div>';
    }
  }

  // Generate JavaScript for platform switching
  public generatePlatformSwitchScript(): string {
    return `
      function switchPlatform(platformName) {
        console.log('[PlatformManager] Switching to platform:', platformName);
        try {
          // Use the established window.vscode global variable set in the main script
          if (window.vscode && typeof window.vscode.postMessage === 'function') {
            window.vscode.postMessage({ command: 'switchPlatform', platform: platformName });
          } else {
            console.warn('[PlatformManager] window.vscode not available to post platform switch');
          }
        } catch (err) {
          console.warn('[PlatformManager] Error while posting platform switch', err);
        }
                document.querySelectorAll('.platform-btn').forEach(btn => btn.classList.remove('active'));
                const activeBtn = document.querySelector('[data-platform="' + platformName + '"]');
                if (activeBtn) activeBtn.classList.add('active');
            }

            window.switchPlatform = switchPlatform;

            function setupPlatformSwitching() {
                const platformButtons = document.querySelectorAll('.platform-btn');
                platformButtons.forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const platform = this.getAttribute('data-platform');
                        if (platform) switchPlatform(platform);
                    });
                });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupPlatformSwitching);
            } else {
                setupPlatformSwitching();
            }
        `;
  }
}