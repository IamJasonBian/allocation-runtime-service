/**
 * Finance Context API
 * Provides access to financial planning data from Excel
 *
 * Endpoints:
 * - GET /api/finance-context - Get all finance data or filter by fiscal year
 * - GET /api/finance-context?fiscalYear=FY25-Nov - Get specific fiscal year
 * - GET /api/finance-context?category=Liquid - Get filtered by category
 * - PUT /api/finance-context - Update finance data (requires auth)
 */

const { json, error, options, listBlobs, blobUrl, blobHeaders } = require("./helpers");
const fs = require("fs");
const path = require("path");

const FINANCE_STORE = "finance";
const LOCAL_DATA_PATH = path.join(__dirname, "../../public/finance-data.json");

/**
 * Load finance data from local JSON file
 */
function loadLocalFinanceData() {
  try {
    if (fs.existsSync(LOCAL_DATA_PATH)) {
      const data = fs.readFileSync(LOCAL_DATA_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Failed to load local finance data:", e.message);
  }
  return null;
}

/**
 * Get latest finance data from blob store or local file
 */
async function getFinanceData() {
  try {
    const blobs = await listBlobs(FINANCE_STORE);

    if (blobs.length > 0) {
      // Sort by key (includes timestamp) and get latest
      blobs.sort((a, b) => b.key.localeCompare(a.key));
      const latest = blobs[0];

      const resp = await fetch(blobUrl(FINANCE_STORE, latest.key), {
        headers: blobHeaders(),
      });

      if (resp.ok) {
        return await resp.json();
      }
    }
  } catch (e) {
    console.error("Failed to fetch from blob store:", e.message);
  }

  // Fallback to local file
  return loadLocalFinanceData();
}

/**
 * Handle GET requests
 */
async function handleGet(event) {
  const fiscalYear = event.queryStringParameters?.fiscalYear;
  const category = event.queryStringParameters?.category;
  const assetType = event.queryStringParameters?.assetType;

  const data = await getFinanceData();

  if (!data) {
    return error("Finance data not available", 404);
  }

  // Return full data if no filters
  if (!fiscalYear && !category && !assetType) {
    return json(data);
  }

  // Filter by fiscal year
  if (fiscalYear) {
    if (!data.fiscalYears[fiscalYear]) {
      return error(`Fiscal year not found: ${fiscalYear}`, 404);
    }

    let fyData = data.fiscalYears[fiscalYear];

    // Further filter by category or assetType
    if (category) {
      fyData = {
        assets: fyData.assets.filter((a) => a.category === category),
        liabilities: fyData.liabilities.filter((l) => l.category === category),
      };
    }

    if (assetType) {
      fyData = {
        assets: fyData.assets.filter((a) => a.name.includes(assetType)),
        liabilities: fyData.liabilities.filter((l) => l.name.includes(assetType)),
      };
    }

    return json({
      metadata: data.metadata,
      fiscalYear,
      data: fyData,
    });
  }

  // Filter across all fiscal years by category or assetType
  const filtered = {
    metadata: data.metadata,
    results: {},
  };

  Object.entries(data.fiscalYears).forEach(([fy, fyData]) => {
    let assets = fyData.assets;
    let liabilities = fyData.liabilities;

    if (category) {
      assets = assets.filter((a) => a.category === category);
      liabilities = liabilities.filter((l) => l.category === category);
    }

    if (assetType) {
      assets = assets.filter((a) => a.name.includes(assetType));
      liabilities = liabilities.filter((l) => l.name.includes(assetType));
    }

    if (assets.length > 0 || liabilities.length > 0) {
      filtered.results[fy] = { assets, liabilities };
    }
  });

  return json(filtered);
}

/**
 * Handle PUT requests - store updated finance data
 */
async function handlePut(event) {
  const body = event.body;
  if (!body) {
    return error("Request body is required", 400);
  }

  let financeData;
  try {
    financeData = JSON.parse(body);
  } catch (e) {
    return error("Invalid JSON in request body", 400);
  }

  // Validate structure
  if (!financeData.metadata || !financeData.fiscalYears) {
    return error("Invalid finance data structure. Must include 'metadata' and 'fiscalYears'", 400);
  }

  // Store in blob with timestamp
  const ts = Math.floor(Date.now() / 1000);
  const key = `finance-data/${ts}.json`;
  const encodedKey = encodeURIComponent(key);

  const resp = await fetch(blobUrl(FINANCE_STORE, encodedKey), {
    method: "PUT",
    headers: { ...blobHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(financeData),
  });

  if (!resp.ok) {
    return error(`Failed to store finance data: ${resp.status}`, 500);
  }

  return json({ message: "Finance data stored successfully", key }, 201);
}

/**
 * Authenticate requests for PUT operations
 */
function authenticate(event) {
  const auth = event.headers["authorization"] || event.headers["Authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== process.env.NETLIFY_AUTH_TOKEN) {
    return error("Unauthorized — provide Authorization: Bearer <NETLIFY_AUTH_TOKEN>", 401);
  }
  return null;
}

/**
 * Main handler
 */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();

  try {
    if (event.httpMethod === "GET") {
      return await handleGet(event);
    }

    if (event.httpMethod === "PUT") {
      const authError = authenticate(event);
      if (authError) return authError;
      return await handlePut(event);
    }

    return error("Method not allowed", 405);
  } catch (e) {
    console.error("Finance context error:", e);
    return error(`Failed to process finance context: ${e.message}`);
  }
};
