/**
 * BREAD service worker.
 * Powers Scramjet proxy routes and enforces device-key access control.
 */
const BREAD_SW_VERSION = '2026-02-06-6';

// Scramjet runtime (order matters: codecs -> config -> bundle -> worker).
importScripts(`/scramjet/scramjet.codecs.js?v=${BREAD_SW_VERSION}`);
importScripts(`/scramjet.config.js?v=${BREAD_SW_VERSION}`);
importScripts(`/scramjet/scramjet.bundle.js?v=${BREAD_SW_VERSION}`);
importScripts(`/scramjet/scramjet.worker.js?v=${BREAD_SW_VERSION}`);

// Ultraviolet runtime (order matters: bundle -> config -> sw).
try {
  importScripts(`/uv/uv.bundle.js?v=${BREAD_SW_VERSION}`);
  importScripts(`/uv/uv.config.js?v=${BREAD_SW_VERSION}`);
  importScripts(`/uv/uv.sw.js?v=${BREAD_SW_VERSION}`);
} catch (e) {
  self.__uvImportError = e;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const scramjet = new ScramjetServiceWorker(self.__scramjet$config);
const ultraviolet = self.UVServiceWorker && self.__uv$config ? new UVServiceWorker(self.__uv$config) : null;

let allowedCache = { value: false, expiresAt: 0 };
let deviceIdHint = null;
let bareMuxChannel = null;
let breadCookieDbPromise = null;

function openBreadCookieDb() {
  if (breadCookieDbPromise) return breadCookieDbPromise;
  if (typeof indexedDB === 'undefined') {
    breadCookieDbPromise = Promise.resolve(null);
    return breadCookieDbPromise;
  }
  breadCookieDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('bread-cookie', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cookies')) {
          const store = db.createObjectStore('cookies', { keyPath: 'id' });
          store.createIndex('path', 'path');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return breadCookieDbPromise;
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const str = String(value);
  const out = [];
  let start = 0;
  let inExpires = false;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (inExpires) {
      if (ch === ';') inExpires = false;
      continue;
    }
    if (str.slice(i, i + 8).toLowerCase() === 'expires=') {
      inExpires = true;
      i += 7;
      continue;
    }
    if (ch === ',') {
      const part = str.slice(start, i).trim();
      if (part) out.push(part);
      start = i + 1;
    }
  }
  const last = str.slice(start).trim();
  if (last) out.push(last);
  return out.filter(Boolean);
}

function parseSetCookie(value) {
  if (!value) return null;
  const parts = String(value)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const nameValue = parts.shift();
  const eq = nameValue.indexOf('=');
  if (eq < 0) return null;
  const cookie = {
    name: nameValue.slice(0, eq).trim(),
    value: nameValue.slice(eq + 1),
  };
  for (const attr of parts) {
    const [rawKey, ...rest] = attr.split('=');
    const key = String(rawKey || '').toLowerCase();
    const val = rest.length ? rest.join('=') : '';
    if (key === 'domain') cookie.domain = val.toLowerCase();
    else if (key === 'path') cookie.path = val || '/';
    else if (key === 'expires') cookie.expiresAt = Date.parse(val) || null;
    else if (key === 'max-age') {
      const n = Number.parseInt(val, 10);
      cookie.maxAge = Number.isFinite(n) ? n : null;
    } else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite') cookie.sameSite = val;
  }
  return cookie;
}

function normalizeCookie(cookie, url, forceDot) {
  const out = { ...cookie };
  if (!out.domain) out.domain = url.hostname;
  if (forceDot && !out.domain.startsWith('.')) out.domain = '.' + out.domain;
  if (!out.path) out.path = '/';
  out.id = `${out.domain}@${out.path}@${out.name}`;
  out.setAt = Date.now();
  return out;
}

function isCookieExpired(cookie, now) {
  if (!cookie) return true;
  if (cookie.maxAge != null) return cookie.setAt + cookie.maxAge * 1000 < now;
  if (cookie.expiresAt != null) return cookie.expiresAt < now;
  return false;
}

function validateCookie(cookie, url, js) {
  if (!cookie || !url) return false;
  if (cookie.httpOnly && js) return false;
  const domain = String(cookie.domain || '');
  if (domain.startsWith('.')) {
    if (!url.hostname.endsWith(domain.slice(1))) return false;
  } else if (domain && domain !== url.hostname) {
    return false;
  }
  if (cookie.secure && url.protocol === 'http:') return false;
  const path = cookie.path || '/';
  if (!url.pathname.startsWith(path)) return false;
  return true;
}

async function breadCookieGetAll() {
  const db = await openBreadCookieDb();
  if (!db) return [];
  const tx = db.transaction('cookies', 'readonly');
  const store = tx.objectStore('cookies');
  const req = store.getAll();
  const result = await idbRequest(req).catch(() => []);
  await idbTxDone(tx).catch(() => {});
  return Array.isArray(result) ? result : [];
}

async function breadCookieDeleteMany(ids) {
  if (!ids || !ids.length) return;
  const db = await openBreadCookieDb();
  if (!db) return;
  const tx = db.transaction('cookies', 'readwrite');
  const store = tx.objectStore('cookies');
  ids.forEach((id) => {
    try {
      store.delete(id);
    } catch (_) {}
  });
  await idbTxDone(tx).catch(() => {});
}

async function breadCookiePut(cookie) {
  const db = await openBreadCookieDb();
  if (!db) return;
  const tx = db.transaction('cookies', 'readwrite');
  const store = tx.objectStore('cookies');
  store.put(cookie);
  await idbTxDone(tx).catch(() => {});
}

async function breadCookieSerialize(url, js) {
  if (!url) return '';
  const cookies = await breadCookieGetAll();
  const now = Date.now();
  const expired = [];
  const out = [];
  for (const cookie of cookies) {
    if (isCookieExpired(cookie, now)) {
      expired.push(cookie.id);
      continue;
    }
    if (!validateCookie(cookie, url, js)) continue;
    out.push(`${cookie.name}=${cookie.value}`);
  }
  if (expired.length) await breadCookieDeleteMany(expired);
  return out.join('; ');
}

async function breadCookieSetFromHeader(setCookie, url) {
  if (!url) return;
  const list = splitSetCookieHeader(setCookie);
  for (const item of list) {
    const parsed = parseSetCookie(item);
    if (!parsed || !parsed.name) continue;
    const cookie = normalizeCookie(parsed, url, true);
    if (cookie.maxAge === 0 || (cookie.expiresAt != null && cookie.expiresAt <= Date.now())) {
      await breadCookieDeleteMany([cookie.id]);
      continue;
    }
    await breadCookiePut(cookie);
  }
}

async function breadCookieSetFromString(value, url) {
  if (!url) return;
  const parsed = parseSetCookie(value);
  if (!parsed || !parsed.name) return;
  if (!parsed.path) parsed.path = '/';
  if (!parsed.domain) parsed.domain = url.hostname;
  const cookie = normalizeCookie(parsed, url, false);
  if (!validateCookie(cookie, url, true)) return;
  if (cookie.maxAge === 0 || (cookie.expiresAt != null && cookie.expiresAt <= Date.now())) {
    await breadCookieDeleteMany([cookie.id]);
    return;
  }
  await breadCookiePut(cookie);
}

function resolveTargetUrlFromValue(value) {
  try {
    const raw = String(value || '');
    if (!raw) return null;
    if (raw.startsWith(location.origin)) {
      const decoder =
        self.__scramjet$bundle &&
        self.__scramjet$bundle.rewriters &&
        self.__scramjet$bundle.rewriters.url &&
        self.__scramjet$bundle.rewriters.url.decodeUrl;
      if (typeof decoder === 'function') return new URL(decoder(raw));
    }
    return new URL(raw);
  } catch (_) {
    return null;
  }
}

function injectBreadScripts(html, cookieStr) {
  if (!html) return html;
  const hasShim = html.includes('/js/bread-shim.js');
  const hasCookie = html.includes('/js/bread-cookie.js');
  if (hasShim && hasCookie) return html;
  const init = `window.__breadCookieStr=${JSON.stringify(cookieStr || '')};`;
  const inject = [
    '<script>',
    init,
    '</script>',
    hasShim ? '' : `<script src="/js/bread-shim.js?v=${BREAD_SW_VERSION}"></script>`,
    hasCookie ? '' : `<script src="/js/bread-cookie.js?v=${BREAD_SW_VERSION}"></script>`,
  ]
    .filter(Boolean)
    .join('');
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + inject);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, inject + '</head>');
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, inject + '</body>');
  }
  return inject + html;
}

function getRawHeader(rawHeaders, name) {
  if (!rawHeaders || !name) return null;
  const target = String(name).toLowerCase();
  for (const key of Object.keys(rawHeaders)) {
    if (String(key).toLowerCase() === target) return rawHeaders[key];
  }
  return null;
}

function ensureRemoteTransport() {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    if (!bareMuxChannel) bareMuxChannel = new BroadcastChannel('bare-mux');
    bareMuxChannel.postMessage({ type: 'setremote', data: null });
  } catch (_) {}
}

ensureRemoteTransport();

self.addEventListener('message', (event) => {
  try {
    const data = event.data || {};
    if (!data || typeof data !== 'object') return;
    if (data.type === 'bread:device_id') {
      const value = String(data.value || '').trim();
      deviceIdHint = value ? value.slice(0, 256) : null;
      allowedCache.expiresAt = 0;
      return;
    }
    if (data.type === 'bread:flush_allowed') {
      allowedCache.expiresAt = 0;
      return;
    }
    if (data.type === 'bread:cookie_get') {
      const url = resolveTargetUrlFromValue(data.payload && data.payload.url);
      breadCookieSerialize(url, true).then((value) => {
        try {
          if (event.ports && event.ports[0]) event.ports[0].postMessage(value);
        } catch (_) {}
      });
      return;
    }
    if (data.type === 'bread:cookie_set') {
      const url = resolveTargetUrlFromValue(data.payload && data.payload.url);
      const value = String((data.payload && data.payload.value) || '');
      breadCookieSetFromString(value, url).then(async () => {
        const updated = await breadCookieSerialize(url, true);
        try {
          if (event.source && event.source.postMessage) {
            event.source.postMessage({ type: 'bread:cookie_sync', value: updated });
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
});

const scramjetBaseFetch = scramjet.fetch.bind(scramjet);

scramjet.fetch = async function (event) {
  const request = event.request;
  const urlParam = new URLSearchParams(new URL(request.url).search);
  if (urlParam.has('url')) {
    const raw = urlParam.get('url');
    return Response.redirect(self.__scramjet$bundle.rewriters.url.encodeUrl(raw, new URL(raw)));
  }

  let targetUrl;
  try {
    targetUrl = new URL(self.__scramjet$bundle.rewriters.url.decodeUrl(request.url));
  } catch (_) {
    return scramjetBaseFetch(event);
  }

  const headers = {};
  try {
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
  } catch (_) {}

  try {
    if (request.referrer && request.referrer.startsWith(location.origin)) {
      const referer = resolveTargetUrlFromValue(request.referrer);
      if (referer) {
        if (headers.origin || (targetUrl.origin !== referer.origin && request.mode === 'cors')) {
          headers.origin = referer.origin;
        }
        headers.referer = referer.href;
      }
    }
  } catch (_) {}

  try {
    const cookieStr = await breadCookieSerialize(targetUrl, false);
    if (cookieStr) headers.cookie = cookieStr;
  } catch (_) {}

  let response;
  try {
    response = await this.client.fetch(targetUrl, {
      method: request.method,
      body: request.body,
      headers,
      credentials: 'omit',
      mode: request.mode === 'cors' ? request.mode : 'same-origin',
      cache: request.cache,
      redirect: request.redirect,
    });
  } catch (err) {
    if (!['document', 'iframe'].includes(request.destination)) return new Response(undefined, { status: 500 });
    console.error(err);
    return breadErrorPage({
      title: "BREAD couldn't load this page",
      subtitle: 'The proxy request failed. This is usually a transport, Bare, or network issue.',
      details: String(err && (err.stack || err.message || err) || 'Unknown error'),
      actionHref: '/',
      actionText: 'Back to Home',
    });
  }

  try {
    const setCookie = getRawHeader(response.rawHeaders, 'set-cookie');
    await breadCookieSetFromHeader(setCookie, targetUrl);
  } catch (_) {}

  let responseBody;
  const responseHeaders = self.__scramjet$bundle.rewriters.rewriteHeaders(response.rawHeaders, targetUrl);
  if (responseHeaders) {
    delete responseHeaders['set-cookie'];
    delete responseHeaders['Set-Cookie'];
  }

  if (response.body) {
    switch (request.destination) {
      case 'iframe':
      case 'document':
        responseBody = self.__scramjet$bundle.rewriters.rewriteHtml(await response.text(), targetUrl);
        break;
      case 'script':
        responseBody = self.__scramjet$bundle.rewriters.rewriteJs(await response.text(), targetUrl);
        break;
      case 'style':
        responseBody = self.__scramjet$bundle.rewriters.rewriteCss(await response.text(), targetUrl);
        break;
      case 'sharedworker':
        break;
      case 'worker':
        break;
      default:
        responseBody = response.body;
        break;
    }
  }

  if (request.destination === 'document') {
    const header = responseHeaders && responseHeaders['content-disposition'];
    if (!/\s*?((inline|attachment);\s*?)filename=/i.test(header || '')) {
      const type = /^\s*?attachment/i.test(header || '') ? 'attachment' : 'inline';
      const finalUrl = response.finalURL || targetUrl.toString();
      const [filename] = new URL(finalUrl).pathname.split('/').slice(-1);
      if (responseHeaders) {
        responseHeaders['content-disposition'] = `${type}; filename=${JSON.stringify(filename)}`;
      }
    }
  }

  if (responseHeaders && responseHeaders.accept === 'text/event-stream') {
    responseHeaders['content-type'] = 'text/event-stream';
  }
  if (crossOriginIsolated && responseHeaders) {
    responseHeaders['Cross-Origin-Embedder-Policy'] = 'require-corp';
  }

  if (['document', 'iframe'].includes(request.destination) && typeof responseBody === 'string') {
    const cookieStr = await breadCookieSerialize(targetUrl, true);
    responseBody = injectBreadScripts(responseBody, cookieStr);
    if (responseHeaders) delete responseHeaders['content-length'];
  }

  return new Response(responseBody, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  });
};

async function getAllowed() {
  const now = Date.now();
  if (allowedCache.expiresAt > now) return allowedCache.value;
  try {
    const headers = deviceIdHint ? { 'X-Device-Id': deviceIdHint } : undefined;
    const qs = deviceIdHint ? '?deviceId=' + encodeURIComponent(deviceIdHint) : '';
    const res = await fetch('/api/keys/allowed' + qs, { credentials: 'include', cache: 'no-store', headers });
    const data = await res.json().catch(() => ({}));
    const allowed = !!(data && data.ok && data.allowed);
    allowedCache = { value: allowed, expiresAt: now + 5000 };
    return allowed;
  } catch (_) {
    allowedCache = { value: false, expiresAt: now + 2000 };
    return false;
  }
}

function wantsHtml(request) {
  try {
    if (request.mode === 'navigate') return true;
    const accept = request.headers.get('accept') || '';
    return accept.includes('text/html') || accept.includes('*/*');
  } catch (_) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

let bareNudgeAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nudgeBareMuxClients() {
  const now = Date.now();
  if (now - bareNudgeAt < 1500) return;
  bareNudgeAt = now;
  ensureRemoteTransport();
  if (!self.clients || !self.clients.matchAll) return;
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    (clients || []).forEach((client) => {
      try {
        client.postMessage({ type: 'bread:need_baremux' });
      } catch (_) {}
    });
  } catch (_) {}
}

async function scramjetFetchWithRetry(event) {
  try {
    return await scramjet.fetch(event);
  } catch (e) {
    const msg = String((e && (e.message || e)) || '');
    if (msg.includes('no bare clients')) {
      try { await nudgeBareMuxClients(); } catch (_) {}
      await sleep(250);
      return await scramjet.fetch(event);
    }
    throw e;
  }
}

function breadErrorPage({ title, subtitle, details, actionHref, actionText, statusCode }) {
  const safeTitle = String(title || 'Error');
  const safeSubtitle = String(subtitle || '');
  const safeDetails = String(details || '');
  const href = String(actionHref || '/');
  const btnText = String(actionText || 'Go Home');

  const css = `
    :root{
      color-scheme: dark;
      --bg:#0f0b07; --card:#1a1410; --elev:#241b14; --border:#3a2e20;
      --text:#f6eedf; --muted:#c0b095; --accent:#c89b3c; --danger:#ef4444;
      --radius:18px;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    *{box-sizing:border-box}
    body{margin:0; min-height:100vh; background:
      radial-gradient(ellipse 110% 80% at 50% -25%, rgba(200,155,60,.22), transparent 55%),
      radial-gradient(ellipse 80% 50% at 80% 60%, rgba(139,105,20,.12), transparent 45%),
      var(--bg);
      color:var(--text);
      display:grid; place-items:center; padding:28px;
    }
    .card{width:min(900px, 100%); background:rgba(26,20,16,.76); border:1px solid var(--border);
      border-radius:var(--radius); padding:28px; box-shadow:0 18px 56px rgba(0,0,0,.55);
      backdrop-filter: blur(14px);
    }
    .brand{display:flex; align-items:center; gap:10px; margin-bottom:14px; color:var(--muted); font-weight:800; letter-spacing:.02em}
    .dot{width:10px;height:10px;border-radius:999px;background:var(--danger); box-shadow:0 0 0 4px rgba(239,68,68,.12)}
    h1{margin:0 0 8px; font-size:26px; letter-spacing:-.02em}
    p{margin:0 0 14px; color:var(--muted); line-height:1.65}
    .row{display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-top:16px}
    a.btn{display:inline-flex; align-items:center; justify-content:center; padding:10px 14px;
      background:var(--accent); color:#120f0c; font-weight:900; text-decoration:none;
      border-radius:12px; border:1px solid rgba(0,0,0,.15);
    }
    a.btn.secondary{background:transparent; color:var(--text); border:1px solid var(--border)}
    pre{margin:14px 0 0; padding:14px; background:rgba(0,0,0,.25); border:1px solid rgba(255,255,255,.08);
      border-radius:12px; overflow:auto; color:var(--text); font-size:12px; line-height:1.5;
    }
  `;

  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(safeTitle)}</title>
      <style>${css}</style>
    </head>
    <body>
      <main class="card" role="main">
        <div class="brand"><span class="dot" aria-hidden="true"></span><span>BREAD</span></div>
        <h1>${escapeHtml(safeTitle)}</h1>
        ${safeSubtitle ? `<p>${escapeHtml(safeSubtitle)}</p>` : ''}
        <div class="row">
          <a class="btn" href="${escapeAttr(href)}">${escapeHtml(btnText)}</a>
          <a class="btn secondary" href="#" onclick="location.reload(); return false;">Retry</a>
        </div>
        ${safeDetails ? `<pre>${escapeHtml(safeDetails)}</pre>` : ''}
      </main>
    </body>
  </html>`;

  const status = Number.isFinite(statusCode) ? statusCode : 502;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  event.respondWith((async () => {
    let isProxyRoute = false;
    let isScramjetRoute = false;
    let isUvRoute = false;
    try {
      if (ultraviolet) isUvRoute = ultraviolet.route(event);
    } catch (_) {}
    try {
      isScramjetRoute = scramjet.route(event);
    } catch (_) {}
    isProxyRoute = isScramjetRoute || isUvRoute;
    try {
      if (isProxyRoute) {
        const allowed = await getAllowed();
        if (!allowed) {
          if (wantsHtml(event.request)) {
            const url = new URL(event.request.url);
            return breadErrorPage({
              title: 'Device locked',
              subtitle: 'Enter a valid key on the home page to unlock this device.',
              details: `URL: ${url.pathname}${url.search}\nReason: key_required`,
              actionHref: '/',
              actionText: 'Open Home',
              statusCode: 403,
            });
          }
          return new Response(JSON.stringify({ ok: false, reason: 'key_required' }), {
            status: 403,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
      }
    } catch (_) {}

    try {
      if (isUvRoute && ultraviolet) return await ultraviolet.fetch(event);
      if (isScramjetRoute) return await scramjetFetchWithRetry(event);
      return await fetch(event.request);
    } catch (e) {
      if (isProxyRoute && wantsHtml(event.request)) {
        return breadErrorPage({
           title: "BREAD couldn't load this page",
          subtitle: 'The proxy request failed. This is usually a transport, Bare, or network issue.',
          details: String(e && (e.stack || e.message || e) || 'Unknown error'),
          actionHref: '/',
          actionText: 'Back to Home',
        });
      }
      return new Response('Proxy error', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
