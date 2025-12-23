const CACHE_NAME = 'anki-desktop-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/css/macos-ui.css',
    '/css/anki-styles.css',
    '/css/dark-mode.css',
    '/js/anki-core.js',
    '/js/anki-db.js',
    '/js/anki-scheduler.js',
    '/js/anki-app.js',
    '/manifest.webmanifest'
];

// Install
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => 
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip API calls
    if (event.request.url.includes('/api/')) return;
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                
                return fetch(event.request)
                    .then(response => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, responseToCache));
                        
                        return response;
                    })
                    .catch(() => {
                        if (event.request.destination === 'document') {
                            return caches.match('/');
                        }
                    });
            })
    );
});

// Background sync for future sync feature
self.addEventListener('sync', event => {
    if (event.tag === 'anki-sync') {
        event.waitUntil(syncData());
    }
});

async function syncData() {
    // Future sync implementation
    console.log('Background sync triggered');
}
