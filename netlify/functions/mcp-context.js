const { json, error, options, listBlobs, blobUrl, blobHeaders } = require("./helpers");

const ONCALL_STORE = "oncall";

function decodeKey(raw) {
  return decodeURIComponent(raw);
}

async function handleGet(event) {
  const service = event.queryStringParameters?.service;
  const blobs = await listBlobs(ONCALL_STORE);

  const entries = blobs.map((b) => {
    const decoded = decodeKey(b.key);
    const parts = decoded.split("/");
    return { rawKey: b.key, decoded, service: parts[0], timestamp: parts.slice(1).join("/") };
  });

  if (!service) {
    return json({
      count: entries.length,
      entries: entries.map(({ decoded, service, timestamp }) => ({
        key: decoded,
        service,
        timestamp,
      })),
    });
  }

  const serviceEntries = entries.filter((e) => e.service === service);

  if (!serviceEntries.length) {
    return error(`No oncall logs found for service: ${service}`, 404);
  }

  serviceEntries.sort((a, b) => a.decoded.localeCompare(b.decoded));
  const latest = serviceEntries[serviceEntries.length - 1];

  const resp = await fetch(blobUrl(ONCALL_STORE, latest.rawKey), {
    headers: blobHeaders(),
  });
  if (!resp.ok) return error(`Failed to fetch oncall log: ${resp.status}`, 500);

  const ct = resp.headers.get("content-type") || "";
  const content = ct.includes("application/json")
    ? await resp.json()
    : await resp.text();

  return json({
    service,
    key: latest.decoded,
    available_logs: serviceEntries.map((e) => e.decoded),
    latest_log: content,
  });
}

async function handlePut(event) {
  const service = event.queryStringParameters?.service;
  const date = event.queryStringParameters?.date;

  if (!service || !date) {
    return error("Both 'service' and 'date' query parameters are required", 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return error("Date must be in YYYY-MM-DD format", 400);
  }

  const body = event.body;
  if (!body) {
    return error("Request body is required", 400);
  }

  const ts = Math.floor(Date.now() / 1000);
  const key = `${service}/${date}/${ts}`;
  const encodedKey = encodeURIComponent(key);

  const resp = await fetch(blobUrl(ONCALL_STORE, encodedKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "text/plain" },
    body,
  });

  if (!resp.ok) {
    return error(`Failed to store oncall log: ${resp.status}`, 500);
  }

  return json({ message: "Oncall log stored", key }, 201);
}

function authenticate(event) {
  const auth = event.headers["authorization"] || event.headers["Authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== process.env.NETLIFY_AUTH_TOKEN) {
    return error("Unauthorized — provide Authorization: Bearer <NETLIFY_AUTH_TOKEN>", 401);
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  const authError = authenticate(event);
  if (authError) return authError;

  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "PUT") return await handlePut(event);
    return error("Method not allowed", 405);
  } catch (e) {
    return error(`Failed to process oncall context: ${e.message}`);
  }
};
