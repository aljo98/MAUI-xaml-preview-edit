"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZoomManager = void 0;
// Zoom and viewport management functionality
class ZoomManager {
    constructor() {
        this.currentZoom = 100;
        this.zoomSteps = [25, 50, 75, 100, 125, 150, 200, 300, 400];
        this.zoomLevel = 1;
        console.log('[ZoomManager] Initialized');
    }
    getCurrentZoom() {
        return this.currentZoom;
    }
    setZoom(newZoom) {
        this.currentZoom = Math.max(25, Math.min(400, newZoom));
        this.zoomLevel = this.currentZoom / 100;
        console.log(`[ZoomManager] Zoom set to ${this.currentZoom}%`);
    }
    zoomIn() {
        const currentIndex = this.zoomSteps.indexOf(this.currentZoom);
        if (currentIndex < this.zoomSteps.length - 1) {
            this.setZoom(this.zoomSteps[currentIndex + 1]);
        }
    }
    zoomOut() {
        const currentIndex = this.zoomSteps.indexOf(this.currentZoom);
        if (currentIndex > 0) {
            this.setZoom(this.zoomSteps[currentIndex - 1]);
        }
    }
    zoomActualSize() {
        this.setZoom(100);
    }
    getZoomLevel() {
        return this.zoomLevel;
    }
    // Generate the JavaScript code that will be executed in the webview
    getWebviewZoomScript() {
        return `
            class WebViewZoomManager {
                constructor() {
                    this.currentZoom = ${this.currentZoom};
                    this.zoomLevel = ${this.zoomLevel};
                    this.setupEventListeners();
                }

                applyZoom() {
                    const deviceWrapper = document.querySelector('.device-wrapper');
                    if (deviceWrapper) {
                        deviceWrapper.style.transform = 'scale(' + this.zoomLevel + ')';
                    }
                }

                updateZoomDisplay() {
                    const zoomDisplay = document.getElementById('zoomLevel');
                    if (zoomDisplay) {
                        zoomDisplay.textContent = this.currentZoom + '%';
                    }
                }

                setZoom(newZoom) {
                    this.currentZoom = Math.max(25, Math.min(400, newZoom));
                    this.zoomLevel = this.currentZoom / 100;
                    this.applyZoom();
                    this.updateZoomDisplay();
                    console.log('[WebViewZoomManager] Zoom set to ' + this.currentZoom + '%');
                }

                fitToViewport() {
                    const viewport = document.querySelector('.preview-viewport');
                    const deviceWrapper = document.querySelector('.device-wrapper');
                    const deviceFrame = document.getElementById('deviceFrame');
                    
                    if (!viewport || !deviceWrapper || !deviceFrame) {
                        console.warn('[WebViewZoomManager] Elements not found for fit to viewport');
                        return;
                    }
                    
                    // Reset transform to get original size
                    deviceWrapper.style.transform = 'scale(1)';
                    
                    const deviceRect = deviceFrame.getBoundingClientRect();
                    const viewportRect = viewport.getBoundingClientRect();
                    
                    const scaleX = (viewportRect.width - 80) / deviceRect.width;
                    const scaleY = (viewportRect.height - 80) / deviceRect.height;
                    const scale = Math.min(scaleX, scaleY, 1);
                    
                    const zoomPercent = Math.round(scale * 100);
                    this.setZoom(zoomPercent);
                }

                setupEventListeners() {
                    document.addEventListener('DOMContentLoaded', () => {
                        const zoomInBtn = document.getElementById('zoomIn');
                        const zoomOutBtn = document.getElementById('zoomOut');
                        const zoomFitBtn = document.getElementById('zoomFit');
                        const zoomActualBtn = document.getElementById('zoomActual');

                        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
                        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
                        if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => this.fitToViewport());
                        if (zoomActualBtn) zoomActualBtn.addEventListener('click', () => this.zoomActualSize());

                        console.log('[WebViewZoomManager] Event listeners set up');
                    });
                }

                zoomIn() {
                    const zoomSteps = [25, 50, 75, 100, 125, 150, 200, 300, 400];
                    const currentIndex = zoomSteps.indexOf(this.currentZoom);
                    if (currentIndex < zoomSteps.length - 1) {
                        this.setZoom(zoomSteps[currentIndex + 1]);
                    }
                }

                zoomOut() {
                    const zoomSteps = [25, 50, 75, 100, 125, 150, 200, 300, 400];
                    const currentIndex = zoomSteps.indexOf(this.currentZoom);
                    if (currentIndex > 0) {
                        this.setZoom(zoomSteps[currentIndex - 1]);
                    }
                }

                zoomActualSize() {
                    this.setZoom(100);
                }
            }

            const webViewZoomManager = new WebViewZoomManager();
        `;
    }
}
exports.ZoomManager = ZoomManager;
//# sourceMappingURL=zoomManager.js.map