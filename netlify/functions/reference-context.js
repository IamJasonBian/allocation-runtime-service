const { json, error, options, listBlobs, blobUrl, blobHeaders } = require("./helpers");

const STORE = "reference-context";

/**
 * PUT /api/reference-context?name=my-dataset.zip&chunk=0&total=10
 *
 * For small files (< 5MB), omit chunk/total and upload in one shot.
 * For large files, split into chunks and upload each with chunk index + total.
 */
async function handlePut(event) {
  const name = event.queryStringParameters?.name;
  if (!name) return error("'name' query parameter is required", 400);

  const body = event.body;
  if (!body) return error("Request body is required", 400);

  const chunk = event.queryStringParameters?.chunk;
  const total = event.queryStringParameters?.total;
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "application/octet-stream";

  const storeBody = event.isBase64Encoded ? Buffer.from(body, "base64") : body;

  if (chunk != null && total != null) {
    // Chunked upload — store each chunk separately
    const chunkIdx = parseInt(chunk, 10);
    const totalChunks = parseInt(total, 10);
    if (isNaN(chunkIdx) || isNaN(totalChunks) || chunkIdx < 0 || chunkIdx >= totalChunks) {
      return error("'chunk' must be 0..total-1 and 'total' must be a positive integer", 400);
    }

    const paddedChunk = String(chunkIdx).padStart(6, "0");
    const chunkKey = encodeURIComponent(`${name}/_chunks/${paddedChunk}`);

    const resp = await fetch(blobUrl(STORE, chunkKey), {
      method: "PUT",
      headers: { ...blobHeaders(), "Content-Type": contentType },
      body: storeBody,
    });
    if (!resp.ok) return error(`Failed to store chunk ${chunkIdx}: ${resp.status}`, 500);

    // Store metadata so we know how to reassemble
    const metaKey = encodeURIComponent(`${name}/_meta`);
    const meta = {
      name,
      total_chunks: totalChunks,
      content_type: contentType,
      updated_at: new Date().toISOString(),
    };
    const metaResp = await fetch(blobUrl(STORE, metaKey), {
      method: "PUT",
      headers: { ...blobHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    if (!metaResp.ok) return error(`Failed to store metadata: ${metaResp.status}`, 500);

    return json({ message: `Chunk ${chunkIdx}/${totalChunks} stored`, name, chunk: chunkIdx, total_chunks: totalChunks }, 201);
  }

  // Single-shot upload (no chunking)
  const key = encodeURIComponent(name);
  const resp = await fetch(blobUrl(STORE, key), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": contentType },
    body: storeBody,
  });
  if (!resp.ok) return error(`Failed to store file: ${resp.status}`, 500);

  return json({ message: "File stored", name, content_type: contentType }, 201);
}

/**
 * GET /api/reference-context
 *   — no params: list all stored references
 *   — ?name=foo.zip: return metadata + download info for that file
 *   — ?name=foo.zip&chunk=3: return a specific chunk's raw bytes
 */
async function handleGet(event) {
  const name = event.queryStringParameters?.name;
  const chunk = event.queryStringParameters?.chunk;

  if (!name) {
    // List all references
    const blobs = await listBlobs(STORE);
    const entries = blobs.map((b) => decodeURIComponent(b.key));

    // Group by top-level name, filtering out internal chunk/meta keys
    const files = new Map();
    for (const key of entries) {
      const topName = key.split("/_chunks/")[0].split("/_meta")[0];
      if (!files.has(topName)) files.set(topName, { name: topName, chunked: false });
      if (key.includes("/_chunks/")) files.get(topName).chunked = true;
      if (key.includes("/_meta")) files.get(topName).has_meta = true;
    }

    // Also include single-shot uploads (keys without /_chunks/ or /_meta)
    const result = [];
    for (const [, info] of files) {
      result.push({ name: info.name, chunked: info.chunked });
    }

    return json({ count: result.length, files: result });
  }

  // Return specific chunk raw data
  if (chunk != null) {
    const paddedChunk = String(parseInt(chunk, 10)).padStart(6, "0");
    const chunkKey = encodeURIComponent(`${name}/_chunks/${paddedChunk}`);
    const resp = await fetch(blobUrl(STORE, chunkKey), { headers: blobHeaders() });
    if (!resp.ok) return error(`Chunk ${chunk} not found for '${name}'`, 404);

    const buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get("content-type") || "application/octet-stream";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": ct,
        "Access-Control-Allow-Origin": "*",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  }

  // Check if it's a chunked upload (has _meta)
  const metaKey = encodeURIComponent(`${name}/_meta`);
  const metaResp = await fetch(blobUrl(STORE, metaKey), { headers: blobHeaders() });

  if (metaResp.ok) {
    const meta = await metaResp.json();

    // Count how many chunks are actually stored
    const blobs = await listBlobs(STORE);
    const chunkPrefix = `${name}/_chunks/`;
    const uploadedChunks = blobs
      .map((b) => decodeURIComponent(b.key))
      .filter((k) => k.startsWith(chunkPrefix))
      .sort();

    return json({
      name,
      chunked: true,
      total_chunks: meta.total_chunks,
      uploaded_chunks: uploadedChunks.length,
      complete: uploadedChunks.length === meta.total_chunks,
      content_type: meta.content_type,
      updated_at: meta.updated_at,
    });
  }

  // Single-shot file — return it directly
  const key = encodeURIComponent(name);
  const resp = await fetch(blobUrl(STORE, key), { headers: blobHeaders() });
  if (!resp.ok) return error(`File '${name}' not found`, 404);

  const buf = Buffer.from(await resp.arrayBuffer());
  const ct = resp.headers.get("content-type") || "application/octet-stream";

  return {
    statusCode: 200,
    headers: {
      "Content-Type": ct,
      "Access-Control-Allow-Origin": "*",
    },
    body: buf.toString("base64"),
    isBase64Encoded: true,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    if (event.httpMethod === "PUT") return await handlePut(event);
    if (event.httpMethod === "GET") return await handleGet(event);
    return error("Method not allowed", 405);
  } catch (e) {
    return error(`Failed to process reference context: ${e.message}`);
  }
};
