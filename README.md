Core Services

* API — https://route-runtime-service.netlify.app/api/health	
* Swagger UI — https://route-runtime-service.netlify.app/docs	
* Dashboard — https://route-runtime-service.netlify.app/dashboard	
* Snapshots — https://route-runtime-service.netlify.app/api/snapshots 
* State — https://route-runtime-service.netlify.app/api/state


Oncall Resolution for TTs (MCP layer)

* **GET** https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0
* **PUT** https://route-runtime-service.netlify.app/api/mcp-context?service=allocation-engine-2.0&date=2026-03-02

**PUT** generates a unix timestamp for subsequent append only operations
This endpoint requires an instance of NETLIFY_AUTH_TOKEN


Screenshot Watcher

Monitors ~/Screenshots for new macOS screenshots and uploads them to mcp-context.

**Setup (one-time):**
```bash
# Redirect macOS screenshots to ~/Screenshots (avoids TCC permission issues)
mkdir -p ~/Screenshots
defaults write com.apple.screencapture location ~/Screenshots
killall SystemUIServer
```

**Start the watcher:**
```bash
NETLIFY_AUTH_TOKEN=nfp_EJhNguVjnSF5dF2KnJjxPyU6Ghq9nsVE7201 WATCH_DIR=$HOME/Screenshots npm run watch-screenshots
```

**Verify it's running:** take a screenshot with `Cmd+Shift+3` — you should see a `✓ Uploaded` line within ~2 seconds.
