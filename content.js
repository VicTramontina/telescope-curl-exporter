(function () {
  'use strict';

  // ── Inject page.js into the PAGE context so it can intercept XHR ──────────
  const pageScript = document.createElement('script');
  pageScript.src = chrome.runtime.getURL('page.js');
  (document.head || document.documentElement).prepend(pageScript);
  pageScript.remove();

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isClientRequestPage() {
    return /\/client-requests\/[0-9a-f-]{36}/i.test(window.location.pathname);
  }

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
      const ct2 = ct;
      if (ct2.includes('application/json')) {
        parts.push(`  --data-raw '${q(JSON.stringify(payload))}'`);
      } else if (ct2.includes('multipart/form-data')) {
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

  function formatResponseBody(response) {
    if (!response) return '';
    if (typeof response === 'object') {
      return JSON.stringify(response, null, 2);
    }
    return String(response);
  }

  function statusLabel(status) {
    const labels = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      301: 'Moved Permanently', 302: 'Found',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity',
      429: 'Too Many Requests', 500: 'Internal Server Error',
      502: 'Bad Gateway', 503: 'Service Unavailable',
    };
    return labels[status] ? `${status} ${labels[status]}` : String(status ?? '—');
  }

  function statusClass(status) {
    if (!status) return 'tcurl-status-unknown';
    if (status < 300) return 'tcurl-status-ok';
    if (status < 400) return 'tcurl-status-redirect';
    if (status < 500) return 'tcurl-status-client-err';
    return 'tcurl-status-server-err';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function flashButton(btn, label = 'Copied!') {
    const prev = btn.textContent;
    btn.textContent = label;
    btn.classList.add('tcurl-flashed');
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove('tcurl-flashed');
    }, 1800);
  }

  // ── Build the "Copy All" shareable text ───────────────────────────────────

  function buildShareText(content) {
    const method   = (content.method || 'GET').toUpperCase();
    const uri      = content.uri || '';
    const status   = content.response_status;
    const curl     = buildCurl(content);
    const body     = formatResponseBody(content.response);
    const duration = content.duration ? `${content.duration}ms` : null;

    let text = `${method} ${uri}\n`;
    text += `${'─'.repeat(60)}\n\n`;
    text += `REQUEST (curl)\n${curl}\n`;

    if (status) {
      text += `\n${'─'.repeat(60)}\n`;
      text += `RESPONSE — ${statusLabel(status)}`;
      if (duration) text += ` (${duration})`;
      text += '\n';
      if (body) text += `\n${body}\n`;
    }

    return text;
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  const TRIGGER_ID = 'tcurl-trigger';
  const PANEL_ID   = 'tcurl-panel';

  function removeUI() {
    document.getElementById(TRIGGER_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
  }

  function createPanel(content) {
    const curl         = buildCurl(content);
    const responseBody = formatResponseBody(content.response);
    const status       = content.response_status;
    const duration     = content.duration ? ` · ${content.duration}ms` : '';
    const respHeaders  = content.response_headers || {};
    const method       = (content.method || 'GET').toUpperCase();

    const panel = document.createElement('div');
    panel.id        = PANEL_ID;
    panel.className = 'tcurl-panel';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'tcurl-panel-hdr';
    hdr.innerHTML = `
      <span class="tcurl-panel-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        HTTP Client Request
      </span>
      <div class="tcurl-panel-hdr-actions">
        <button class="tcurl-share-btn" id="tcurl-share-btn">Copy All</button>
        <button class="tcurl-close-btn" id="tcurl-close-btn">✕</button>
      </div>
    `;
    panel.appendChild(hdr);

    // Body (scrollable)
    const body = document.createElement('div');
    body.className = 'tcurl-panel-body';

    // ── REQUEST section ──
    const reqSection = document.createElement('div');
    reqSection.className = 'tcurl-section';
    reqSection.innerHTML = `
      <div class="tcurl-section-hdr">
        <span class="tcurl-section-label">REQUEST</span>
        <span class="tcurl-method-badge tcurl-method-${method.toLowerCase()}">${method}</span>
        <button class="tcurl-copy-small" id="tcurl-copy-curl">Copy cURL</button>
      </div>
      <pre class="tcurl-code">${escapeHtml(curl)}</pre>
    `;
    body.appendChild(reqSection);

    // ── RESPONSE section ──
    if (status) {
      const resSection = document.createElement('div');
      resSection.className = 'tcurl-section';

      const respHeadersText = Object.entries(respHeaders).length > 0
        ? Object.entries(respHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')
        : null;

      resSection.innerHTML = `
        <div class="tcurl-section-hdr">
          <span class="tcurl-section-label">RESPONSE</span>
          <span class="tcurl-status-badge ${statusClass(status)}">${statusLabel(status)}${duration}</span>
          <button class="tcurl-copy-small" id="tcurl-copy-response">Copy Body</button>
        </div>
        ${responseBody ? `<pre class="tcurl-code">${escapeHtml(responseBody)}</pre>` : '<p class="tcurl-empty">Empty response body</p>'}
        ${respHeadersText ? `
          <details class="tcurl-details">
            <summary>Response Headers</summary>
            <pre class="tcurl-code tcurl-code-sm">${escapeHtml(respHeadersText)}</pre>
          </details>
        ` : ''}
      `;
      body.appendChild(resSection);
    } else {
      const noRes = document.createElement('div');
      noRes.className = 'tcurl-section';
      noRes.innerHTML = '<p class="tcurl-empty tcurl-empty-muted">No response captured (connection may have failed)</p>';
      body.appendChild(noRes);
    }

    panel.appendChild(body);
    document.body.appendChild(panel);

    // Wire up buttons
    document.getElementById('tcurl-close-btn').addEventListener('click', () => {
      panel.classList.remove('tcurl-panel-open');
    });

    document.getElementById('tcurl-copy-curl').addEventListener('click', async (e) => {
      await copyText(curl);
      flashButton(e.currentTarget);
    });

    const copyResponseBtn = document.getElementById('tcurl-copy-response');
    if (copyResponseBtn) {
      copyResponseBtn.addEventListener('click', async (e) => {
        await copyText(responseBody);
        flashButton(e.currentTarget);
      });
    }

    document.getElementById('tcurl-share-btn').addEventListener('click', async (e) => {
      await copyText(buildShareText(content));
      flashButton(e.currentTarget, 'Copied ✓');
    });

    // Open with animation on next tick
    requestAnimationFrame(() => panel.classList.add('tcurl-panel-open'));

    return panel;
  }

  function showUI(content) {
    removeUI();
    if (!isClientRequestPage()) return;

    // ── Trigger button ──
    const trigger = document.createElement('button');
    trigger.id        = TRIGGER_ID;
    trigger.className = 'tcurl-trigger';
    trigger.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
      Export cURL
    `;
    document.body.appendChild(trigger);

    let panelEl = null;

    trigger.addEventListener('click', () => {
      if (!panelEl || !document.getElementById(PANEL_ID)) {
        panelEl = createPanel(content);
      } else {
        panelEl.classList.toggle('tcurl-panel-open');
      }
    });
  }

  // ── Listen for entry data from the page-context interceptor ───────────────

  window.addEventListener('__tcurl:entry__', (e) => {
    try {
      const entry = JSON.parse(e.detail);
      if (isClientRequestPage()) {
        showUI(entry.content);
      }
    } catch (_) {}
  });

  // ── SPA navigation: clean up when leaving a client-request page ───────────

  let lastHref = location.href;

  function onNavigation() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!isClientRequestPage()) removeUI();
  }

  window.addEventListener('popstate', () => { lastHref = location.href; onNavigation(); });

  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      original(...args);
      onNavigation();
    };
  });

  new MutationObserver(onNavigation).observe(document, { childList: true, subtree: true });

  if (!isClientRequestPage()) removeUI();
})();
