(function () {
  'use strict';

  const BUTTON_ID = 'tcurl-btn';
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // Extract Telescope prefix and entry ID from the current URL path.
  // Matches any path of the form /{prefix}/client-requests/{uuid}
  function getEntryInfo() {
    const match = window.location.pathname.match(
      new RegExp(`^(\\/.*?)\\/client-requests\\/(${UUID_RE.source})$`, 'i')
    );
    if (!match) return null;
    return { prefix: match[1], id: match[2] };
  }

  // Telescope API endpoint: /{prefix}/telescope-api/client-requests/{id}
  function buildApiUrl(info) {
    return `${window.location.origin}${info.prefix}/telescope-api/client-requests/${info.id}`;
  }

  async function fetchEntry(info) {
    const res = await fetch(buildApiUrl(info), {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.entry ?? null;
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
      // curl sets Content-Length automatically; skip to avoid conflicts.
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
          // File uploads captured by Telescope show as {name, size, headers}
          const val = (v && typeof v === 'object' && v.name) ? `@${v.name}` : String(v ?? '');
          parts.push(`  -F '${q(`${k}=${val}`)}'`);
        }
      } else {
        // application/x-www-form-urlencoded (default)
        const encoded = Object.entries(payload)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
          .join('&');
        parts.push(`  --data '${q(encoded)}'`);
      }
    }

    return parts.join(' \\\n');
  }

  // Wait for the ".card-header" that contains the entry title to appear in the DOM.
  function waitForCardHeader(timeout = 8000) {
    return new Promise((resolve, reject) => {
      const find = () => {
        for (const el of document.querySelectorAll('.card-header')) {
          if (el.textContent.includes('HTTP Client Request Details')) return el;
        }
        return null;
      };

      const found = find();
      if (found) return resolve(found);

      const timer = setTimeout(() => { obs.disconnect(); reject(); }, timeout);
      const obs = new MutationObserver(() => {
        const el = find();
        if (el) { clearTimeout(timer); obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  async function run() {
    // Clean up any button from a previous navigation.
    document.getElementById(BUTTON_ID)?.remove();

    const info = getEntryInfo();
    if (!info) return;

    let entry;
    try {
      entry = await fetchEntry(info);
    } catch (err) {
      console.warn('[Telescope cURL]', err.message);
      return;
    }
    if (!entry) return;

    const curlCmd = buildCurl(entry.content);

    let header;
    try {
      header = await waitForCardHeader();
    } catch {
      return;
    }

    // Guard against duplicate injection (e.g. observer fires twice).
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id        = BUTTON_ID;
    btn.className = 'tcurl-btn';
    btn.title     = 'Copy HTTP request as cURL command';
    btn.innerHTML = `${ICON_COPY} Copy as cURL`;

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(curlCmd);
      } catch {
        // Fallback for contexts where clipboard API is unavailable.
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

    header.appendChild(btn);
  }

  // ── SPA navigation detection ──────────────────────────────────────────────

  let lastHref = location.href;

  function checkNav() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      run();
    }
  }

  // Back/forward navigation.
  window.addEventListener('popstate', () => {
    lastHref = location.href;
    run();
  });

  // Vue Router uses history.pushState / replaceState for programmatic navigation.
  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      original(...args);
      // Give Vue time to update the DOM before we try to inject.
      setTimeout(run, 150);
    };
  });

  // Catch-all: detect URL changes triggered by any means (hash changes, etc.).
  new MutationObserver(checkNav).observe(document, { childList: true, subtree: true });

  // Initial run on page load.
  run();
})();
