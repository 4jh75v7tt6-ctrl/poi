/* POI 0.3.0 — offline shell. Personal files and conversations never enter this cache. */
'use strict';

const VERSION = 'poi-v1.3.3';
const BASE = new URL('./', self.registration.scope);
const PREFIX = 'poi:' + encodeURIComponent(BASE.pathname) + ':';
const META_CACHE = PREFIX + 'metadata';
// Vendor files are identical to 0.2.0. Keep their existing cache on upgrade;
// change this revision only when the shipped document dependencies change.
const DOCUMENT_MODULE_REVISION = 'poi-v1.1.2';
const OPTIONAL_CACHE = PREFIX + DOCUMENT_MODULE_REVISION + ':document-modules';
// The optional generator has an independent revision. Model weights are kept
// by Wllama in OPFS and are never intercepted or downloaded by this worker.
const GENERATION_RUNTIME_REVISION = 'wllama-v2.3.7';
const GENERATION_RUNTIME_CACHE = PREFIX + GENERATION_RUNTIME_REVISION + ':generation-runtime';
const POINTER = new URL('__poi_shell_' + VERSION, BASE).href;
const INDEX_URL = new URL('index.html', BASE).href;
const ASSETS = [
  ['index.html', 'html'],
  ['work-training.html', 'html'],
  ['work-language.js', 'js'],
  ['poi-icloud.js', 'js'],
  ['work-manifest.webmanifest', 'manifest'],
  ['styles.css', 'css'],
  ['app.js', 'js'],
  ['documents.js', 'js'],
  ['generation-context.js', 'js'],
  ['generator.js', 'js'],
  ['engine.js', 'js'],
  ['exporter.js', 'js'],
  ['manifest.webmanifest', 'manifest'],
  ['icon.svg', 'svg'],
  ['apple-touch-icon.png', 'png'],
  ['guide.html', 'html'],
  ['LICENSE.txt', 'text']
].map(([path, kind]) => ({ path, kind, url: new URL(path, BASE).href }));
const ASSET_BY_URL = new Map(ASSETS.map(asset => [asset.url, asset]));
// BEGIN DOCUMENT ASSETS — generated from the shipped vendor inventory.
const DOCUMENT_PATHS = [
  "vendor/jszip/jszip.min.js",
  "vendor/ocr/fra.traineddata",
  "vendor/ocr/tesseract-core-lstm.wasm.js",
  "vendor/ocr/tesseract.min.js",
  "vendor/ocr/worker.min.js",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs",
  "vendor/pdfjs/resources.zip",
  "vendor/pdfjs/wasm/jbig2.wasm",
  "vendor/pdfjs/wasm/openjpeg.wasm",
  "vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js",
  "vendor/pdfjs/wasm/qcms_bg.wasm"
];
// END DOCUMENT ASSETS
const OPTIONAL_ASSETS = DOCUMENT_PATHS.map(path => ({path,
  kind:/\.(?:m?js)$/.test(path) ? 'js' : /\.(?:txt|md)$/.test(path) ? 'text' : /\.json$/.test(path) ? 'json' : 'binary',
  url:new URL(path, BASE).href}));
const OPTIONAL_BY_URL = new Map(OPTIONAL_ASSETS.map(asset => [asset.url, asset]));
const GENERATION_RUNTIME_ASSETS = [
  {path:'vendor/wllama/index.js', kind:'js'},
  {path:'vendor/wllama/wllama.wasm', kind:'binary'}
].map(asset => ({...asset, url:new URL(asset.path, BASE).href}));
const GENERATION_RUNTIME_BY_URL = new Map(GENERATION_RUNTIME_ASSETS.map(asset => [asset.url, asset]));
const HTML_CANONICAL = new Map([
  [INDEX_URL, BASE.href],
  [new URL('work-training.html', BASE).href, new URL('work-training', BASE).href],
  [new URL('guide.html', BASE).href, new URL('guide', BASE).href]
]);
// Both explicit filenames and the host's canonical HTML routes share one cache.
HTML_CANONICAL.forEach((canonical, original) => {
  ASSET_BY_URL.set(canonical, ASSET_BY_URL.get(original));
});
let committedNamePromise;

function appMarker(html) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  return metas.some(tag => /\bname\s*=\s*["']poi-app["']/i.test(tag) &&
    /\bcontent\s*=\s*["']local-v1["']/i.test(tag));
}

function canonicalTarget(asset, requestedURL) {
  if (asset.kind !== 'html' || !HTML_CANONICAL.has(asset.url)) return null;
  const requested = new URL(requestedURL);
  if (requested.origin !== BASE.origin || requested.pathname !== new URL(asset.url).pathname) return null;
  const canonical = new URL(HTML_CANONICAL.get(asset.url));
  canonical.search = requested.search;
  return canonical.href;
}

async function validResponse(response, asset, expectedURL) {
  if (!response || response.status !== 200 ||
      response.type === 'opaque' || response.type === 'opaqueredirect') return false;
  const canonical = canonicalTarget(asset, expectedURL);
  if (response.redirected && (!canonical || !response.url || response.url !== canonical)) return false;
  if (response.url) {
    const finalURL = new URL(response.url);
    if (finalURL.origin !== BASE.origin ||
        finalURL.href !== (response.redirected ? canonical : expectedURL)) return false;
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const allowed = {
    html: ['text/html'],
    css: ['text/css'],
    js: ['text/javascript', 'application/javascript', 'application/x-javascript'],
    manifest: ['application/manifest+json', 'application/json'],
    svg: ['image/svg+xml'],
    png: ['image/png'],
    text: ['text/plain', 'text/markdown'],
    json: ['application/json', 'text/json'],
    binary: ['application/octet-stream', 'binary/octet-stream', 'application/wasm', 'application/zip', 'application/x-zip-compressed', 'application/gzip', 'font/otf', 'font/ttf', 'application/x-font-ttf', 'application/vnd.ms-opentype']
  };
  if (!allowed[asset.kind].includes(mime)) return false;
  if (asset.kind === 'html') return appMarker(await response.clone().text());
  if (asset.kind === 'binary') {
    const data = new Uint8Array(await response.clone().arrayBuffer());
    if (!data.length) return false;
    const opening = String.fromCharCode(...data.subarray(0, 128));
    if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<form\b)/i.test(opening)) return false;
  }
  if (['js', 'css', 'manifest', 'text', 'json'].includes(asset.kind)) {
    const body = await response.clone().text();
    if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<form\b)/i.test(body)) return false;
    if (asset.kind === 'manifest') {
      try {
        const manifest = JSON.parse(body);
        const expectedStart = asset.path === 'work-manifest.webmanifest' ? './work-training.html' : './';
        if (!manifest.name || manifest.start_url !== expectedStart) return false;
      } catch (_) { return false; }
    }
  }
  return true;
}

async function fetchValidated(request, asset, timeout) {
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
  const expectedURL = typeof request === 'string' ? request : request.url;
  try {
    const response = await fetch(request, {
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: canonicalTarget(asset, expectedURL) ? 'follow' : 'error',
      cache: 'no-cache',
      signal: controller.signal
    });
    if (!(await validResponse(response, asset, expectedURL))) {
      throw new Error('Invalid POI asset: ' + asset.path);
    }
    // Cache a normal response after a verified canonical redirect. Replaying a
    // redirected response can fail when a later navigation disallows redirects.
    if (response.redirected) {
      return new Response(await response.blob(), {
        status: 200, statusText: 'OK', headers: response.headers
      });
    }
    return response;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function committedCacheName() {
  if (!committedNamePromise) {
    committedNamePromise = (async () => {
      const metadata = await caches.open(META_CACHE);
      const saved = await metadata.match(POINTER);
      if (!saved) return null;
      const record = await saved.json();
      if (record.version !== VERSION || typeof record.name !== 'string' ||
          !record.name.startsWith(PREFIX + VERSION + ':')) return null;
      return record.name;
    })().catch(() => null);
  }
  return committedNamePromise;
}

async function currentCache() {
  const name = await committedCacheName();
  return name ? caches.open(name) : null;
}

async function offlineStatus() {
  const cache = await currentCache();
  const missing = [];
  let shellAvailable = false;
  for (const asset of ASSETS) {
    const response = cache ? await cache.match(asset.url) : null;
    const valid = response && await validResponse(response, asset, asset.url);
    if (!valid) missing.push(asset.path);
    if (asset.url === INDEX_URL) shellAvailable = Boolean(valid);
  }
  return {
    type: 'OFFLINE_STATUS', version: VERSION,
    complete: missing.length === 0, shellAvailable, missing,
    documentModules: await documentModuleStatus(),
    generationRuntime: await generationRuntimeStatus()
  };
}

async function documentModuleStatus() {
  const names = await caches.keys();
  const cache = names.includes(OPTIONAL_CACHE) ? await caches.open(OPTIONAL_CACHE) : null;
  const cached = cache ? await Promise.all(OPTIONAL_ASSETS.map(asset => cache.match(asset.url))) : [];
  const count = cached.filter(Boolean).length;
  return {cachedFiles:count,totalFiles:OPTIONAL_ASSETS.length,complete:count === OPTIONAL_ASSETS.length,
    note:'Modules téléchargés à la demande. Les textes déjà extraits restent dans votre sauvegarde locale.'};
}

async function generationRuntimeStatus() {
  const names = await caches.keys();
  const cache = names.includes(GENERATION_RUNTIME_CACHE) ? await caches.open(GENERATION_RUNTIME_CACHE) : null;
  const cached = cache ? await Promise.all(GENERATION_RUNTIME_ASSETS.map(asset => cache.match(asset.url))) : [];
  const count = cached.filter(Boolean).length;
  return {revision:GENERATION_RUNTIME_REVISION,cachedFiles:count,totalFiles:GENERATION_RUNTIME_ASSETS.length,complete:count === GENERATION_RUNTIME_ASSETS.length,
    modelWeightsIncluded:false,note:'Moteur téléchargé lors de sa préparation. Les poids du modèle sont gérés séparément dans le stockage local OPFS.'};
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch and inspect every file before publishing a cache. A login page, missing
    // icon or wrong MIME type must never turn an incomplete shell into "ready".
    const loaded = await Promise.all(ASSETS.map(async asset => ({
      asset, response: await fetchValidated(asset.url, asset, 15000)
    })));
    const candidate = PREFIX + VERSION + ':' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try {
      const cache = await caches.open(candidate);
      await Promise.all(loaded.map(({ asset, response }) => cache.put(asset.url, response)));
      const stored = await Promise.all(ASSETS.map(asset => cache.match(asset.url)));
      if (stored.some(response => !response)) throw new Error('Incomplete POI shell');
      const metadata = await caches.open(META_CACHE);
      // Publishing this single pointer commits the fully validated candidate.
      // A failed installation leaves any previously committed cache untouched.
      await metadata.put(POINTER, new Response(JSON.stringify({ version: VERSION, name: candidate }), {
        headers: { 'content-type': 'application/json' }
      }));
      committedNamePromise = Promise.resolve(candidate);
    } catch (error) {
      await caches.delete(candidate);
      throw error;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = await committedCacheName();
    if (keep) {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith(PREFIX) &&
        name !== META_CACHE && name !== keep && name !== OPTIONAL_CACHE && name !== GENERATION_RUNTIME_CACHE).map(name => caches.delete(name)));
    }
    await self.clients.claim();
  })());
});

async function navigationResponse(request) {
  const url = new URL(request.url);
  const cleanURL = new URL(url.pathname, BASE.origin).href;
  const requestedAsset = ASSET_BY_URL.get(cleanURL);
  const isIndex = cleanURL === INDEX_URL || url.pathname === BASE.pathname;
  const htmlAsset = requestedAsset && requestedAsset.kind === 'html' ? requestedAsset : ASSETS[0];
  try {
    const response = await fetchValidated(request, htmlAsset, 3000);
    const cache = await currentCache();
    // Only the real app route may refresh index.html; guide and other pages
    // must never replace the launch screen. The marker was checked above.
    if (cache && (isIndex || requestedAsset && requestedAsset.kind === 'html')) {
      const cacheKey = isIndex ? INDEX_URL : requestedAsset.url;
      // Store a response with the canonical asset URL. Navigation responses
      // can have a query string or the directory URL; preserve body/headers.
      await cache.put(cacheKey, new Response(await response.clone().blob(), {
        status: 200, statusText: 'OK', headers: response.headers
      }));
    }
    return response;
  } catch (_) {
    const cache = await currentCache();
    if (cache) {
      const preferred = requestedAsset && requestedAsset.kind === 'html' ? requestedAsset.url : INDEX_URL;
      const saved = await cache.match(preferred) || await cache.match(INDEX_URL);
      if (saved) return saved;
    }
    return new Response('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>POI · Connexion nécessaire</title><body style="font:17px system-ui;line-height:1.6;padding:28px;max-width:36rem;margin:auto"><h1>POI n’est pas encore prête hors ligne.</h1><p>Reconnectez cet appareil à Internet, ouvrez POI et attendez la confirmation que les fichiers hors ligne sont prêts.</p><button onclick="location.reload()" style="font:inherit;padding:12px 20px">Réessayer</button></body></html>', {
      status: 503, headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }
}

async function assetResponse(request, asset) {
  const cache = await currentCache();
  const saved = cache && await cache.match(asset.url);
  if (saved) return saved;
  const response = await fetchValidated(request, asset, 10000);
  if (cache) {
    await cache.put(asset.url, new Response(await response.clone().blob(), {
      status: 200, statusText: 'OK', headers: response.headers
    }));
  }
  return response;
}

async function documentAssetResponse(request, asset, cacheName = OPTIONAL_CACHE) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(asset.url);
  if (saved) return saved;
  const response = await fetchValidated(request, asset, 30000);
  // A full browser cache must not prevent a connected document from opening.
  try { await cache.put(asset.url, response.clone()); } catch (_) { /* Optional cache. */ }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (request.mode === 'navigate') {
    const requested = ASSET_BY_URL.get(new URL(url.pathname, BASE.origin).href);
    if (url.pathname === BASE.pathname || (requested && requested.kind === 'html')) {
      event.respondWith(navigationResponse(request));
    }
    return;
  }
  const asset = ASSET_BY_URL.get(new URL(url.pathname, BASE.origin).href);
  if (asset) event.respondWith(assetResponse(request, asset));
  else {
    const optional = OPTIONAL_BY_URL.get(new URL(url.pathname, BASE.origin).href);
    if (optional) event.respondWith(documentAssetResponse(request, optional));
    else {
      const runtime = GENERATION_RUNTIME_BY_URL.get(new URL(url.pathname, BASE.origin).href);
      if (runtime) event.respondWith(documentAssetResponse(request, runtime, GENERATION_RUNTIME_CACHE));
    }
  }
});

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'GET_OFFLINE_STATUS') return;
  event.waitUntil((async () => {
    let result;
    try { result = await offlineStatus(); }
    catch (_) {
      result = { type: 'OFFLINE_STATUS', version: VERSION, complete: false,
        shellAvailable: false, missing: ASSETS.map(asset => asset.path), error: 'cache_unavailable' };
    }
    if (event.data.requestId !== undefined) result.requestId = event.data.requestId;
    if (event.ports && event.ports[0]) event.ports[0].postMessage(result);
    else if (event.source) event.source.postMessage(result);
  })());
});
