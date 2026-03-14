# Allocation Runtime Service (Baku)

Netlify Functions API for the allocation engine trading system.

## Workflows

### Screenshot Upload Pipeline (Client → Server → Local)

A two-host workflow where any machine can upload screenshots to a shared blob store, and a listener on this machine downloads them locally.

**Architecture:**
- **Client (any machine):** watches ~/Screenshots for new macOS screenshots, uploads to Netlify Blobs via mcp-context API
- **Server (Netlify):** mcp-context endpoint stores images in the "oncall" blob store with unique timestamped keys
- **Listener (this machine):** polls the API for new entries and copies them to ~/Documents/Screenshots

#### 1. Upload screenshots from this machine

```bash
# One-time setup: redirect macOS screenshots to ~/Screenshots
mkdir -p ~/Screenshots
defaults write com.apple.screencapture location ~/Screenshots
killall SystemUIServer

# Start the watcher
NETLIFY_AUTH_TOKEN=nfp_EJhNguVjnSF5dF2KnJjxPyU6Ghq9nsVE7201 npm run watch-screenshots
```

Verify: take a screenshot (Cmd+Shift+3), expect `✓ Uploaded` within ~2s.

#### 2. Upload from another machine

```bash
# Upload a screenshot manually via curl
curl -X PUT \
  "https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0&date=$(date +%Y-%m-%d)" \
  -H "Authorization: Bearer nfp_EJhNguVjnSF5dF2KnJjxPyU6Ghq9nsVE7201" \
  -H "Content-Type: image/png" \
  --data-binary @screenshot.png
```

#### 3. List uploaded screenshots

```bash
curl -s "https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0" \
  -H "Authorization: Bearer nfp_EJhNguVjnSF5dF2KnJjxPyU6Ghq9nsVE7201" | python3 -m json.tool
```

#### 4. Download latest to ~/Documents/Screenshots

```bash
mkdir -p ~/Documents/Screenshots
curl -s "https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0" \
  -H "Authorization: Bearer nfp_EJhNguVjnSF5dF2KnJjxPyU6Ghq9nsVE7201" \
  | python3 -c "
import json, sys, base64, os
data = json.load(sys.stdin)
log = data.get('latest_log', {})
if isinstance(log, dict) and log.get('type') == 'image':
    img = base64.b64decode(log['data_base64'])
    out = os.path.expanduser(f'~/Documents/Screenshots/{log[\"filename\"]}')
    open(out, 'wb').write(img)
    print(f'Saved: {out}')
else:
    print('Latest entry is not an image')
"
```

### Key Details

- **Auth token:** `NETLIFY_AUTH_TOKEN` env var (same token used by both client uploads and server-side blob storage)
- **Blob store:** Netlify Blobs, store name `oncall`, site `3d014fc3-e919-4b4d-b374-e8606dee50df`
- **Key format:** `{service}/{date}/{unix_timestamp}.{ext}` — each upload gets a unique key, no overwrites
- **Supported formats:** image/png, image/jpeg
- **Polling:** 250ms for first 10s (fast startup), then 1s intervals
- **macOS TCC:** uses Spotlight (`mdfind`) to discover screenshots, bypassing Desktop permission restrictions
