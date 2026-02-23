const { getStore } = require("@netlify/blobs");
const { json, error, options } = require("./helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    const store = getStore({
      name: "market-data",
      siteID: process.env.BLOB_SITE_ID,
      token: process.env.BLOB_TOKEN,
    });

    const data = await store.get("latest", { type: "json" });
    if (!data) return error("No market data available", 404);

    return json(data);
  } catch (e) {
    return error(`Failed to fetch market data: ${e.message}`);
  }
};
