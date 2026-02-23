const { STORE_NAME, json, error, options, listBlobs, getBlob } = require("./helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  const key = event.queryStringParameters?.key;

  try {
    // If a specific key is requested, return that snapshot
    if (key) {
      const data = await getBlob(STORE_NAME, key);
      if (!data) return error(`Snapshot '${key}' not found`, 404);
      return json({ snapshot_key: key, data });
    }

    // Otherwise list all snapshot keys
    const blobs = await listBlobs(STORE_NAME);
    const keys = blobs.map((b) => b.key).sort().reverse();

    return json({
      count: keys.length,
      snapshots: keys.slice(0, 50),
    });
  } catch (e) {
    return error(`Failed to fetch snapshots: ${e.message}`);
  }
};
