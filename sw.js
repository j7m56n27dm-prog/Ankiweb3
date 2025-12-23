const CACHE_NAME = 'anki-desktop-ios-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/css/anki-ui.css',
    '/css/macos-window.css',
    '/css/ios-optimized.css',
    '/js/app.js',
    '/manifest.webmanifest'
];

// Install Service Worker
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Caching app shell');
                return cache.addAll(ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate Service Worker
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Strategy: Cache First, then Network
self.addEventListener('fetch', event => {
    // Skip non-GET requests and chrome-extension requests
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
        return;
    }
    
    // Skip API calls (if any)
    if (event.request.url.includes('/api/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                
                return fetch(event.request)
                    .then(response => {
                        // Don't cache if not a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        
                        return response;
                    })
                    .catch(() => {
                        // If offline and request is for a page, return the cached index.html
                        if (event.request.mode === 'navigate') {
                            return caches.match('/');
                        }
                        
                        // Return offline placeholder for images
                        if (event.request.destination === 'image') {
                            return new Response(
                                '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1e1e1e"/><text x="100" y="100" font-family="Arial" font-size="14" fill="#666" text-anchor="middle">No Image</text></svg>',
                                { headers: { 'Content-Type': 'image/svg+xml' } }
                            );
                        }
                    });
            })
    );
});

// Background Sync (for future sync feature)
self.addEventListener('sync', event => {
    if (event.tag === 'anki-sync') {
        event.waitUntil(syncData());
    }
});

async function syncData() {
    console.log('Background sync triggered');
    // Implement sync logic here
}

// Push Notifications (for future review reminders)
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'Time to review your cards!',
        icon: '/assets/icons/anki-icon-192.png',
        badge: '/assets/icons/anki-icon-192.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 'anki-review'
        },
        actions: [
            {
                action: 'review',
                title: 'Review Now'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('Anki Review', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'review') {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(windowClients => {
                if (windowClients.length > 0) {
                    windowClients[0].focus();
                    windowClients[0].postMessage({ action: 'startReview' });
                } else {
                    clients.openWindow('/');
                }
            })
        );
    }
});
