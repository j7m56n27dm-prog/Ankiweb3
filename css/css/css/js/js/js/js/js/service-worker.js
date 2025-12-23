// Service Worker for Anki PWA

const CACHE_NAME = 'anki-pwa-v3';
const ASSETS = [
    '/',
    '/index.html',
    '/css/macos-anki.css',
    '/css/ios-optimized.css',
    '/css/dark-mode.css',
    '/js/database.js',
    '/js/scheduler.js',
    '/js/anki-engine.js',
    '/js/ui-controller.js',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Install event
self.addEventListener('install', (event) => {
    console.log('Service Worker installing');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching app shell');
                return cache.addAll(ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip chrome-extension requests
    if (event.request.url.startsWith('chrome-extension://')) return;
    
    // Skip API calls (if we had any)
    if (event.request.url.includes('/api/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Return cached response if found
                if (response) {
                    return response;
                }
                
                // Otherwise fetch from network
                return fetch(event.request)
                    .then((response) => {
                        // Don't cache if not a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        
                        // Clone the response
                        const responseToCache = response.clone();
                        
                        // Cache the new response
                        caches.open(CACHE_NAME)
                            .then((cache) => {
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

// Background sync for future sync feature
self.addEventListener('sync', (event) => {
    if (event.tag === 'anki-sync') {
        console.log('Background sync triggered');
        event.waitUntil(syncData());
    }
});

async function syncData() {
    // Implement sync logic here
    console.log('Syncing data...');
}

// Push notifications for review reminders
self.addEventListener('push', (event) => {
    if (!event.data) return;
    
    const data = event.data.json();
    
    const options = {
        body: data.body || 'Time to review your cards!',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
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

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'review') {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then((windowClients) => {
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

// Message handling
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
