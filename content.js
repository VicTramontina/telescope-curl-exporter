(function () {
  'use strict';

  // ── Inject page.js into the PAGE context so it can intercept XHR ──────────
  // Content scripts run in an isolated world; to intercept XMLHttpRequest we
  // must inject a real <script> tag that runs in the page's JS context.
  const pageScript = document.createElement('script');
  pageScript.src = chrome.runtime.getURL('page.js');
  (document.head || document.documentElement).prepend(pageScript);
  pageScript.remove();

  // ── Helpers ───────────────────────────────────────────────────────────────

  const BUTTON_ID = 'tcurl-btn';

  function isClientRequestPage() {
    return /\/client-requests\/[0-9a-f-]{36}/i.test(window.location.pathname);
  }

  // Escape single quotes for POSIX shell single-quoted strings.
  function q(str) {
    return String(str).replace(/'/g, "'\\''");
  }

  function buildCurl(content) {
    const method  = (content.method  || 'GET').toUpperCase();
    const uri     = content.uri      || '';
    const headers = content.headers  || {};
    const payload = content.payload;
    const ct      = (headers['content-type'] || '').toLowerCase();

    const parts = [`curl -X ${method} '${q(uri)}'`];

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'content-length') continue;
      parts.push(`  -H '${q(`${key}: ${value}`)}'`);
    }

    const hasBody =
      payload &&
      typeof payload === 'object' &&
      Object.keys(payload).length > 0 &&
      !['GET', 'HEAD'].includes(method);

    if (hasBody) {
      if (ct.includes('application/json')) {
        parts.push(`  --data-raw '${q(JSON.stringify(payload))}'`);
      } else if (ct.includes('multipart/form-data')) {
        for (const [k, v] of Object.entries(payload)) {
          const val = (v && typeof v === 'object' && v.name) ? `@${v.name}` : String(v ?? '');
          parts.push(`  -F '${q(`${k}=${val}`)}'`);
        }
      } else {
        const encoded = Object.entries(payload)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
          .join('&');
        parts.push(`  --data '${q(encoded)}'`);
      }
    }

    return parts.join(' \\\n');
  }

  // ── Button ────────────────────────────────────────────────────────────────

  const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  function showButton(curlCmd) {
    // Remove stale button (navigated to a new entry).
    const prev = document.getElementById(BUTTON_ID);
    if (prev) prev.remove();

    if (!isClientRequestPage()) return;

    const btn = document.createElement('button');
    btn.id        = BUTTON_ID;
    btn.className = 'tcurl-btn';
    btn.title     = 'Copy HTTP request as cURL command';
    btn.innerHTML = `${ICON_COPY} Copy as cURL`;

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(curlCmd);
      } catch {
        // Clipboard API not available — textarea fallback.
        const ta = document.createElement('textarea');
        ta.value = curlCmd;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }

      const prev = btn.innerHTML;
      btn.classList.add('tcurl-copied');
      btn.innerHTML = `${ICON_CHECK} Copied!`;
      setTimeout(() => {
        btn.classList.remove('tcurl-copied');
        btn.innerHTML = prev;
      }, 2000);
    });

    document.body.appendChild(btn);
  }

  function hideButton() {
    document.getElementById(BUTTON_ID)?.remove();
  }

  // ── Listen for entry data from the page-context interceptor ───────────────

  window.addEventListener('__tcurl:entry__', (e) => {
    try {
      const entry = JSON.parse(e.detail);
      if (isClientRequestPage()) {
        showButton(buildCurl(entry.content));
      }
    } catch (_) {}
  });

  // ── SPA navigation: show/hide the button on route changes ─────────────────

  let lastHref = location.href;

  function onNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;

    if (!isClientRequestPage()) {
      hideButton();
    }
    // If navigating TO a client-requests page, the XHR intercept in page.js
    // will fire when Vue loads the new entry and dispatch __tcurl:entry__.
  }

  window.addEventListener('popstate', () => {
    lastHref = location.href;
    onNavigation();
  });

  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      original(...args);
      onNavigation();
    };
  });

  // Catch-all for any navigation mechanism.
  new MutationObserver(onNavigation).observe(document, { childList: true, subtree: true });

  // Hide button on initial load if not on a client-request page.
  if (!isClientRequestPage()) hideButton();
})();
