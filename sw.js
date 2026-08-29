/*
 * A4 Manual Offline Service Worker
 * Keep this file intentionally stable: normal app usage is cache-only.
 * Network refresh happens only when the user sends MANUAL_REFRESH.
 */
const CACHE_NAME = 'a4-manual-offline-v1';
const STAGING_NAME = 'a4-manual-offline-stage-v1';

const CORE_URLS = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './assets/frame-assets.js'
];

const OPTIONAL_URLS = [
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2'
];

function absoluteUrl(url) {
  return new URL(url, self.registration.scope).href;
}

function requestFor(url, reload=false) {
  const absolute = absoluteUrl(url);
  const crossOrigin = new URL(absolute).origin !== self.location.origin;
  return new Request(absolute, {
    method: 'GET',
    cache: reload ? 'reload' : 'default',
    credentials: crossOrigin ? 'omit' : 'same-origin',
    mode: crossOrigin ? 'no-cors' : 'same-origin'
  });
}

async function stageFreshVersion() {
  await caches.delete(STAGING_NAME);
  const stage = await caches.open(STAGING_NAME);

  for (const url of CORE_URLS) {
    const req = requestFor(url, true);
    const res = await fetch(req);
    if (!res || (!res.ok && res.type !== 'opaque')) {
      throw new Error(`Required update file failed: ${url}`);
    }
    await stage.put(requestFor(url), res.clone());
  }

  for (const url of OPTIONAL_URLS) {
    try {
      const req = requestFor(url, true);
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        await stage.put(requestFor(url), res.clone());
      }
    } catch (err) {
      console.warn('[A4 SW] Optional asset unavailable:', url, err);
    }
  }
  return stage;
}

async function commitStagedVersion() {
  const stage = await caches.open(STAGING_NAME);
  const keys = await stage.keys();
  const live = await caches.open(CACHE_NAME);
  await Promise.all(keys.map(async req => {
    const res = await stage.match(req, { ignoreSearch: true, ignoreVary: true });
    if (res) await live.put(req, res);
  }));
  await caches.delete(STAGING_NAME);
}

async function refreshAtomically() {
  await stageFreshVersion();
  await commitStagedVersion();
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await refreshAtomically();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name !== CACHE_NAME && name !== STAGING_NAME && name.startsWith('a4-manual-offline-'))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    let cached = await cache.match(event.request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;

    if (event.request.mode === 'navigate') {
      cached = await cache.match(requestFor('./index.html'), { ignoreSearch: true, ignoreVary: true });
      if (cached) return cached;
    }

    // Deliberately no network fallback during normal operation.
    return new Response('A4 排版目前以離線鎖定模式運作；此資源未在本機快取。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'MANUAL_REFRESH') return;
  event.waitUntil((async () => {
    try {
      await refreshAtomically();
      event.ports?.[0]?.postMessage({ ok: true });
    } catch (err) {
      console.error('[A4 SW] Manual refresh failed:', err);
      await caches.delete(STAGING_NAME);
      event.ports?.[0]?.postMessage({ ok: false, error: String(err?.message || err) });
    }
  })());
});
