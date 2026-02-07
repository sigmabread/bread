/* BREAD compatibility shims for tricky sites (Scramjet pages). */
(function () {
  if (window.__breadShimLoaded) return;
  window.__breadShimLoaded = true;

  // Minimal TCF API stub for CMP scripts.
  if (typeof window.__tcfapi !== 'function') {
    window.__tcfapi = function (command, version, callback) {
      if (typeof callback !== 'function') return;
      const base = {
        tcString: '',
        gdprApplies: false,
        cmpStatus: 'loaded',
        eventStatus: 'tcloaded',
        listenerId: 0,
      };
      switch (String(command || '').toLowerCase()) {
        case 'ping':
          callback(
            {
              gdprApplies: false,
              cmpLoaded: true,
              cmpStatus: 'loaded',
              apiVersion: version || 2,
            },
            true
          );
          break;
        case 'gettcdata':
        case 'gettcstring':
          callback(base, true);
          break;
        default:
          callback(base, true);
          break;
      }
    };
    window.__tcfapiLocator = window.__tcfapiLocator || {};
  }

  // Ensure CSSStyleDeclaration descriptors exist for Scramjet hooks.
  try {
    const cssProps = [
      'background',
      'backgroundImage',
      'mask',
      'maskImage',
      'listStyle',
      'listStyleImage',
      'borderImage',
      'borderImageSource',
      'cursor',
    ];
    const toKebab = (prop) =>
      prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    cssProps.forEach((prop) => {
      const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
      if (!desc || typeof desc.set !== 'function') {
        const cssName = toKebab(prop);
        Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
          configurable: true,
          enumerable: true,
          get() {
            try {
              return this.getPropertyValue(cssName);
            } catch (_) {
              return '';
            }
          },
          set(value) {
            try {
              this.setProperty(cssName, value);
            } catch (_) {}
          },
        });
      }
    });
  } catch (_) {}

  function patchEncodeUrl(bundle) {
    try {
      if (!bundle || !bundle.rewriters || !bundle.rewriters.url) return;
      if (bundle.rewriters.url.__breadPatched) return;
      const orig = bundle.rewriters.url.encodeUrl;
      if (typeof orig !== 'function') return;
      bundle.rewriters.url.encodeUrl = function (input, base) {
        const str = String(input ?? '');
        if (!str) return str;
        if (/^(javascript|data|blob|mailto|tel):/i.test(str)) return str;
        let baseUrl = base;
        try {
          if (!baseUrl) {
            if (window.__location && window.__location.href) baseUrl = new URL(window.__location.href);
            else baseUrl = new URL(location.href);
          }
        } catch (_) {
          baseUrl = undefined;
        }
        try {
          return orig(str, baseUrl);
        } catch (_) {
          try {
            const abs = baseUrl ? new URL(str, baseUrl).href : str;
            return orig(abs, baseUrl);
          } catch (_2) {
            return str;
          }
        }
      };
      bundle.rewriters.url.__breadPatched = true;
    } catch (_) {}
  }

  try {
    if (window.__scramjet$bundle) {
      patchEncodeUrl(window.__scramjet$bundle);
    } else {
      Object.defineProperty(window, '__scramjet$bundle', {
        configurable: true,
        get() {
          return this.__breadScramjetBundle;
        },
        set(value) {
          this.__breadScramjetBundle = value;
          patchEncodeUrl(value);
        },
      });
    }
  } catch (_) {
    const timer = setInterval(() => {
      if (window.__scramjet$bundle) {
        patchEncodeUrl(window.__scramjet$bundle);
        clearInterval(timer);
      }
    }, 50);
  }
})();
