const BLOBS_URL = "https://api.netlify.com/api/v1/blobs";
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

function blobHeaders() {
  return { Authorization: `Bearer ${process.env.BLOB_TOKEN}` };
}

function blobUrl(store, key) {
  const siteId = process.env.BLOB_SITE_ID;
  return key
    ? `${BLOBS_URL}/${siteId}/${store}/${key}`
    : `${BLOBS_URL}/${siteId}/${store}`;
}

async function listBlobs(store) {
  const resp = await fetch(blobUrl(store), { headers: blobHeaders() });
  if (!resp.ok) throw new Error(`List blobs failed: ${resp.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : data.blobs || [];
}

async function getBlob(store, key) {
  const resp = await fetch(blobUrl(store, key), { headers: blobHeaders() });
  if (!resp.ok) return null;
  return resp.json();
}

async function getLatestSnapshot() {
  const blobs = await listBlobs(STORE_NAME);
  if (!blobs.length) return null;
  const keys = blobs.map((b) => b.key).sort();
  const latestKey = keys[keys.length - 1];
  const data = await getBlob(STORE_NAME, latestKey);
  return { key: latestKey, data };
}

module.exports = { STORE_NAME, json, error, options, getLatestSnapshot, listBlobs, getBlob };
