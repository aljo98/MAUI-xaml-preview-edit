"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformManager = void 0;
class PlatformManager {
    constructor() {
        this.currentPlatform = 'Android';
        this.platforms = new Map();
        this.initializePlatforms();
        console.log('[PlatformManager] Initialized with platforms:', Array.from(this.platforms.keys()));
    }
    initializePlatforms() {
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
            width: 800,
            height: 600,
            devicePixelRatio: 1,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            statusBarHeight: 0,
            navigationBarHeight: 32,
            borderRadius: 8,
            backgroundColor: '#f3f3f3',
            frameColor: '#e1e1e1'
        });
        this.platforms.set('macOS', {
            name: 'macOS',
            displayName: 'macOS Desktop',
            width: 800,
            height: 600,
            devicePixelRatio: 2,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            statusBarHeight: 0,
            navigationBarHeight: 28,
            borderRadius: 12,
            backgroundColor: '#f5f5f7',
            frameColor: '#d1d1d6'
        });
        console.log('[PlatformManager] Initialized platforms:', Array.from(this.platforms.keys()));
    }
    getCurrentPlatform() {
        return this.currentPlatform;
    }
    setPlatform(platformName) {
        if (this.platforms.has(platformName)) {
            this.currentPlatform = platformName;
            console.log(`[PlatformManager] Platform switched to: ${platformName}`);
            return true;
        }
        console.warn(`[PlatformManager] Unknown platform: ${platformName}`);
        return false;
    }
    getCurrentConfig() {
        return this.platforms.get(this.currentPlatform) || this.platforms.get('Android');
    }
    getAllPlatforms() {
        return Array.from(this.platforms.values());
    }
    generatePlatformSelectorHtml() {
        const platforms = this.getAllPlatforms();
        let html = '<div class="platform-selector">';
        for (const platform of platforms) {
            const isActive = platform.name === this.currentPlatform;
            html += `
        <button class="platform-btn ${isActive ? 'active' : ''}" 
            data-platform="${platform.name}"
            title="${platform.displayName}"
            onclick="switchPlatform('${platform.name}')">
          ${this.getPlatformIcon(platform.name)} ${platform.displayName}
        </button>
      `;
        }
        html += '</div>';
        return html;
    }
    getPlatformIcon(platformName) {
        switch (platformName) {
            case 'Android': return '🤖';
            case 'iOS': return '📱';
            case 'Windows': return '🪟';
            case 'macOS': return '🍎';
            default: return '📱';
        }
    }
    generateDeviceFrameCss() {
        const config = this.getCurrentConfig();
        return `
            .device-frame {
                width: ${config.width}px;
                height: ${config.height}px;
                border-radius: ${config.borderRadius}px;
                background-color: ${config.frameColor};
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                position: relative;
                overflow: hidden;
                margin: 20px auto;
            }

            .device-screen {
                width: 100%;
                height: 100%;
                background-color: ${config.backgroundColor};
                border-radius: ${Math.max(0, config.borderRadius - 4)}px;
                position: relative;
                overflow: hidden;
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
                height: calc(100% - ${config.statusBarHeight + config.navigationBarHeight}px);
                overflow: auto;
                background-color: ${this.getContentBackgroundColor(config.name)};
            }

            .platform-selector {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
                flex-wrap: wrap;
            }

            .platform-btn {
                padding: 8px 16px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                background: white;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .platform-btn:hover {
                border-color: #007acc;
                background: #f0f8ff;
            }

            .platform-btn.active {
                border-color: #007acc;
                background: #007acc;
                color: white;
            }

            .device-wrapper {
                transition: transform 0.3s ease;
                transform-origin: center top;
            }
        `;
    }
    getContentBackgroundColor(platformName) {
        switch (platformName) {
            case 'Android': return '#ffffff';
            case 'iOS': return '#f2f2f7';
            case 'Windows': return '#f9f9f9';
            case 'macOS': return '#ffffff';
            default: return '#ffffff';
        }
    }
    generateStatusBarContent() {
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
    generateNavigationBarContent() {
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
    generatePlatformSwitchScript() {
        return `
      function switchPlatform(platformName) {
                console.log('[PlatformManager] Switching to platform:', platformName);
                
                // Send message to VS Code extension
                if (typeof acquireVsCodeApi !== 'undefined') {
                    const vscode = acquireVsCodeApi();
                    vscode.postMessage({
                        command: 'switchPlatform',
                        platform: platformName
                    });
                } else {
                    console.warn('[PlatformManager] VS Code API not available');
                }
                
                // Update active button immediately for visual feedback
                document.querySelectorAll('.platform-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                
                const activeBtn = document.querySelector('[data-platform="' + platformName + '"]');
                if (activeBtn) {
                    activeBtn.classList.add('active');
                    console.log('[PlatformManager] Updated active button for:', platformName);
                } else {
                    console.warn('[PlatformManager] Button not found for platform:', platformName);
                }
            }

            // expose globally for inline handlers
            window.switchPlatform = switchPlatform;

            // Set up platform button event listeners
            function setupPlatformSwitching() {
                console.log('[PlatformManager] Setting up platform switching');
                
                const platformButtons = document.querySelectorAll('.platform-btn');
                console.log('[PlatformManager] Found platform buttons:', platformButtons.length);
                
                platformButtons.forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const platform = this.getAttribute('data-platform');
                        console.log('[PlatformManager] Platform button clicked:', platform);
                        
                        if (platform) {
                            switchPlatform(platform);
                        } else {
                            console.warn('[PlatformManager] No platform attribute found');
                        }
                    });
                });
            }

            // Initialize when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupPlatformSwitching);
            } else {
                setupPlatformSwitching();
            }

            // Also try to setup immediately in case DOMContentLoaded already fired
            setTimeout(setupPlatformSwitching, 100);
        `;
    }
}
exports.PlatformManager = PlatformManager;
//# sourceMappingURL=platformManager.js.map