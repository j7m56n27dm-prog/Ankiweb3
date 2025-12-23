// Main Application Entry Point

class AnkiApp {
    constructor() {
        this.ui = window.AnkiUI;
        this.engine = window.AnkiEngine;
        this.db = window.AnkiDB;
    }

    async init() {
        try {
            // Initialize UI
            await this.ui.init();
            
            // Check for PWA installation
            this.checkPWA();
            
            // Set up service worker
            this.setupServiceWorker();
            
            console.log('Anki PWA application initialized');
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.showFatalError('Failed to initialize application. Please refresh.');
        }
    }

    checkPWA() {
        // Check if app is running as PWA
        if (window.matchMedia('(display-mode: standalone)').matches) {
            console.log('Running as PWA');
            document.body.classList.add('pwa-mode');
        }
        
        // Check for iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            document.body.classList.add('ios');
            
            // iOS-specific fixes
            this.fixIOSIssues();
        }
    }

    fixIOSIssues() {
        // Fix for iOS viewport height
        const setVH = () => {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        };
        
        window.addEventListener('resize', setVH);
        window.addEventListener('orientationchange', setVH);
        setVH();
        
        // Fix for iOS input zoom
        document.addEventListener('focusin', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                // Prevent zoom by setting font size to 16px
                e.target.style.fontSize = '16px';
            }
        });
        
        document.addEventListener('focusout', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                // Restore font size
                e.target.style.fontSize = '';
            }
        });
    }

    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(registration => {
                console.log('Service Worker ready:', registration);
                
                // Check for updates
                registration.update();
                
                // Listen for updates
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    console.log('New service worker activated');
                    window.location.reload();
                });
            }).catch(error => {
                console.warn('Service Worker registration failed:', error);
            });
        }
    }

    showFatalError(message) {
        const appElement = document.getElementById('app');
        if (appElement) {
            appElement.innerHTML = `
                <div class="error-screen">
                    <h1>Anki PWA</h1>
                    <div class="error-message">
                        <i class="fas fa-exclamation-triangle fa-3x"></i>
                        <h2>Initialization Error</h2>
                        <p>${message}</p>
                        <button class="retry-btn" onclick="window.location.reload()">
                            <i class="fas fa-redo"></i>
                            Retry
                        </button>
                    </div>
                </div>
            `;
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new AnkiApp();
    window.app.init().catch(error => {
        console.error('App initialization failed:', error);
    });
});

// Make app available globally
window.addEventListener('load', () => {
    console.log('Anki PWA loaded');
});

// Handle beforeinstallprompt for PWA
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Show install button if not already installed
    if (!window.matchMedia('(display-mode: standalone)').matches) {
        // You could show an install button here
        console.log('PWA install available');
    }
});

// Handle app installed event
window.addEventListener('appinstalled', () => {
    console.log('PWA installed');
    deferredPrompt = null;
});
