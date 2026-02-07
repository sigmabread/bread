/**
 * Bread Proxy – main app: bootstrap, lock/unlock UI, bypass timer, offline, visibility.
 * Depends: BreadAuth, BreadProxyUI, BreadKeybinds, BreadErrorLog (load order: auth, proxy-ui, keybinds, error-console, app).
 */
(function () {
  var homeView = document.getElementById('homeView');
  var keyOverlay = document.getElementById('keyOverlay');
  var offlineBanner = document.getElementById('offlineBanner');
  var proxyApp = document.getElementById('proxyApp');
  var lockForm = document.getElementById('lockForm');
  var keyInput = document.getElementById('keyInput');
  var lockError = document.getElementById('lockError');
  var btnStartBrowsing = document.getElementById('btnStartBrowsing');
  var linkHome = document.getElementById('linkHome');

  var bypassTimerInterval = null;
  var LAST_VIEW_KEY = 'bread_last_view';
  var unlockedOnce = false;

  function persistView(view) {
    try {
      if (window.BreadAuth && typeof window.BreadAuth.getDeviceId === 'function') {
        localStorage.setItem(LAST_VIEW_KEY + '_' + window.BreadAuth.getDeviceId(), view);
      }
    } catch (_) {}
  }

  function showHome() {
    if (proxyApp) proxyApp.classList.add('hidden');
    if (homeView) homeView.classList.remove('hidden');
  }

  function showProxy() {
    if (proxyApp) {
      if (homeView) homeView.classList.add('hidden');
      proxyApp.classList.remove('hidden');
      return;
    }
    try { location.assign('/proxy'); } catch (_) {}
  }

  function showLock() {
    showHome();
    if (keyInput) keyInput.value = '';
    if (lockError) lockError.textContent = '';
    if (btnStartBrowsing) btnStartBrowsing.disabled = true;
    if (keyOverlay) keyOverlay.classList.remove('hidden');
  }

  function setUnlockedUI() {
    if (btnStartBrowsing) btnStartBrowsing.disabled = false;
    if (keyOverlay) keyOverlay.classList.add('hidden');
    unlockedOnce = true;
    if (proxyApp && !homeView) {
      showProxy();
      return;
    }
    // Stay on the home page; user explicitly clicks "Start Browsing" to open the proxy UI.
    showHome();
  }

  function markUnlockedUI() {
    if (btnStartBrowsing) btnStartBrowsing.disabled = false;
    if (keyOverlay) keyOverlay.classList.add('hidden');
    unlockedOnce = true;
    if (proxyApp && !homeView) showProxy();
  }

  function getBypassTimerEl() {
    var el = document.getElementById('bread-bypass-timer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bread-bypass-timer';
      el.className = 'bread-bypass-timer';
      document.body.appendChild(el);
    }
    return el;
  }

  function startBypassTimer() {
    function tick() {
      if (!window.BreadAuth) return;
      var expiry = window.BreadAuth.getBypassExpiry();
      var left = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      var el = getBypassTimerEl();
      if (left <= 0) {
        clearInterval(bypassTimerInterval);
        bypassTimerInterval = null;
        window.BreadAuth.clearBypassExpiry();
        el.classList.add('hidden');
        showLock();
        return;
      }
      var m = Math.floor(left / 60);
      var s = left % 60;
      el.textContent = 'Bypass: ' + m + ':' + (s < 10 ? '0' : '') + s;
      el.classList.remove('hidden');
    }
    if (bypassTimerInterval) clearInterval(bypassTimerInterval);
    tick();
    bypassTimerInterval = setInterval(tick, 1000);
  }

  function updateOfflineBanner() {
    if (!offlineBanner) return;
    if (navigator.onLine) offlineBanner.classList.add('hidden');
    else offlineBanner.classList.remove('hidden');
  }

  function postDeviceIdToServiceWorker(flushAllowed) {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (!window.BreadAuth || typeof window.BreadAuth.getDeviceId !== 'function') return;
      const id = window.BreadAuth.getDeviceId();
      if (!id) return;
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;
      controller.postMessage({ type: 'bread:device_id', value: id });
      if (flushAllowed) controller.postMessage({ type: 'bread:flush_allowed' });
    } catch (_) {}
  }

  function pollUnlock() {
    if (!navigator.onLine) return;
    if (!window.BreadAuth) return;
    window.BreadAuth.checkUnlock().then(function (unlocked) {
      // Only force-lock on a definite "false". Ignore transient network failures (null).
      if (unlocked === false) showLock();
    }).catch(function () {});
  }

  window.BreadApp = {
    showHome: showHome,
    showProxy: showProxy,
    showLock: showLock,
    setUnlockedUI: setUnlockedUI,
    onBypass: function () {
      // Don't navigate away from the proxy UI when the user triggers bypass.
      markUnlockedUI();
      if (proxyApp && !homeView && window.BreadProxyUI) window.BreadProxyUI.show();
      startBypassTimer();
    },
  };

  if (linkHome) {
    linkHome.addEventListener('click', function (e) {
      e.preventDefault();
      persistView('home');
      if (homeView) showHome();
      else {
        try { location.assign('/'); } catch (_) {}
      }
    });
  }

  if (btnStartBrowsing) {
    btnStartBrowsing.addEventListener('click', function () {
      persistView('proxy');
      if (!proxyApp) {
        try { location.assign('/proxy'); } catch (_) {}
        return;
      }
      showProxy();
      if (window.BreadProxyUI) window.BreadProxyUI.show();
    });
  }

  if (lockForm && keyInput && lockError) {
    lockForm.addEventListener('submit', function (e) {
      e.preventDefault();
      lockError.textContent = '';
      var key = keyInput.value.trim();
      if (!window.BreadAuth) return;
      window.BreadAuth.unlockWithKey(key).then(function (result) {
        if (result.ok) {
          setUnlockedUI();
          postDeviceIdToServiceWorker(true);
          if (proxyApp && !homeView && window.BreadProxyUI) window.BreadProxyUI.show();
        } else {
          var msg = result.reason === 'invalid_key' ? 'Invalid key.' : result.reason === 'expired' ? 'Key expired.' : result.reason === 'already_used' ? 'Key already used on another device.' : 'Unlock failed.';
          lockError.textContent = msg;
        }
      }).catch(function () {
        lockError.textContent = 'Network error. Try again.';
      });
    });
  }

  updateOfflineBanner();
  window.addEventListener('offline', updateOfflineBanner);
  window.addEventListener('online', updateOfflineBanner);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (window.BreadAuth && window.BreadAuth.isBypassActive()) return;
    if (window.BreadAuth) window.BreadAuth.checkUnlock().then(function (unlocked) {
      // Don't kick users back to Home just because the browser tab was backgrounded.
      // Only ensure the UI is unlocked (overlay hidden / button enabled).
      if (unlocked === true) markUnlockedUI();
    });
  });

  if (window.BreadKeybinds) window.BreadKeybinds.register();

  if ('serviceWorker' in navigator && window.BreadAuth) {
    function cleanupLegacyServiceWorkersAndCaches() {
      try {
        var doneKey = 'bread_sw_cleanup_done';
        if (sessionStorage.getItem(doneKey) === '1') return Promise.resolve(false);

        return navigator.serviceWorker
          .getRegistrations()
          .then(function (regs) {
            var shouldReload = false;
            var promises = [];

            (regs || []).forEach(function (reg) {
              try {
                var url =
                  (reg.active && reg.active.scriptURL) ||
                  (reg.waiting && reg.waiting.scriptURL) ||
                  (reg.installing && reg.installing.scriptURL) ||
                  '';
                var scope = String(reg.scope || '');

                var isLegacy =
                  url.includes('/uv/') ||
                  url.includes('uv.sw.js') ||
                  url.includes('ultraviolet') ||
                  (url && !url.endsWith('/sw.js')) ||
                  (scope && !scope.endsWith('/'));

                if (isLegacy) {
                  shouldReload = true;
                  promises.push(reg.unregister().catch(function () {}));
                }
              } catch (_) {}
            });

            return Promise.all(promises)
              .catch(function () {})
              .then(function () {
                if (!('caches' in window)) return shouldReload;
                return caches
                  .keys()
                  .then(function (keys) {
                    return Promise.all(
                      (keys || []).map(function (k) {
                        return caches.delete(k).catch(function () {});
                      })
                    );
                  })
                  .catch(function () {})
                  .then(function () {
                    return shouldReload;
                  });
              });
          })
          .catch(function () {
            return false;
          })
          .finally(function () {
            try {
              sessionStorage.setItem(doneKey, '1');
            } catch (_) {}
          });
      } catch (_) {
        return Promise.resolve(false);
      }
    }

    cleanupLegacyServiceWorkersAndCaches()
      .then(function (didCleanup) {
        return navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
          try { reg.update(); } catch (_) {}

          try {
            // As soon as the SW controls the page, give it the device id so SW-side access checks
            // don't incorrectly 403 proxied routes.
            postDeviceIdToServiceWorker(true);
            navigator.serviceWorker.ready.then(function () {
              postDeviceIdToServiceWorker(true);
            }).catch(function () {});
          } catch (_) {}

          // If a new SW takes control, reload once so the proxy works without manual "clear site data".
          try {
            var k = 'bread_sw_controller_reload';
            navigator.serviceWorker.addEventListener('controllerchange', function () {
              try {
                postDeviceIdToServiceWorker(true);
              } catch (_) {}
              try {
                if (sessionStorage.getItem(k)) return;
                sessionStorage.setItem(k, '1');
              } catch (_) {}
              location.reload();
            });
          } catch (_) {}

          if (didCleanup) {
            try { location.reload(); } catch (_) {}
          }
        });
      })
      .catch(function () {});
  }

  (function init() {
    showHome();
    showLock();
    if (window.BreadAuth) window.BreadAuth.clearBypassExpiry();

    if (window.BreadAuth && window.BreadAuth.isBypassActive()) {
      setUnlockedUI();
      if (proxyApp && !homeView && window.BreadProxyUI) window.BreadProxyUI.show();
      startBypassTimer();
      return;
    }

    function onUnlocked() {
      setUnlockedUI();
      postDeviceIdToServiceWorker(true);
      setInterval(pollUnlock, 30000);
      try {
        if (proxyApp && !homeView) {
          persistView('proxy');
          if (window.BreadProxyUI) window.BreadProxyUI.show();
          return;
        }
      } catch (_) {}
    }

    if (!window.BreadAuth) {
      return;
    }
    window.BreadAuth.tryStoredKey().then(function (ok) {
      if (ok) {
        onUnlocked();
        return;
      }
      return window.BreadAuth.checkUnlock();
    }).then(function (unlocked) {
      if (unlocked === true) onUnlocked();
    }).catch(function () {
      if (!unlockedOnce) showLock();
    });
  })();
})();
