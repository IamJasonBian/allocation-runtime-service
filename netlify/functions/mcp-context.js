const { json, error, options, listBlobs, blobUrl, blobHeaders } = require("./helpers");

const ONCALL_STORE = "oncall";

// Blob keys come back with %2F instead of / — decode for display/filtering
function decodeKey(raw) {
  return decodeURIComponent(raw);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    const service = event.queryStringParameters?.service;
    const blobs = await listBlobs(ONCALL_STORE);

    // Build a map of decoded key -> raw key
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
  } catch (e) {
    return error(`Failed to fetch oncall context: ${e.message}`);
  }
};
