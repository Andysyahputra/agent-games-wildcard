// Health check: GET /
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    status: "ok",
    agent: "approval-guard",
    track: "wildcard",
    network: "BSC (chain 56)",
    endpoint: "POST /api/check {\"address\": \"0x...\"}",
    demo: "/index.html",
  });
};
