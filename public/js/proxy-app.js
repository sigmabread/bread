(() => {
  const DEVICE_ID_KEY = 'bread_device_id';
  const TABS_KEY = 'bread_tabs';
  const ACTIVE_TAB_KEY = 'bread_active_tab';

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getOrigin() {
    return location.origin;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function proxyUrl(targetUrl) {
    const u = targetUrl.trim();
    const full = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    try {
      const config = window.__scramjet$config || null;
      let prefix = (config && config.prefix) || '/sj/';
      if (!prefix.startsWith('/')) prefix = '/' + prefix;
      if (!prefix.endsWith('/')) prefix += '/';
      if (config && config.codec && typeof config.codec.encode === 'function') {
        return location.origin + prefix + config.codec.encode(new URL(full).href);
      }

      const encoder =
        window.__scramjet$bundle &&
        window.__scramjet$bundle.rewriters &&
        window.__scramjet$bundle.rewriters.url &&
        window.__scramjet$bundle.rewriters.url.encodeUrl;
      if (typeof encoder === 'function') return encoder(full, new URL(full));
    } catch (_) {}

    // If the page is still running an old build (no Scramjet runtime), send the user to Home.
    try {
      location.href = '/';
    } catch (_) {}
    return '/';
  }

  const offlineBanner = document.getElementById('offlineBanner');
  const proxyApp = document.getElementById('proxyApp');
  const lockForm = document.getElementById('lockForm');
  const keyOverlay = document.getElementById('keyOverlay');
  const keyInput = document.getElementById('keyInput');
  const lockError = document.getElementById('lockError');

  const urlInput = document.getElementById('urlInput');
  const proxyFrame = document.getElementById('proxyFrame');
  const proxyTabs = document.getElementById('proxyTabs');
  const btnBack = document.getElementById('btnBack');
  const btnFwd = document.getElementById('btnFwd');
  const btnReload = document.getElementById('btnReload');
  const btnGo = document.getElementById('btnGo');

  let tabs = [];
  let activeTabId = null;

  function showLock() {
    proxyApp.classList.add('hidden');
    lockError.textContent = '';
    keyInput.value = '';
    keyOverlay.classList.remove('hidden');
    try {
      keyInput.focus();
    } catch (_) {}
  }

  function setUnlockedUI() {
    keyOverlay.classList.add('hidden');
    proxyApp.classList.remove('hidden');
  }

  function loadTabsFromStorage() {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      const active = localStorage.getItem(ACTIVE_TAB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) tabs = parsed;
      }
      if (active && tabs.some((t) => t.id === active)) activeTabId = active;
    } catch (_) {}

    if (!tabs.length) {
      tabs = [{ id: 'tab_1', title: 'New Tab', url: '' }];
      activeTabId = 'tab_1';
    }
    if (!activeTabId) activeTabId = tabs[0].id;
  }

  function saveTabs() {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
    if (activeTabId) localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
  }

  function renderTabs() {
    proxyTabs.innerHTML = tabs
      .map((t) => {
        const isActive = t.id === activeTabId;
        return (
          '<div class="proxy-tab ' +
          (isActive ? 'active' : '') +
          '" data-tab-id="' +
          t.id +
          '" role="tab"><span class="tab-title">' +
          escapeHtml(t.title || 'New Tab') +
          '</span><span class="tab-close" data-tab-id="' +
          t.id +
          '" aria-label="Close tab">&times;</span></div>'
        );
      })
      .join('');

    proxyTabs.querySelectorAll('.proxy-tab').forEach((el) => {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('tab-close')) closeTab(e.target.dataset.tabId);
        else switchTab(el.dataset.tabId);
      });
    });
  }

  function switchTab(id) {
    activeTabId = id;
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      urlInput.value = tab.url ? tab.displayUrl || tab.url : '';
      if (tab.url) proxyFrame.src = proxyUrl(tab.url);
      else proxyFrame.src = 'about:blank';
    }
    renderTabs();
    saveTabs();
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    if (tabs.length === 0) tabs = [{ id: 'tab_' + Date.now(), title: 'New Tab', url: '' }];
    if (activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)].id;
    renderTabs();
    switchTab(activeTabId);
    saveTabs();
  }

  function navigateTo(url) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const full = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    tab.url = full;
    tab.displayUrl = url.trim();
    try {
      tab.title = new URL(full).hostname || 'New Tab';
    } catch (_) {
      tab.title = 'New Tab';
    }
    urlInput.value = tab.displayUrl;
    proxyFrame.src = proxyUrl(full);
    try {
      proxyFrame.addEventListener(
        'load',
        function onLoad() {
          proxyFrame.removeEventListener('load', onLoad);
          try {
            tab.title = proxyFrame.contentDocument?.title || tab.title;
            renderTabs();
            saveTabs();
          } catch (_) {}
        },
        { once: true }
      );
    } catch (_) {}
    saveTabs();
  }

  async function checkUnlock() {
    const deviceId = getDeviceId();
    const res = await fetch(getOrigin() + '/api/keys/check', {
      headers: { 'X-Device-Id': deviceId },
      credentials: 'include',
    });
    const data = await res.json();
    return !!data.unlocked;
  }

  lockForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    lockError.textContent = '';
    const key = keyInput.value.trim();
    const deviceId = getDeviceId();
    try {
      const res = await fetch(getOrigin() + '/api/keys/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, deviceId }),
      });
      const data = await res.json();
      if (data.ok) {
        try {
          localStorage.setItem('bread_used_key_' + deviceId, key);
        } catch (_) {}
        setUnlockedUI();
        // After unlocking, ensure the correct tab is displayed.
        switchTab(activeTabId);
      } else {
        lockError.textContent =
          data.reason === 'invalid_key'
            ? 'Invalid key.'
            : data.reason === 'expired'
              ? 'Key expired.'
              : 'Key already used on another device.';
      }
    } catch (_) {
      lockError.textContent = 'Network error. Try again.';
    }
  });

  btnGo.addEventListener('click', function () {
    const url = urlInput.value.trim();
    if (url) navigateTo(url);
  });

  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const url = urlInput.value.trim();
      if (url) navigateTo(url);
    }
  });

  btnReload.addEventListener('click', function () {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab?.url) proxyFrame.src = proxyUrl(tab.url);
  });

  btnBack.addEventListener('click', function () {
    try {
      proxyFrame.contentWindow.history.back();
    } catch (_) {}
  });

  btnFwd.addEventListener('click', function () {
    try {
      proxyFrame.contentWindow.history.forward();
    } catch (_) {}
  });

  function updateOfflineBanner() {
    if (navigator.onLine) offlineBanner.classList.add('hidden');
    else offlineBanner.classList.remove('hidden');
  }

  updateOfflineBanner();
  window.addEventListener('offline', updateOfflineBanner);
  window.addEventListener('online', updateOfflineBanner);

  (async () => {
    // Always load tab data first.
    loadTabsFromStorage();
    renderTabs();

    // If the keybind is active, keybind.js handles the UI. Stop this script from proceeding.
    if (sessionStorage.getItem('keybindActivated') === 'true') {
        return;
    }

    // Always force the user to enter a key on page load.
    showLock();

    // The `lockForm`'s submit event listener will call `setUnlockedUI` on success,
    // which hides the lock screen and shows the proxy app.

    // Periodically check if the key is still valid and re-lock if it's not.
    setInterval(async () => {
      if (document.hidden || !navigator.onLine || sessionStorage.getItem('keybindActivated') === 'true') {
        return;
      }

      // Only check if the app is currently in an unlocked state.
      const isAppVisible = !proxyApp.classList.contains('hidden');
      if (isAppVisible) {
        try {
          const stillUnlocked = await checkUnlock();
          if (!stillUnlocked) {
            showLock(); // Re-lock the page.
          }
        } catch (_) {
          // Network error, do nothing.
        }
      }
    }, 30000);
  })();

  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || sessionStorage.getItem('keybindActivated') === 'true') {
      return;
    }
    // If the app is visible, check if the key has expired in another tab.
    const isAppVisible = !proxyApp.classList.contains('hidden');
    if (isAppVisible) {
      try {
        const stillUnlocked = await checkUnlock();
        if (!stillUnlocked) {
          showLock(); // Re-lock the page.
        }
      } catch (_) {}
    }
  });
})();
