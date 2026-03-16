const { json, error, options, blobUrl, blobHeaders, putBlob } = require("./helpers");

const UPLOAD_STORE = "uploads";
const ONCALL_STORE = "oncall";

// Max chunk size: 4MB (safe margin under Netlify's 6MB request limit after base64 overhead)
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

function authenticate(event) {
  const auth = event.headers["authorization"] || event.headers["Authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== process.env.NETLIFY_AUTH_TOKEN) {
    return error("Unauthorized — provide Authorization: Bearer <NETLIFY_AUTH_TOKEN>", 401);
  }
  return null;
}

/**
 * POST /api/blob-upload/init
 * Body: { service, date, filename, totalChunks, totalBytes }
 * Returns: { uploadId, chunkUrl }
 */
async function handleInit(event) {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return error("Request body must be valid JSON", 400);
  }

  const { service, date, filename, totalChunks, totalBytes } = body;

  if (!service || !date || !filename || !totalChunks) {
    return error("Required fields: service, date, filename, totalChunks", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error("Date must be in YYYY-MM-DD format", 400);
  }
  if (!filename.endsWith(".zip")) {
    return error("Only .zip files are supported", 400);
  }
  if (totalChunks < 1 || totalChunks > 500) {
    return error("totalChunks must be between 1 and 500", 400);
  }

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const manifest = {
    uploadId,
    service,
    date,
    filename,
    totalChunks,
    totalBytes: totalBytes || null,
    chunksReceived: [],
    status: "in_progress",
    createdAt: new Date().toISOString(),
  };

  const manifestKey = encodeURIComponent(`${uploadId}/manifest`);
  await fetch(blobUrl(UPLOAD_STORE, manifestKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });

  return json({ uploadId, totalChunks, maxChunkBytes: MAX_CHUNK_BYTES }, 201);
}

/**
 * PUT /api/blob-upload/chunk?uploadId=X&index=N
 * Body: raw binary chunk (base64-encoded by Netlify when isBase64Encoded)
 */
async function handleChunk(event) {
  const uploadId = event.queryStringParameters?.uploadId;
  const indexStr = event.queryStringParameters?.index;

  if (!uploadId || indexStr == null) {
    return error("Required query params: uploadId, index", 400);
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0) {
    return error("index must be a non-negative integer", 400);
  }

  if (!event.body) {
    return error("Request body (chunk data) is required", 400);
  }

  // Fetch manifest to validate
  const manifestKey = encodeURIComponent(`${uploadId}/manifest`);
  const manifestResp = await fetch(blobUrl(UPLOAD_STORE, manifestKey), {
    headers: blobHeaders(),
  });
  if (!manifestResp.ok) {
    return error(`Upload session not found: ${uploadId}`, 404);
  }

  const manifest = await manifestResp.json();
  if (manifest.status !== "in_progress") {
    return error(`Upload already ${manifest.status}`, 409);
  }
  if (index >= manifest.totalChunks) {
    return error(`Chunk index ${index} exceeds totalChunks ${manifest.totalChunks}`, 400);
  }

  // Store the chunk as raw binary
  const chunkData = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body);

  if (chunkData.length > MAX_CHUNK_BYTES) {
    return error(`Chunk exceeds max size of ${MAX_CHUNK_BYTES} bytes`, 413);
  }

  const chunkKey = encodeURIComponent(`${uploadId}/chunk-${String(index).padStart(5, "0")}`);
  const chunkResp = await fetch(blobUrl(UPLOAD_STORE, chunkKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "application/octet-stream" },
    body: chunkData,
  });

  if (!chunkResp.ok) {
    return error(`Failed to store chunk: ${chunkResp.status}`, 500);
  }

  // Update manifest with received chunk
  if (!manifest.chunksReceived.includes(index)) {
    manifest.chunksReceived.push(index);
    manifest.chunksReceived.sort((a, b) => a - b);
  }
  await fetch(blobUrl(UPLOAD_STORE, manifestKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });

  return json({
    uploadId,
    chunkIndex: index,
    chunkSize: chunkData.length,
    chunksReceived: manifest.chunksReceived.length,
    totalChunks: manifest.totalChunks,
    complete: manifest.chunksReceived.length === manifest.totalChunks,
  });
}

/**
 * POST /api/blob-upload/complete?uploadId=X
 * Reassembles all chunks into the final blob in the oncall store.
 */
async function handleComplete(event) {
  const uploadId = event.queryStringParameters?.uploadId;
  if (!uploadId) {
    return error("Required query param: uploadId", 400);
  }

  // Fetch manifest
  const manifestKey = encodeURIComponent(`${uploadId}/manifest`);
  const manifestResp = await fetch(blobUrl(UPLOAD_STORE, manifestKey), {
    headers: blobHeaders(),
  });
  if (!manifestResp.ok) {
    return error(`Upload session not found: ${uploadId}`, 404);
  }

  const manifest = await manifestResp.json();
  if (manifest.status === "completed") {
    return error("Upload already completed", 409);
  }

  // Check all chunks are present
  if (manifest.chunksReceived.length !== manifest.totalChunks) {
    const missing = [];
    for (let i = 0; i < manifest.totalChunks; i++) {
      if (!manifest.chunksReceived.includes(i)) missing.push(i);
    }
    return error(`Missing chunks: [${missing.join(", ")}]. Received ${manifest.chunksReceived.length}/${manifest.totalChunks}`, 400);
  }

  // Read and concatenate all chunks in order
  const chunks = [];
  for (let i = 0; i < manifest.totalChunks; i++) {
    const chunkKey = encodeURIComponent(`${uploadId}/chunk-${String(i).padStart(5, "0")}`);
    const resp = await fetch(blobUrl(UPLOAD_STORE, chunkKey), {
      headers: blobHeaders(),
    });
    if (!resp.ok) {
      return error(`Failed to read chunk ${i}: ${resp.status}`, 500);
    }
    chunks.push(Buffer.from(await resp.arrayBuffer()));
  }

  const assembled = Buffer.concat(chunks);

  // Store final blob in oncall store
  const ts = Math.floor(Date.now() / 1000);
  const finalKey = `${manifest.service}/${manifest.date}/${ts}-${manifest.filename}`;
  const encodedFinalKey = encodeURIComponent(finalKey);

  const storeResp = await fetch(blobUrl(ONCALL_STORE, encodedFinalKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "application/zip" },
    body: assembled,
  });

  if (!storeResp.ok) {
    return error(`Failed to store assembled blob: ${storeResp.status}`, 500);
  }

  // Mark upload as completed
  manifest.status = "completed";
  manifest.completedAt = new Date().toISOString();
  manifest.finalKey = finalKey;
  manifest.finalBytes = assembled.length;
  await fetch(blobUrl(UPLOAD_STORE, manifestKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });

  // Clean up chunk blobs (best-effort, don't fail the request)
  for (let i = 0; i < manifest.totalChunks; i++) {
    const chunkKey = encodeURIComponent(`${uploadId}/chunk-${String(i).padStart(5, "0")}`);
    fetch(blobUrl(UPLOAD_STORE, chunkKey), {
      method: "DELETE",
      headers: blobHeaders(),
    }).catch(() => {});
  }

  return json({
    message: "Upload complete",
    key: finalKey,
    totalBytes: assembled.length,
    totalChunks: manifest.totalChunks,
  });
}

/**
 * GET /api/blob-upload/status?uploadId=X
 * Returns upload progress.
 */
async function handleStatus(event) {
  const uploadId = event.queryStringParameters?.uploadId;
  if (!uploadId) {
    return error("Required query param: uploadId", 400);
  }

  const manifestKey = encodeURIComponent(`${uploadId}/manifest`);
  const resp = await fetch(blobUrl(UPLOAD_STORE, manifestKey), {
    headers: blobHeaders(),
  });
  if (!resp.ok) {
    return error(`Upload session not found: ${uploadId}`, 404);
  }

  const manifest = await resp.json();
  return json({
    uploadId: manifest.uploadId,
    status: manifest.status,
    filename: manifest.filename,
    totalChunks: manifest.totalChunks,
    chunksReceived: manifest.chunksReceived.length,
    totalBytes: manifest.totalBytes,
    createdAt: manifest.createdAt,
    completedAt: manifest.completedAt || null,
    finalKey: manifest.finalKey || null,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  const authError = authenticate(event);
  if (authError) return authError;

  // Route by path suffix and method
  // event.path is the rewritten path; rawUrl has the original request URL
  const raw = event.rawUrl || event.path || "";
  const suffix = raw.includes("/blob-upload") ? raw.split("/blob-upload").pop().split("?")[0] : "";

  try {
    if (event.httpMethod === "POST" && (suffix === "/init" || suffix === "")) {
      return await handleInit(event);
    }
    if (event.httpMethod === "PUT" && suffix === "/chunk") {
      return await handleChunk(event);
    }
    if (event.httpMethod === "POST" && suffix === "/complete") {
      return await handleComplete(event);
    }
    if (event.httpMethod === "GET" && suffix === "/status") {
      return await handleStatus(event);
    }
    return error("Not found. Use /init, /chunk, /complete, or /status", 404);
  } catch (e) {
    return error(`Upload failed: ${e.message}`);
  }
};
