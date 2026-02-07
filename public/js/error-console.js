/**
 * Bread Proxy – error log console (easter egg: e l g 1, = to close).
 * Exposes: BreadErrorLog
 */
(function () {
  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getBody() {
    return document.getElementById('errorLogBody');
  }

  function getConsole() {
    return document.getElementById('errorLogConsole');
  }

  function addLine(msg, type) {
    var body = getBody();
    if (!body) return;
    var line = document.createElement('div');
    line.className = 'line' + (type ? ' ' + type : '');
    var d = new Date();
    var ts = d.toISOString().slice(11, 23);
    line.innerHTML = '<span class="ts">[' + ts + ']</span>' + escapeHtml(msg);
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  function show() {
    var body = getBody();
    var consoleEl = getConsole();
    if (!body || !consoleEl) return;
    body.innerHTML = '';
    addLine('Bread Proxy — Error log opened', 'warn');
    if (window.BreadAuth && window.BreadAuth.getDeviceId) {
      addLine('Session: ' + window.BreadAuth.getDeviceId().slice(0, 12) + '…');
    }
    addLine('Ready.');
    consoleEl.classList.add('visible');
  }

  function hide() {
    var consoleEl = getConsole();
    if (consoleEl) consoleEl.classList.remove('visible');
  }

  window.BreadErrorLog = {
    show,
    hide,
    addLine,
  };
})();
