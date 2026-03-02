const { json, error, options, listBlobs, blobUrl, blobHeaders } = require("./helpers");

const ONCALL_STORE = "oncall";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    const service = event.queryStringParameters?.service;

    if (!service) {
      const blobs = await listBlobs(ONCALL_STORE);
      const entries = blobs.map((b) => {
        const parts = b.key.split("/");
        return { key: b.key, service: parts[0], timestamp: parts.slice(1).join("/") };
      });
      return json({ count: entries.length, entries });
    }

    const blobs = await listBlobs(ONCALL_STORE);
    const serviceBlobs = blobs.filter((b) => b.key.startsWith(`${service}/`));

    if (!serviceBlobs.length) {
      return error(`No oncall logs found for service: ${service}`, 404);
    }

    const keys = serviceBlobs.map((b) => b.key).sort();
    const latestKey = keys[keys.length - 1];

    const resp = await fetch(blobUrl(ONCALL_STORE, latestKey), {
      headers: blobHeaders(),
    });
    if (!resp.ok) return error(`Failed to fetch oncall log: ${resp.status}`, 500);

    const ct = resp.headers.get("content-type") || "";
    const content = ct.includes("application/json")
      ? await resp.json()
      : await resp.text();

    return json({
      service,
      key: latestKey,
      available_logs: keys,
      latest_log: content,
    });
  } catch (e) {
    return error(`Failed to fetch oncall context: ${e.message}`);
  }
};
