# Telescope cURL Exporter

Chrome extension that adds a **Copy as cURL** button to [Laravel Telescope](https://laravel.com/docs/telescope) HTTP Client Request detail pages.

![Button location: top-right of the entry card header](.github/screenshot.png)

## What it does

When you open a request at `/telescope/client-requests/{id}`, the extension:

1. Fetches the entry data from the Telescope API (`/telescope-api/client-requests/{id}`)
2. Builds a ready-to-paste `curl` command with the correct method, headers, and body
3. Injects a **Copy as cURL** button in the card header
4. Copies to clipboard on click

Supports all body types Telescope captures: `application/json`, `multipart/form-data`, and `application/x-www-form-urlencoded`.

Works with any Telescope path prefix (default `/telescope` or custom).

## Installation

The extension is not published to the Chrome Web Store. Load it manually:

1. Clone this repository
   ```bash
   git clone https://github.com/victor-tramontina/telescope-curl-exporter.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the cloned directory

## Usage

Navigate to any Telescope HTTP Client Request detail page:

```
http://localhost:8000/telescope/client-requests/<uuid>
```

A **Copy as cURL** button will appear in the top-right of the entry card. Click it to copy the command to your clipboard.

## Example output

```bash
curl -X POST 'https://api.pagarme.com/v5/orders' \
  -H 'content-type: application/json' \
  -H 'authorization: BasicAuth ••••••••' \
  -H 'accept: application/json' \
  --data-raw '{"customer":{"name":"John Doe","email":"john@example.com"}}'
```

## Permissions

| Permission | Reason |
|---|---|
| `clipboardWrite` | Copy the cURL command to clipboard |
| `host_permissions: <all_urls>` | Telescope can be hosted on any URL |

The extension only activates on pages matching `/client-requests/<uuid>`. It makes no network requests to external services.
