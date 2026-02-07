/**
 * BREAD – proxy UI (Scramjet): tabs, omnibox, navigation, iframe-per-tab.
 * Exposes: BreadProxyUI
 */
(function () {
  const TABS_KEY = 'bread_tabs';
  const ACTIVE_TAB_KEY = 'bread_active_tab';
  const HISTORY_KEY = 'bread_history';
  const MAX_HISTORY = 500;

  function getDeviceIdSafe() {
    try {
      return window.BreadAuth && typeof window.BreadAuth.getDeviceId === 'function' ? window.BreadAuth.getDeviceId() : 'anon';
    } catch (_) {
      return 'anon';
    }
  }

  function scopedKey(base) {
    return base + '_' + getDeviceIdSafe();
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s ?? '');
    return div.innerHTML;
  }

  function buildSearchUrl(query) {
    return 'https://www.google.com/search?igu=1&q=' + encodeURIComponent(String(query || '').trim());
  }

  function normalizeInputToUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;

    // If it's already a URL-ish string, keep it.
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
    const looksLikeHost = /^[^\s]+\.[^\s]+$/.test(raw) && !raw.includes(' ');

    if (hasScheme) {
      try {
        const scheme = raw.split(':', 1)[0].toLowerCase();
        // Scramjet is an HTTP(S) proxy. Non-HTTP schemes should not be passed to the encoder.
        if (scheme !== 'http' && scheme !== 'https') throw new Error('unsupported_scheme');

        // Validate that it's actually parseable (users often type "https://" or other incomplete schemes).
        // If it is parseable, keep it.
        // eslint-disable-next-line no-new
        new URL(raw);
        return raw;
      } catch (_) {
        // Fall back to search.
      }
    }
    if (looksLikeHost) {
      try {
        const u = 'https://' + raw;
        // eslint-disable-next-line no-new
        new URL(u);
        return u;
      } catch (_) {
        // Fall back to search.
      }
    }

    // Otherwise treat as search.
    return buildSearchUrl(raw);
  }

  function getScramjetPrefix() {
    const config = window.__scramjet$config || null;
    const prefixRaw = (config && config.prefix) || '/sj/';
    let prefix = prefixRaw.startsWith('/') ? prefixRaw : '/' + prefixRaw;
    if (!prefix.endsWith('/')) prefix = prefix + '/';
    return prefix;
  }

  function getUvConfig() {
    return window.__uv$config || null;
  }

  function getUvPrefix() {
    const config = getUvConfig();
    const prefixRaw = (config && config.prefix) || '/service/';
    let prefix = prefixRaw.startsWith('/') ? prefixRaw : '/' + prefixRaw;
    if (!prefix.endsWith('/')) prefix = prefix + '/';
    return prefix;
  }

  function buildUvProxyUrl(targetUrl) {
    const config = getUvConfig();
    if (!config) throw new Error('UV_config_missing');

    const origin = location.origin;
    const prefix = getUvPrefix();

    // If already proxied, return as-is.
    if (typeof targetUrl === 'string' && targetUrl.startsWith(origin + prefix)) return targetUrl;

    // Ensure absolute URL.
    const absolute = new URL(String(targetUrl)).href;
    const encoder =
      (config && typeof config.encodeUrl === 'function' && config.encodeUrl) ||
      (window.Ultraviolet && Ultraviolet.codec && Ultraviolet.codec.xor && Ultraviolet.codec.xor.encode);
    if (typeof encoder !== 'function') throw new Error('UV_encoder_missing');
    return origin + prefix + encoder(absolute);
  }

  function decodeUvProxyUrl(value) {
    try {
      const config = getUvConfig();
      if (!config) return null;
      const origin = location.origin;
      const prefix = getUvPrefix();
      const raw = String(value || '');
      if (!raw.startsWith(origin + prefix)) return null;
      const encoded = raw.slice((origin + prefix).length);
      const decoder =
        (config && typeof config.decodeUrl === 'function' && config.decodeUrl) ||
        (window.Ultraviolet && Ultraviolet.codec && Ultraviolet.codec.xor && Ultraviolet.codec.xor.decode);
      if (typeof decoder !== 'function') return null;
      return decoder(encoded);
    } catch (_) {
      return null;
    }
  }

  function buildScramjetProxyUrl(targetUrl) {
    const config = window.__scramjet$config || null;
    const origin = location.origin;
    const prefix = getScramjetPrefix();

    // If already proxied, return as-is.
    if (typeof targetUrl === 'string' && targetUrl.startsWith(origin + prefix)) return targetUrl;

    // Ensure absolute URL.
    const absolute = new URL(String(targetUrl)).href;

    if (config && config.codec && typeof config.codec.encode === 'function') {
      return origin + prefix + config.codec.encode(absolute);
    }

    // Fallback to Scramjet bundle encoder, but pass a valid base.
    const encoder =
      window.__scramjet$bundle &&
      window.__scramjet$bundle.rewriters &&
      window.__scramjet$bundle.rewriters.url &&
      window.__scramjet$bundle.rewriters.url.encodeUrl;
    if (typeof encoder === 'function') return encoder(absolute, new URL(absolute));

    throw new Error('Scramjet_encoder_missing');
  }

  function decodeScramjetProxyUrl(value) {
    try {
      const decoder =
        window.__scramjet$bundle &&
        window.__scramjet$bundle.rewriters &&
        window.__scramjet$bundle.rewriters.url &&
        window.__scramjet$bundle.rewriters.url.decodeUrl;
      if (typeof decoder !== 'function') return null;
      return decoder(String(value || ''));
    } catch (_) {
      return null;
    }
  }

  function detectProxyEngineFromUrl(url) {
    try {
      const raw = String(url || '');
      const origin = location.origin;
      const uvPrefix = getUvPrefix();
      const sjPrefix = getScramjetPrefix();
      if (raw.startsWith(origin + uvPrefix)) return 'uv';
      if (raw.startsWith(origin + sjPrefix)) return 'scramjet';
      return 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  const DEFAULT_PROXY_ENGINE = 'uv';

  function getPreferredProxyEngine() {
    if (DEFAULT_PROXY_ENGINE === 'uv' && window.__uv$config && window.Ultraviolet) return 'uv';
    if (DEFAULT_PROXY_ENGINE === 'scramjet' && window.__scramjet$config) return 'scramjet';
    if (window.__uv$config && window.Ultraviolet) return 'uv';
    return 'scramjet';
  }

  function postDeviceIdToServiceWorker(flushAllowed) {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (!navigator.serviceWorker.controller) return;
      if (!window.BreadAuth || typeof window.BreadAuth.getDeviceId !== 'function') return;
      const deviceId = window.BreadAuth.getDeviceId();
      if (!deviceId) return;
      navigator.serviceWorker.controller.postMessage({ type: 'bread:device_id', value: deviceId });
      if (flushAllowed) navigator.serviceWorker.controller.postMessage({ type: 'bread:flush_allowed' });
    } catch (_) {}
  }

  function getBareMuxGlobal() {
    try {
      if (!window.__breadBareMux) {
        window.__breadBareMux = { ready: null, connection: null, bareUrls: null, lastError: null };
      }
      return window.__breadBareMux;
    } catch (_) {
      return { ready: null, connection: null, bareUrls: null, lastError: null };
    }
  }

  let bareRemoteBound = false;
  let bareRemoteChannel = null;
  let bareClientPromise = null;

  async function getBareClient() {
    if (bareClientPromise) return bareClientPromise;
    bareClientPromise = (async () => {
      const mod = await import('/bareclient/index.js');
      const createBareClient = (mod && mod.createBareClient) || null;
      const BareClient = (mod && (mod.BareClient || mod.default)) || null;
      if (!createBareClient && !BareClient) throw new Error('BareClient_missing');
      let bareUrl = null;
      try {
        const api = await fetch('/api/status', { cache: 'no-store', credentials: 'include' })
          .then((r) => r.json())
          .catch(() => null);
        if (api && api.bare && Array.isArray(api.bare.urls) && api.bare.urls.length) {
          bareUrl = api.bare.urls[0];
        }
      } catch (_) {}
      if (!bareUrl) bareUrl = new URL('/bare/', location.origin).toString();
      if (createBareClient) return await createBareClient(bareUrl);
      return new BareClient(bareUrl);
    })();
    return bareClientPromise;
  }

  function setupBareMuxRemoteBridge() {
    if (!bareRemoteChannel) {
      try {
        bareRemoteChannel = new BroadcastChannel('bare-mux');
      } catch (_) {
        // If BroadcastChannel is unavailable, remote bridge won't work.
      }
    }

    if (bareRemoteBound) return;
    bareRemoteBound = true;

    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', async (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || data.type !== 'request') return;
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;

      try {
        const client = await getBareClient();
        const resp = await client.fetch(data.remote, {
          method: data.method,
          headers: data.headers,
          body: data.body,
          redirect: 'follow',
        });

        const headers = {};
        try {
          resp.headers.forEach((value, key) => { headers[key] = value; });
        } catch (_) {}

        let body = null;
        if (![101, 204, 205, 304].includes(resp.status)) {
          try {
            body = await resp.arrayBuffer();
          } catch (_) {
            body = null;
          }
        }

        const message = { type: 'response', id: data.id, status: resp.status, headers, body };
        if (body instanceof ArrayBuffer) controller.postMessage(message, [body]);
        else controller.postMessage(message);
      } catch (e) {
        controller.postMessage({
          type: 'error',
          id: data.id,
          error: String(e && (e.message || e) || 'BareMux_remote_error'),
        });
      }
    });
  }

  function requestRemoteTransport() {
    try {
      if (!bareRemoteChannel) bareRemoteChannel = new BroadcastChannel('bare-mux');
      if (bareRemoteChannel) bareRemoteChannel.postMessage({ type: 'setremote', data: null });
    } catch (_) {}
  }

  async function ensureBareMuxTransport() {
    if (bareMuxConnection) {
      try {
        const name = await bareMuxConnection.getTransport();
        if (name) return true;
      } catch (_) {}
      // Transport missing or worker restarted; re-init.
      bareMuxConnection = null;
      try {
        const shared = getBareMuxGlobal();
        shared.connection = null;
        shared.ready = null;
      } catch (_) {}
    }

    const shared = getBareMuxGlobal();
    if (shared.connection) {
      try {
        const name = await shared.connection.getTransport();
        if (name) {
          bareMuxConnection = shared.connection;
          return true;
        }
      } catch (_) {}
      shared.connection = null;
      shared.ready = null;
    }
    if (shared.ready) {
      const ok = await shared.ready;
      if (ok && shared.connection) {
        bareMuxConnection = shared.connection;
        return true;
      }
      return ok;
    }

    shared.ready = (async () => {
      const mux = await import('/baremux/index.mjs');
      const BareMuxConnection = mux && mux.BareMuxConnection ? mux.BareMuxConnection : null;
      if (!BareMuxConnection) throw new Error('BareMuxConnection_missing');

      const connection = new BareMuxConnection('/baremux/worker.js');

      const api = await fetch('/api/status', { cache: 'no-store', credentials: 'include' })
        .then((r) => r.json())
        .catch(() => null);

      const bareUrls =
        api && api.bare && Array.isArray(api.bare.urls) && api.bare.urls.length
          ? api.bare.urls
          : [new URL('/bare/', location.origin).toString()];

      await connection.setTransport('/baremod/index.mjs', bareUrls);

      shared.connection = connection;
      shared.bareUrls = bareUrls;
      bareMuxConnection = connection;
      setupBareMuxRemoteBridge();
      return true;
    })().catch((e) => {
      shared.lastError = e;
      return false;
    });

    const ok = await shared.ready;
    if (!ok) shared.ready = null;
    return ok;
  }

  async function ensureProxyAllowed() {
    postDeviceIdToServiceWorker(true);
    let deviceId = null;
    try {
      deviceId = window.BreadAuth && typeof window.BreadAuth.getDeviceId === 'function' ? window.BreadAuth.getDeviceId() : null;
    } catch (_) {}

    let allowedResult = null;
    try {
      const headers = deviceId ? { 'X-Device-Id': deviceId } : undefined;
      const qs = deviceId ? '?deviceId=' + encodeURIComponent(deviceId) : '';
      const res = await fetch('/api/keys/allowed' + qs, { credentials: 'include', cache: 'no-store', headers });
      const data = await res.json().catch(() => null);
      if (data && data.ok && typeof data.allowed === 'boolean') allowedResult = data.allowed;
      if (allowedResult === true) return true;
    } catch (_) {}

    let unlocked = null;
    try {
      if (window.BreadAuth && typeof window.BreadAuth.checkUnlock === 'function') {
        unlocked = await window.BreadAuth.checkUnlock();
        if (unlocked === true) return true;
      }
    } catch (_) {}

    // Only force-lock if we have a definite "false".
    if (allowedResult === false && unlocked === false) {
      try {
        if (window.BreadApp && typeof window.BreadApp.showLock === 'function') window.BreadApp.showLock();
      } catch (_) {}

      setStatus('warn', 'Locked', 'Device locked', 'Enter a valid key to unlock this device.');
      return false;
    }

    // If the check was inconclusive (network hiccup), don't hard-lock the UI.
    return true;
  }

  let tabs = [];
  let activeTabId = null;

  let urlInputEl = null;
  let proxyTabsEl = null;
  let proxyFrameWrapEl = null;
  let btnBack = null;
  let btnFwd = null;
  let btnNewTab = null;
  let btnFullscreen = null;
  let btnEruda = null;
  let proxyLoadingEl = null;
  let proxyStatusEl = null;
  let proxyStatusDotEl = null;
  let proxyStatusTextEl = null;
  let proxyStatusSubEl = null;
  let proxyOmniboxIconEl = null;

  let statusTimer = null;
  let messageBound = false;
  let swMessageBound = false;

  // Runtime objects (not persisted).
  let scramjetController = null;
  let bareMuxConnection = null;
  let uvBareClient = null;
  const framesByTabId = new Map(); // tabId -> { iframe, kind, lastUrl }

  function bindElements(opts = {}) {
    urlInputEl = opts.urlInput || document.getElementById('urlInput');
    proxyTabsEl = opts.proxyTabs || document.getElementById('proxyTabs');
    proxyFrameWrapEl = opts.proxyFrameWrap || document.querySelector('.proxy-frame-wrap');
    btnBack = opts.btnBack || document.getElementById('btnBack');
    btnFwd = opts.btnFwd || document.getElementById('btnFwd');
    btnNewTab = opts.btnNewTab || document.getElementById('btnNewTab');
    btnFullscreen = opts.btnFullscreen || document.getElementById('btnFullscreen');
    btnEruda = opts.btnEruda || document.getElementById('btnEruda');
    proxyLoadingEl = opts.proxyLoading || document.getElementById('proxyLoading');
    proxyStatusEl = opts.proxyStatus || document.getElementById('proxyStatus');
    proxyStatusDotEl = opts.proxyStatusDot || document.getElementById('proxyStatusDot');
    proxyStatusTextEl = opts.proxyStatusText || document.getElementById('proxyStatusText');
    proxyStatusSubEl = opts.proxyStatusSub || document.getElementById('proxyStatusSub');
    proxyOmniboxIconEl = opts.proxyOmniboxIcon || document.getElementById('proxyOmniboxIcon');
  }

  function setLoading(isLoading) {
    if (!proxyLoadingEl) return;
    if (isLoading) proxyLoadingEl.classList.remove('hidden');
    else proxyLoadingEl.classList.add('hidden');
  }

  function setStatus(kind, text, title, subText) {
    if (proxyStatusDotEl) proxyStatusDotEl.dataset.kind = kind || 'unknown';
    if (proxyStatusTextEl) proxyStatusTextEl.textContent = text || 'Proxy';
    if (proxyStatusSubEl) proxyStatusSubEl.textContent = subText || '';
    if (proxyStatusEl) proxyStatusEl.title = title || 'Proxy status';
    if (proxyOmniboxIconEl) {
      proxyOmniboxIconEl.textContent = kind === 'ok' ? '\u2713' : kind === 'warn' ? '!' : kind === 'off' ? '\u00D7' : '?';
    }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(scopedKey(HISTORY_KEY));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(scopedKey(HISTORY_KEY), JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch (_) {}
  }

  function recordHistory(url, title) {
    if (!url) return;
    const now = Date.now();
    const history = loadHistory();
    const last = history[0];
    if (last && last.url === url && now - (last.ts || 0) < 2000) {
      if (title && (!last.title || last.title === last.host)) last.title = title;
      last.ts = now;
      saveHistory(history);
      return;
    }
    let host = 'Site';
    try {
      host = new URL(url).hostname;
    } catch (_) {}
    history.unshift({ url, host, title: title || host, ts: now });
    saveHistory(history);
  }

  function loadTabsFromStorage() {
    try {
      const raw = localStorage.getItem(scopedKey(TABS_KEY));
      const parsed = raw ? JSON.parse(raw) : null;
      tabs = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      tabs = [];
    }

    try {
      const active = localStorage.getItem(scopedKey(ACTIVE_TAB_KEY));
      if (active && tabs.some((t) => t.id === active)) activeTabId = active;
    } catch (_) {}

    if (!tabs.length) {
      tabs = [{ id: 'tab_1', title: 'New Tab', url: '', displayUrl: '' }];
      activeTabId = 'tab_1';
    }
    if (!activeTabId) activeTabId = tabs[0].id;
  }

  function saveTabs() {
    try {
      localStorage.setItem(scopedKey(TABS_KEY), JSON.stringify(tabs));
      if (activeTabId) localStorage.setItem(scopedKey(ACTIVE_TAB_KEY), activeTabId);
    } catch (_) {}
  }

  function renderTabs() {
    if (!proxyTabsEl) return;
    proxyTabsEl.innerHTML = tabs
      .map((t) => {
        const isActive = t.id === activeTabId;
        return (
          '<div class="proxy-tab ' +
          (isActive ? 'active' : '') +
          '" data-tab-id="' +
          t.id +
          '" role="tab" aria-selected="' +
          (isActive ? 'true' : 'false') +
          '">' +
          '<span class="tab-title">' +
          escapeHtml(t.title || 'New Tab') +
          '</span>' +
          '<span class="tab-close" data-tab-id="' +
          t.id +
          '" aria-label="Close">&times;</span>' +
          '</div>'
        );
      })
      .join('');

    proxyTabsEl.querySelectorAll('.proxy-tab').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) closeTab(e.target.dataset.tabId);
        else switchTab(el.dataset.tabId);
      });
    });
  }

  async function ensureServiceWorkerControlled() {
    if (!('serviceWorker' in navigator)) return false;
    if (navigator.serviceWorker.controller) return true;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (_) {}
    try {
      await navigator.serviceWorker.ready;
    } catch (_) {}
    return !!navigator.serviceWorker.controller;
  }

  async function ensureScramjetReady() {
    if (bareMuxConnection) return true;

    // Ensure SW is controlling (Scramjet proxy depends on it).
    const controlled = await ensureServiceWorkerControlled();
    if (!controlled) return false;

    // Make sure the SW knows the device id so it doesn't 403 proxy routes on first load.
    postDeviceIdToServiceWorker(true);

    // Always set up the remote bridge for Scramjet's internal BareMux (older API).
    // This avoids "no bare clients" errors when Scramjet can't see the newer BareMux worker.
    setupBareMuxRemoteBridge();
    requestRemoteTransport();

    // BareMux transport (for the service worker) + Scramjet controller (for frame creation).
    try {
      const bareOk = await ensureBareMuxTransport();
      if (!bareOk) {
        // Non-fatal: remote bridge can still handle Scramjet requests.
      }

      const prefix = getScramjetPrefix();

      // Prefer the official controller when available, but fall back to the global bundle rewriter.
      if (typeof window.$scramjetLoadController === 'function' && !scramjetController) {
        try {
          const controllerModule = window.$scramjetLoadController();
          const ScramjetController = controllerModule && controllerModule.ScramjetController;
          if (ScramjetController) {
            scramjetController = new ScramjetController({ prefix });
            await scramjetController.init();
          }
        } catch (_) {
          scramjetController = null;
        }
      }

      return true;
    } catch (e) {
      console.error('Scramjet init failed:', e);
      scramjetController = null;
      bareMuxConnection = null;
      return false;
    }
  }

  async function ensureUltravioletReady() {
    const controlled = await ensureServiceWorkerControlled();
    if (!controlled) return false;

    postDeviceIdToServiceWorker(true);

    if (!window.__uv$config || !window.Ultraviolet) return false;

    try {
      const desiredPath = '/baremux/worker.js';
      if (localStorage.getItem('bare-mux-path') !== desiredPath) {
        localStorage.setItem('bare-mux-path', desiredPath);
      }
    } catch (_) {}

    try {
      if (!uvBareClient && window.Ultraviolet && typeof Ultraviolet.BareClient === 'function') {
        uvBareClient = new Ultraviolet.BareClient('/baremux/worker.js');
      }
    } catch (_) {}

    try {
      await ensureBareMuxTransport();
    } catch (_) {}

    return true;
  }

  function hideAllFrames() {
    framesByTabId.forEach((frameInfo) => {
      if (frameInfo && frameInfo.iframe) frameInfo.iframe.classList.add('hidden');
    });
  }

  function ensureTabFrame(tab) {
    if (!proxyFrameWrapEl) return null;
    if (framesByTabId.has(tab.id)) return framesByTabId.get(tab.id);

    const iframe = document.createElement('iframe');
    iframe.className = 'proxy-frame';
    iframe.title = 'Proxied content';
    iframe.setAttribute('loading', 'eager');
    iframe.setAttribute(
      'allow',
      'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-read; clipboard-write; gamepad; microphone; camera; geolocation; accelerometer; gyroscope; magnetometer; xr-spatial-tracking; screen-wake-lock; web-share'
    );
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.classList.add('hidden');

    iframe.addEventListener('load', () => {
      setLoading(false);
      syncTabFromIframe(tab, framesByTabId.get(tab.id));
      try {
        const url = tab.url || '';
        if (url) recordHistory(url, tab.title || '');
      } catch (_) {}
    });

    proxyFrameWrapEl.appendChild(iframe);
    const frameInfo = { iframe, kind: 'iframe', lastUrl: '', engine: null };
    framesByTabId.set(tab.id, frameInfo);
    return frameInfo;
  }

  async function navigateActiveTabTo(input) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    let normalized = normalizeInputToUrl(input);
    if (!normalized) return;
    try {
      // Final validation before encoding. If this fails, fall back to search.
      // eslint-disable-next-line no-new
      new URL(normalized);
    } catch (_) {
      normalized = buildSearchUrl(input);
    }

    let engine = getPreferredProxyEngine();
    let ok = engine === 'uv' ? await ensureUltravioletReady() : await ensureScramjetReady();
    if (!ok && engine === 'uv') {
      engine = 'scramjet';
      ok = await ensureScramjetReady();
    }
    if (!ok) {
      setStatus('warn', 'Reload to enable', 'Service worker is not controlling this page yet. Reload to enable the proxy.');
      return;
    }

    const allowed = await ensureProxyAllowed();
    if (!allowed) return;

    tab.url = normalized;
    tab.displayUrl = String(input || '').trim();
    try {
      tab.title =
        tab.title && tab.title !== 'New Tab'
          ? tab.title
          : ((new URL(normalized).hostname || '').trim() || 'Tab');
    } catch (_) {
      tab.title = tab.title && tab.title !== 'New Tab' ? tab.title : 'Tab';
    }
    saveTabs();
    renderTabs();

    const frameInfo = ensureTabFrame(tab);
    if (!frameInfo) return;

    hideAllFrames();
    frameInfo.iframe.classList.remove('hidden');
    if (urlInputEl) urlInputEl.value = tab.displayUrl || tab.url;

    setLoading(true);
    try {
      // Navigation: set iframe src to the encoded proxy URL.
      let proxied;
      try {
        proxied = engine === 'uv' ? buildUvProxyUrl(normalized) : buildScramjetProxyUrl(normalized);
      } catch (e) {
        // One more fallback: force search URL if encoder rejects the input.
        const fallback = buildSearchUrl(input);
        normalized = fallback;
        proxied = engine === 'uv' ? buildUvProxyUrl(fallback) : buildScramjetProxyUrl(fallback);
      }

      frameInfo.engine = engine;
      frameInfo.lastUrl = proxied;
      frameInfo.iframe.src = proxied;
    } catch (e) {
      console.error(e);
      setLoading(false);
      setStatus('warn', 'Bad URL', 'That address could not be opened. Try a full https:// URL or a search.');
    }
  }

  function syncTabFromIframe(tab, frameInfo) {
    if (!tab || !frameInfo || !frameInfo.iframe) return;
    const iframe = frameInfo.iframe;
    let href = '';
    try {
      href = iframe.contentWindow && iframe.contentWindow.location ? String(iframe.contentWindow.location.href || '') : '';
    } catch (_) {
      href = '';
    }
    if (!href || href === 'about:blank') return;

    let decoded = '';
    const detectedEngine = frameInfo.engine || detectProxyEngineFromUrl(href);
    if (detectedEngine === 'uv') decoded = decodeUvProxyUrl(href) || '';
    else if (detectedEngine === 'scramjet') decoded = decodeScramjetProxyUrl(href) || '';
    else decoded = decodeUvProxyUrl(href) || decodeScramjetProxyUrl(href) || '';
    if (!frameInfo.engine && detectedEngine !== 'unknown') frameInfo.engine = detectedEngine;
    const nextUrl = decoded || href;
    if (!/^https?:\/\//i.test(nextUrl)) return;

    let changed = false;
    if (tab.url !== nextUrl) {
      tab.url = nextUrl;
      tab.displayUrl = nextUrl;
      changed = true;
    }

    try {
      const title = iframe.contentDocument && iframe.contentDocument.title ? String(iframe.contentDocument.title) : '';
      if (title && title !== tab.title) {
        tab.title = title;
        changed = true;
      }
    } catch (_) {}

    if (changed) {
      saveTabs();
      renderTabs();
      if (tab.id === activeTabId && urlInputEl) urlInputEl.value = tab.displayUrl || tab.url || '';
    }
  }

  function switchTab(id) {
    activeTabId = id;
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;

    saveTabs();
    renderTabs();

    if (urlInputEl) urlInputEl.value = tab.displayUrl || tab.url || '';

    const frameInfo = ensureTabFrame(tab);
    if (!frameInfo) return;

    hideAllFrames();
    frameInfo.iframe.classList.remove('hidden');

    // If tab was never navigated, show New Tab.
    if (!frameInfo.iframe.src) frameInfo.iframe.src = '/newtab2.html';
  }

  function closeTab(id) {
    if (tabs.length <= 1) return;
    tabs = tabs.filter((t) => t.id !== id);
    const frameInfo = framesByTabId.get(id);
    if (frameInfo && frameInfo.iframe && frameInfo.iframe.parentNode) {
      frameInfo.iframe.parentNode.removeChild(frameInfo.iframe);
    }
    framesByTabId.delete(id);

    if (activeTabId === id) activeTabId = tabs[0].id;
    saveTabs();
    renderTabs();
    switchTab(activeTabId);
  }

  function newTab() {
    const nextId = 'tab_' + Date.now().toString(36);
    tabs.push({ id: nextId, title: 'New Tab', url: '', displayUrl: '' });
    activeTabId = nextId;
    saveTabs();
    renderTabs();
    switchTab(activeTabId);
  }

  function getActiveIframe() {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return null;
    const frameInfo = framesByTabId.get(tab.id);
    return frameInfo && frameInfo.iframe ? frameInfo.iframe : null;
  }

  function reload() {
    const iframe = getActiveIframe();
    if (!iframe) return;
    setLoading(true);
    try {
      iframe.contentWindow.location.reload();
    } catch (_) {
      iframe.src = iframe.src;
    }
  }

  function goBack() {
    const iframe = getActiveIframe();
    if (!iframe) return;
    try {
      iframe.contentWindow.history.back();
    } catch (_) {}
  }

  function goForward() {
    const iframe = getActiveIframe();
    if (!iframe) return;
    try {
      iframe.contentWindow.history.forward();
    } catch (_) {}
  }

  async function toggleFullscreen() {
    const iframe = getActiveIframe();
    const container = iframe ? iframe : (proxyFrameWrapEl || document.documentElement);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.requestFullscreen({ navigationUI: 'hide' });
    } catch (_) {}
  }

  async function injectEruda() {
    const iframe = getActiveIframe();
    if (!iframe) return;
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) return;

      if (win.eruda) {
        win.eruda.show();
        return;
      }

      const script = doc.createElement('script');
      script.src = '/vendor/eruda.min.js';
      script.async = true;
      script.onload = function () {
        try {
          if (win.eruda && typeof win.eruda.init === 'function') win.eruda.init();
        } catch (_) {}
      };
      doc.documentElement.appendChild(script);
    } catch (_) {}
  }

  async function updateProxyStatus() {
    let engine = 'Ultraviolet';
    let proxyIp = null;
    let proxyIpStale = false;
    let bareOk = null;
    let sw = 'unsupported';

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!reg) sw = 'not-registered';
        else if (reg.active) sw = navigator.serviceWorker.controller ? 'active' : 'active-no-controller';
        else sw = 'registered';
      }
    } catch (_) {
      sw = 'error';
    }

    try {
      const res = await fetch('/api/status', { cache: 'no-store', credentials: 'include' });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (data && data.ok) {
        engine =
          data.engine === 'ultraviolet'
            ? 'Ultraviolet'
            : data.engine === 'scramjet'
              ? 'Scramjet'
              : 'Proxy';
        const e = data.proxyEgress || data.egress;
        if (e && typeof e.ip === 'string') proxyIp = e.ip;
        if (e && typeof e.stale === 'boolean') proxyIpStale = e.stale;
      }
    } catch (_) {}

    try {
      const t = await fetch('/api/selftest', { cache: 'no-store', credentials: 'include' });
      const data = t.ok ? await t.json().catch(() => null) : null;
      bareOk = !!(data && data.ok && data.fetch && data.fetch.status && data.fetch.status < 400);
    } catch (_) {
      bareOk = false;
    }

    const details = [];
    details.push(sw === 'active' ? 'SW: on' : sw === 'active-no-controller' ? 'SW: reload' : 'SW: off');
    details.push(bareOk === true ? 'Bare: ok' : bareOk === false ? 'Bare: fail' : 'Bare: ?');
    details.push(proxyIp ? `Proxy IP: ${proxyIp}${proxyIpStale ? '*' : ''}` : 'Proxy IP: ...');

    const kind = sw === 'active' && bareOk ? 'ok' : sw === 'active-no-controller' ? 'warn' : 'warn';
    setStatus(
      kind,
      engine,
      `${engine} status. Proxy IP is the Bare egress IP (localhost Bare usually equals your normal IP). Configure BARE_URL to a remote Bare server to change it.`,
      details.join(' | ')
    );
  }

  function wireEvents() {
    const btnGo = document.getElementById('btnGo');
    const btnReload = document.getElementById('btnReload');

    if (btnNewTab) btnNewTab.addEventListener('click', newTab);
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
    if (btnEruda) btnEruda.addEventListener('click', injectEruda);

    if (btnGo) btnGo.addEventListener('click', () => navigateActiveTabTo(urlInputEl && urlInputEl.value));
    if (urlInputEl) {
      urlInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          navigateActiveTabTo(urlInputEl.value);
        }
      });
    }

    if (btnReload) btnReload.addEventListener('click', reload);
    if (btnBack) btnBack.addEventListener('click', goBack);
    if (btnFwd) btnFwd.addEventListener('click', goForward);
  }

  function bindServiceWorkerMessages() {
    if (swMessageBound) return;
    swMessageBound = true;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
      try {
        const data = event.data || {};
        if (data.type === 'bread:need_baremux') {
          ensureBareMuxTransport().then((ok) => {
            setupBareMuxRemoteBridge();
            if (!ok) requestRemoteTransport();
          }).catch(() => {
            requestRemoteTransport();
          });
        }
      } catch (_) {}
    });
  }

  function show(opts) {
    bindElements(opts);
    loadTabsFromStorage();
    renderTabs();
    wireEvents();
    bindServiceWorkerMessages();
    ensureBareMuxTransport().catch(() => {});
    ensureUltravioletReady().catch(() => {});

    // Ensure an iframe exists for the active tab.
    switchTab(activeTabId);

    // If the active tab has a URL but no frame navigation yet, navigate now.
    const active = tabs.find((t) => t.id === activeTabId);
    const activeFrame = active ? framesByTabId.get(active.id) : null;
    if (
      active &&
      active.url &&
      activeFrame &&
      (!activeFrame.iframe.src || activeFrame.iframe.src.endsWith('/newtab2.html') || activeFrame.iframe.src.endsWith('/newtab.html'))
    ) {
      navigateActiveTabTo(active.displayUrl || active.url);
    }

    if (statusTimer) clearInterval(statusTimer);
    updateProxyStatus();
    statusTimer = setInterval(updateProxyStatus, 6000);

    if (!messageBound) {
      messageBound = true;
      window.addEventListener('message', (event) => {
        try {
          if (event.origin !== location.origin) return;
          const data = event.data || {};
          if (data.type === 'bread:navigate' && typeof data.value === 'string' && data.value.trim()) {
            if (urlInputEl) urlInputEl.value = data.value.trim();
            navigateActiveTabTo(data.value.trim());
          }
        } catch (_) {}
      });
    }
  }

  window.BreadProxyUI = {
    show,
    loadTabsFromStorage,
    renderTabs,
    switchTab,
    closeTab,
    newTab,
    getTabs: () => tabs,
    getActiveTabId: () => activeTabId,
  };
})();
