const { json, error, options, getBlob } = require("./helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    const data = await getBlob("market-data", "latest");
    if (!data) return error("No market data available", 404);

    return json(data);
  } catch (e) {
    return error(`Failed to fetch market data: ${e.message}`);
  }
};
