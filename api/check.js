// Vercel serverless endpoint: POST /api/check
// Body: { "address": "0x...", "scanBlocks": 50000? }
// Returns the approval risk report as JSON. Read-only, keyless.
const { checkAddress, isAddress } = require("../lib/check");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({
      agent: "approval-guard",
      usage: "POST {\"address\": \"0x...\"} to this endpoint. Optional: {\"scanBlocks\": 0..200000}.",
      example: { address: "0xce0a13d8aed5f8227c79d750ce42032753037037" },
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid_json" }); }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "invalid_json" });

  const address = body.address;
  if (!isAddress(address)) {
    return res.status(400).json({ error: "invalid_address", detail: "address must be a 0x-prefixed 40-hex-char EVM address" });
  }
  try {
    const report = await checkAddress(address, { scanBlocks: body.scanBlocks });
    return res.status(200).json(report);
  } catch (e) {
    console.error("check failed:", e);
    return res.status(502).json({ error: "upstream_rpc_failed", detail: String((e && e.message) || e) });
  }
};
