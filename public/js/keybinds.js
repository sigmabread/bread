/**
 * Bread Proxy – keybinds: e l g 1 (error log), k i b i p s (bypass).
 * Exposes: BreadKeybinds
 */
(function () {
  const ELG1 = ['e', 'l', 'g', '1'];
  const KIBIPS = ['k', 'i', 'b', 'i', 'p', 's'];

  let elg1Index = 0;
  let kibipsIndex = 0;

  function getErrorLogConsole() {
    return document.getElementById('errorLogConsole');
  }

  function onElg1() {
    if (typeof window.BreadErrorLog !== 'undefined' && window.BreadErrorLog.show) {
      window.BreadErrorLog.show();
    }
  }

  function onKibips() {
    if (typeof window.BreadAuth !== 'undefined' && window.BreadAuth.startBypass) {
      window.BreadAuth.startBypass();
    }
    if (typeof window.BreadApp !== 'undefined' && window.BreadApp.onBypass) {
      window.BreadApp.onBypass();
    }
  }

  function handleKeydown(e) {
    var rawKey = (e && typeof e.key === 'string') ? e.key : '';
    if (!rawKey) return;
    var key = rawKey.toLowerCase();
    var errorLog = getErrorLogConsole();
    if (errorLog && errorLog.classList.contains('visible')) {
      if (rawKey === '=') {
        e.preventDefault();
        if (window.BreadErrorLog && window.BreadErrorLog.hide) window.BreadErrorLog.hide();
      }
      return;
    }
    if (ELG1[elg1Index] === key) {
      elg1Index++;
      if (elg1Index === ELG1.length) {
        elg1Index = 0;
        onElg1();
      }
    } else {
      elg1Index = 0;
    }
    if (KIBIPS[kibipsIndex] === key) {
      kibipsIndex++;
      if (kibipsIndex === KIBIPS.length) {
        kibipsIndex = 0;
        onKibips();
      }
    } else {
      kibipsIndex = 0;
    }
  }

  function register() {
    document.addEventListener('keydown', handleKeydown);
  }

  window.BreadKeybinds = {
    register,
    ELG1,
    KIBIPS,
  };
})();
