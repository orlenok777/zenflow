const CACHE_VERSION = 'zenflow-v1';
const STATIC_ASSETS_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;

// Static assets to cache on install (relative to SW scope)
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg'
];

// External CDN resources to cache
const CDN_RESOURCES = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Marcellus&family=Quicksand:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm'
];

// Install event: cache static assets and CDN resources
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing ZenFlow SW...');

  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_ASSETS_CACHE).then((cache) => {
        console.log('[ServiceWorker] Caching static assets');
        return cache.addAll(STATIC_ASSETS).catch((err) => {
          console.warn('[ServiceWorker] Some static assets failed to cache:', err);
          return Promise.resolve();
        });
      }),

      // Cache CDN resources
      caches.open(CDN_CACHE).then((cache) => {
        console.log('[ServiceWorker] Caching CDN resources');
        return Promise.all(
          CDN_RESOURCES.map((url) =>
            fetch(url, { credentials: 'omit' })
              .then((response) => {
                if (response.ok) {
                  return cache.put(url, response);
                }
                console.warn('[ServiceWorker] Failed to cache: ' + url, response.status);
              })
              .catch((err) => {
                console.warn('[ServiceWorker] Failed to fetch CDN resource: ' + url, err);
              })
          )
        );
      })
    ]).then(() => {
      console.log('[ServiceWorker] Installation complete');
      self.skipWaiting();
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating ZenFlow SW...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            !cacheName.startsWith(CACHE_VERSION) &&
            (cacheName.startsWith('zenflow-') || cacheName === 'default-cache')
          ) {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[ServiceWorker] Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event: implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') { return; }

  if (
    url.hostname === 'generativelanguage.googleapis.com' ||
    url.pathname.includes('/api/') ||
    url.hostname.includes('api.')
  ) {
    event.respondWith(networkFirstStrategy(request, API_CACHE));
    return;
  }

  if (
    url.hostname === 'cdn.tailwindcss.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirstStrategy(request, CDN_CACHE));
    return;
  }

  if (url.origin === location.origin) {
    if (
      request.destination === 'image' ||
      request.destination === 'font' ||
      request.destination === 'style' ||
      request.destination === 'script' ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.webp')
    ) {
      event.respondWith(cacheFirstStrategy(request, STATIC_ASSETS_CACHE));
      return;
    }

    if (
      request.destination === 'document' ||
      url.pathname.endsWith('manifest.json')
    ) {
      event.respondWith(networkFirstStrategy(request, STATIC_ASSETS_CACHE));
      return;
    }
  }

  event.respondWith(networkFirstStrategy(request, STATIC_ASSETS_CACHE));
});

/**
 * Network-first strategy: try network, fallback to cache
 */
function networkFirstStrategy(request, cacheName) {
  return fetch(request)
    .then((response) => {
      if (!response || response.status !== 200 || response.type === 'error') {
        return response;
      }
      const responseClone = response.clone();
      caches.open(cacheName).then((cache) => {
        cache.put(request, responseClone);
      });
      return response;
    })
    .catch((error) => {
      console.warn('[ServiceWorker] Network request failed, checking cache:', error);
      return caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          console.log('[ServiceWorker] Returning cached response for:', request.url);
          return cachedResponse;
        }
        if (request.destination === 'document') {
          return caches.match('./index.html').then((indexResponse) => {
            if (indexResponse) { return indexResponse; }
            return new Response(
              '<h1>Offline</h1><p>ZenFlow is currently offline. Please check your connection.</p>',
              { status: 503, statusText: 'Service Unavailable', headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }) }
            );
          });
        }
        return new Response('Service unavailable - offline', { status: 503, statusText: 'Service Unavailable' });
      });
    });
}

/**
 * Cache-first strategy: check cache first, fallback to network
 */
function cacheFirstStrategy(request, cacheName) {
  return caches.match(request).then((cachedResponse) => {
    if (cachedResponse) {
      console.log('[ServiceWorker] Cache hit for:', request.url);
      return cachedResponse;
    }
    console.log('[ServiceWorker] Cache miss, fetching:', request.url);
    return fetch(request)
      .then((response) => {
        if (!response || response.status !== 200) { return response; }
        const responseClone = response.clone();
        caches.open(cacheName).then((cache) => {
          cache.put(request, responseClone);
        });
        return response;
      })
      .catch((error) => {
        console.warn('[ServiceWorker] Failed to fetch:', request.url, error);
        if (request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#e5e7eb" width="100" height="100"/></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }
        throw error;
      });
  });
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[ServiceWorker] Received SKIP_WAITING message');
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('[ServiceWorker] Clearing all caches');
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      event.ports[0].postMessage({ success: true, message: 'Caches cleared' });
    }).catch((err) => {
      event.ports[0].postMessage({ success: false, error: err.message });
    });
  }
});

// Periodic sync (if supported)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'zenflow-wellness-check') {
      event.waitUntil(
        (async () => {
          try {
            console.log('[ServiceWorker] Running periodic wellness check');
            const clients = await self.clients.matchAll();
            clients.forEach((client) => {
              client.postMessage({
                type: 'WELLNESS_CHECK',
                timestamp: new Date().toISOString()
              });
            });
          } catch (error) {
            console.error('[ServiceWorker] Periodic sync error:', error);
          }
        })()
      );
    }
  });
}

// Handle push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'ZenFlow wellness reminder',
      icon: './icons/icon-192.svg',
      badge: './icons/icon-192.svg',
      tag: 'zenflow-notification',
      requireInteraction: false,
      actions: [
        { action: 'open', title: 'Open ZenFlow', icon: './icons/icon-192.svg' },
        { action: 'close', title: 'Dismiss', icon: './icons/icon-192.svg' }
      ]
    };
    event.waitUntil(
      self.registration.showNotification(data.title || 'ZenFlow', options)
    );
  } catch (error) {
    console.error('[ServiceWorker] Push notification error:', error);
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (let client of clientList) {
          if (client.url.includes('./') && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
    );
  }
});

// Handle notification dismissal
self.addEventListener('notificationclose', (event) => {
  console.log('[ServiceWorker] Notification dismissed:', event.notification.tag);
});

console.log('[ServiceWorker] ZenFlow Service Worker loaded');
