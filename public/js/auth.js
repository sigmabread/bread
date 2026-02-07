/**
 * Bread Proxy – auth: device id, unlock, stored key, bypass.
 * Exposes: BreadAuth
 */
(function () {
  const DEVICE_ID_KEY = 'bread_device_id';
  const BYPASS_EXPIRY_KEY = 'bread_bypass_expiry';
  const USED_KEY_PREFIX = 'bread_used_key_';
  const BYPASS_DURATION_MS = 10 * 60 * 1000;
  let bypassUntil = 0;

  function getDeviceId() {
    var id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getOrigin() {
    return location.origin;
  }

  function proxyUrl(targetUrl) {
    var u = String(targetUrl).trim();
    var full = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    try {
      var config = window.__scramjet$config || null;
      var prefixRaw = (config && config.prefix) || '/sj/';
      var prefix = prefixRaw.charAt(0) === '/' ? prefixRaw : '/' + prefixRaw;
      if (prefix.charAt(prefix.length - 1) !== '/') prefix = prefix + '/';
      if (config && config.codec && typeof config.codec.encode === 'function') {
        return location.origin + prefix + config.codec.encode(new URL(full).href);
      }

      var encoder =
        window.__scramjet$bundle &&
        window.__scramjet$bundle.rewriters &&
        window.__scramjet$bundle.rewriters.url &&
        window.__scramjet$bundle.rewriters.url.encodeUrl;
      if (typeof encoder === 'function') return encoder(full, new URL(full));
    } catch (_) {}
    // Fallback: legacy stream proxy route (may be removed later).
    return getOrigin() + '/go/' + encodeURIComponent(full);
  }

  function getBypassExpiry() {
    // Legacy: bypass used to persist; clear it so bypass only happens when the keybind is entered.
    try { localStorage.removeItem(BYPASS_EXPIRY_KEY); } catch (_) {}
    try { sessionStorage.removeItem(BYPASS_EXPIRY_KEY); } catch (_) {}
    return bypassUntil;
  }

  function setBypassExpiry(ms) {
    bypassUntil = Date.now() + ms;
  }

  function clearBypassExpiry() {
    bypassUntil = 0;
    try {
      fetch(getOrigin() + '/api/keys/bypass/clear', { method: 'POST', credentials: 'include' }).catch(function () {});
    } catch (_) {}
  }

  function isBypassActive() {
    return getBypassExpiry() > Date.now();
  }

  async function checkUnlock() {
    var deviceId = getDeviceId();
    try {
      var url = getOrigin() + '/api/keys/check?deviceId=' + encodeURIComponent(deviceId);
      var res = await fetch(url, {
        headers: { 'X-Device-Id': deviceId },
        credentials: 'include',
      });
      if (!res.ok) return null;
      var data = await res.json().catch(function () { return null; });
      if (!data || data.ok === false) return null;
      return !!(data && data.unlocked);
    } catch (_) {
      return null;
    }
  }

  async function tryStoredKey() {
    var deviceId = getDeviceId();
    var usedKey = localStorage.getItem(USED_KEY_PREFIX + deviceId);
    if (!usedKey) return false;
    try {
      var res = await fetch(getOrigin() + '/api/keys/unlock', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: usedKey, deviceId }),
      });
      var data = await res.json();
      return !!(data && data.ok);
    } catch (_) {
      return false;
    }
  }

  async function unlockWithKey(key) {
    var deviceId = getDeviceId();
    var res = await fetch(getOrigin() + '/api/keys/unlock', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key.trim(), deviceId }),
    });
    var data = await res.json();
    if (data && data.ok) {
      try {
        localStorage.setItem(USED_KEY_PREFIX + deviceId, key.trim());
      } catch (_) {}
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'bread:device_id', value: deviceId });
          navigator.serviceWorker.controller.postMessage({ type: 'bread:flush_allowed' });
        }
      } catch (_) {}
      return { ok: true };
    }
    return {
      ok: false,
      reason: (data && data.reason) || 'unknown',
    };
  }

  function startBypass() {
    setBypassExpiry(BYPASS_DURATION_MS);
    try {
      fetch(getOrigin() + '/api/keys/bypass', { method: 'POST', credentials: 'include' }).catch(function () {});
    } catch (_) {}
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'bread:device_id', value: getDeviceId() });
        navigator.serviceWorker.controller.postMessage({ type: 'bread:flush_allowed' });
      }
    } catch (_) {}
  }

  window.BreadAuth = {
    getDeviceId: getDeviceId,
    getOrigin: getOrigin,
    proxyUrl: proxyUrl,
    getBypassExpiry: getBypassExpiry,
    setBypassExpiry: setBypassExpiry,
    clearBypassExpiry: clearBypassExpiry,
    isBypassActive: isBypassActive,
    checkUnlock: checkUnlock,
    tryStoredKey: tryStoredKey,
    unlockWithKey: unlockWithKey,
    startBypass: startBypass,
    BYPASS_DURATION_MS: BYPASS_DURATION_MS,
  };
})();
