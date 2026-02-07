/* BREAD cookie bridge for proxied pages (Scramjet). */
(function () {
  if (window.__breadCookieHooked) return;
  window.__breadCookieHooked = true;

  let cookieStr = typeof window.__breadCookieStr === 'string' ? window.__breadCookieStr : '';

  function parseCookiePair(value) {
    const str = String(value || '');
    const first = str.split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq < 0) return null;
    return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1) };
  }

  function updateCookieString(current, setValue) {
    const pair = parseCookiePair(setValue);
    if (!pair || !pair.name) return current;
    const parts = current ? current.split(/;\s*/g) : [];
    const filtered = parts.filter((item) => item.split('=', 1)[0] !== pair.name);
    filtered.push(pair.name + '=' + pair.value);
    return filtered.join('; ');
  }

  function sendCookieMessage(type, payload, expectReply) {
    try {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return null;
      if (!expectReply) {
        navigator.serviceWorker.controller.postMessage({ type: type, payload: payload });
        return null;
      }
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data);
        navigator.serviceWorker.controller.postMessage({ type: type, payload: payload }, [channel.port2]);
      });
    } catch (_) {
      return null;
    }
  }

  async function refreshCookieString() {
    const reply = await sendCookieMessage(
      'bread:cookie_get',
      { url: location.href },
      true
    );
    if (typeof reply === 'string') cookieStr = reply;
  }

  try {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () {
        return cookieStr;
      },
      set: function (value) {
        cookieStr = updateCookieString(cookieStr, value);
        sendCookieMessage('bread:cookie_set', { url: location.href, value: String(value || '') }, false);
        refreshCookieString();
      },
    });
  } catch (_) {}

  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event && event.data ? event.data : null;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'bread:cookie_sync' && typeof data.value === 'string') {
          cookieStr = data.value;
        }
      });
    }
  } catch (_) {}

  refreshCookieString();
})();
