// Runs in the PAGE context (not the extension's isolated world).
// Intercepts the XMLHttpRequest that Vue/Axios makes to the Telescope API
// and forwards the entry data to the content script via a custom event.
(function () {
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._tcurlUrl = typeof url === 'string' ? url : '';
    _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const url = this._tcurlUrl;
    // Match: /telescope-api/client-requests/{uuid}  (any host/prefix)
    if (/\/telescope-api\/client-requests\/[0-9a-f-]{36}/i.test(url)) {
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText);
          if (data && data.entry) {
            window.dispatchEvent(
              new CustomEvent('__tcurl:entry__', { detail: JSON.stringify(data.entry) })
            );
          }
        } catch (_) {}
      });
    }
    _send.apply(this, arguments);
  };
})();
