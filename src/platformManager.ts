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
            .device-frame {
                width: ${isDesktop ? '100%' : config.width + 'px'};
                height: ${isDesktop ? '100%' : config.height + 'px'};
                min-width: 320px;
                min-height: 400px;
                max-width: 100%;
                max-height: 100%;
                border-radius: ${config.borderRadius}px;
                background-color: ${isDesktop ? '#05100a' : config.frameColor};
                box-shadow: ${isDesktop ? 'none' : '0 20px 60px rgba(0, 0, 0, 0.4)'};
                position: relative;
                overflow: ${isDesktop ? 'auto' : 'hidden'};
                margin: ${isDesktop ? '0' : '20px auto'};
                resize: ${isDesktop ? 'both' : 'none'};
                border: ${isDesktop ? '2px solid #2a3a2e' : '4px solid ' + config.frameColor};
                display: flex;
                flex-direction: column;
                flex: 1;
                min-width: 0;
            }

            .device-screen {
                width: 100%;
                min-height: 100px;
                background-color: ${config.backgroundColor};
                border-radius: ${Math.max(0, config.borderRadius - 4)}px;
                position: relative;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                flex: 1;
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
                ${isDesktop ? 'flex: 1; min-height: 0; overflow: auto;' : `height: calc(100% - ${config.statusBarHeight + config.navigationBarHeight}px); overflow: auto;`}
                width: 100%;
                display: flex;
                flex-direction: column;
                background-color: ${this.getContentBackgroundColor(config.name)};
            }

            ${isDesktop ? `
            /* Windows resize handle - positioned in flex container */
            ` : ''}

            .platform-selector {
                display: flex;
                gap: 8px;
                margin: 0;
                flex-wrap: wrap;
                background: rgba(0,0,0,0.2);
                padding: 4px 8px;
                border-radius: 8px;
            }

            .platform-btn {
                padding: 6px 12px;
                border: 2px solid transparent;
                border-radius: 6px;
                background: rgba(255,255,255,0.1);
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 6px;
                color: #e2e8f0;
            }

            .platform-btn:hover {
                border-color: #007acc;
                background: rgba(0,122,204,0.3);
            }

            .platform-btn.active {
                border-color: #007acc;
                background: #007acc;
                color: white;
            }

            .device-wrapper {
                transition: transform 0.3s ease;
                transform-origin: center top;
                width: 100%;
                height: 100%;
                display: flex;
                flex: 1;
                flex-direction: column;
                flex: 1;
                min-height: 0;
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
                    <div class="nav-title">MAUI App</div>
                    <div class="nav-controls">
                        <button class="nav-btn">−</button>
                        <button class="nav-btn">□</button>
                        <button class="nav-btn">×</button>
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