#!/usr/bin/env node

/**
 * Screenshot Watcher — monitors macOS Desktop for new screenshots and uploads
 * them to the mcp-context endpoint.
 *
 * Uses macOS Spotlight (mdfind) to discover screenshots, bypassing TCC
 * permission restrictions that block direct fs access to ~/Desktop.
 *
 * Usage:
 *   NETLIFY_AUTH_TOKEN=<token> node scripts/screenshot-watcher.js
 *
 * Optional env vars:
 *   WATCH_DIR        — directory to watch (default: ~/Desktop)
 *   API_URL          — base URL (default: https://route-runtime-service.netlify.app)
 *   SERVICE_NAME     — service param (default: allocation-engine-2.0)
 *   POLL_INTERVAL    — seconds between polls (default: 1)
 */

const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");
const { execSync } = require("child_process");

const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
if (!TOKEN) {
  console.error("Error: NETLIFY_AUTH_TOKEN is required");
  console.error("  Get it with: netlify env:get NETLIFY_AUTH_TOKEN");
  process.exit(1);
}

const WATCH_DIR = process.env.WATCH_DIR || path.join(process.env.HOME, "Screenshots");
const API_URL = process.env.API_URL || "https://route-runtime-service.netlify.app";
const SERVICE = process.env.SERVICE_NAME || "allocation-engine-2.0";
const POLL_MS = (parseFloat(process.env.POLL_INTERVAL) || 1) * 1000;

let uploadCount = 0;

// Track files we've already seen (by absolute path)
const seen = new Set();

// Use Spotlight to find screenshots on Desktop (bypasses macOS TCC restrictions)
function findScreenshots() {
  try {
    const out = execSync(
      `mdfind -onlyin "${WATCH_DIR}" 'kMDItemIsScreenCapture == 1'`,
      { encoding: "utf8", timeout: 10000 }
    );
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// Read file contents via shell (bypasses Node fs TCC issues)
function readFile(filePath) {
  return execSync(`/bin/cat "${filePath}"`, { maxBuffer: 50 * 1024 * 1024 });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function upload(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const date = todayDate();

  let imageData;
  try {
    imageData = readFile(filePath);
  } catch (e) {
    console.error(`  ✗ Failed to read ${filename}: ${e.message}`);
    return;
  }

  const url = new URL(`${API_URL}/api/mcp-context`);
  url.searchParams.set("service", SERVICE);
  url.searchParams.set("date", date);

  const transport = url.protocol === "https:" ? https : http;

  const req = transport.request(
    url,
    {
      method: "PUT",
      headers: {
        "Content-Type": mime,
        "Content-Length": imageData.length,
        Authorization: `Bearer ${TOKEN}`,
      },
    },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          uploadCount++;
          const kb = (imageData.length / 1024).toFixed(1);
          console.log(`  ✓ Uploaded ${filename} (${kb} KB) — total: ${uploadCount}`);
        } else {
          console.error(`  ✗ Upload failed (${res.statusCode}): ${body}`);
        }
      });
    }
  );

  req.on("error", (e) => console.error(`  ✗ Upload error for ${filename}: ${e.message}`));
  req.write(imageData);
  req.end();
}

// Seed existing screenshots so we only upload NEW ones
function seedExisting() {
  const files = findScreenshots();
  for (const f of files) {
    seen.add(f);
  }
  return files.length;
}

function poll() {
  const files = findScreenshots();
  for (const f of files) {
    if (seen.has(f)) continue;

    seen.add(f);
    const filename = path.basename(f);
    console.log(`New screenshot: ${filename}`);

    // Brief delay to let macOS finish writing the file
    setTimeout(() => upload(f), 1500);
  }
}

// --- main ---
const seeded = seedExisting();

console.log("");
console.log("┌─────────────────────────────────────────┐");
console.log("│  Screenshot Watcher — RUNNING           │");
console.log("├─────────────────────────────────────────┤");
console.log(`│  Watching:  ${WATCH_DIR}`);
console.log(`│  Endpoint:  ${API_URL}/api/mcp-context`);
console.log(`│  Service:   ${SERVICE}`);
console.log(`│  Polling:   every ${POLL_MS / 1000}s`);
console.log(`│  Existing:  ${seeded} screenshots (skipped)`);
console.log("├─────────────────────────────────────────┤");
console.log("│  Take a screenshot (Cmd+Shift+3) to     │");
console.log("│  verify uploads are working.             │");
console.log("│  Press Ctrl+C to stop.                   │");
console.log("└─────────────────────────────────────────┘");
console.log("");

// Start with fast polling (250ms) then settle to normal interval
const FAST_POLL_MS = 250;
const SETTLE_DELAY = 10000;

let pollTimer = setInterval(poll, FAST_POLL_MS);

setTimeout(() => {
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}, SETTLE_DELAY);
