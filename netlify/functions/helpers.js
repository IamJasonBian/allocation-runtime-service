const { getStore } = require("@netlify/blobs");

const STORE_NAME = "order-book";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return {
    statusCode: status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function error(message, status = 500) {
  return json({ error: message }, status);
}

function options() {
  return { statusCode: 204, headers: CORS_HEADERS, body: "" };
}

function getBlobStore() {
  return getStore({
    name: STORE_NAME,
    siteID: process.env.BLOB_SITE_ID,
    token: process.env.BLOB_TOKEN,
  });
}

async function getLatestSnapshot() {
  const store = getBlobStore();
  const { blobs } = await store.list();
  if (!blobs.length) return null;
  // Keys are ISO timestamps sorted lexicographically — last is newest
  const sorted = blobs.map((b) => b.key).sort();
  const latestKey = sorted[sorted.length - 1];
  const data = await store.get(latestKey, { type: "json" });
  return { key: latestKey, data };
}

module.exports = { STORE_NAME, json, error, options, getLatestSnapshot, getBlobStore };
