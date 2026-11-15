// Fixture test: validates the FULL risk path (HTTP -> matrix -> verdict)
// against a stubbed JSON-RPC server that returns canned on-chain state.
//
// Why a stub: on BSC mainnet, 928 sampled real addresses (recent traders,
// CAKE traders, senders from 2022-2025 blocks, both user wallets) all
// returned zero allowances for the curated tokens x spenders — modern UIs
// use exact-amount approvals and signature permits, so live unlimited
// approvals are rare in a random sample. The stub proves the agent
// correctly reports HIGH RISK / unlimited when such an approval EXISTS.
// The stub only replaces the chain; the agent code, HTTP layer, and risk
// logic run for real. Live mainnet results are recorded separately.
//
// Usage: node test/fixture-test.js
// Exits 0 on PASS, 1 on FAIL.
const http = require("http");

const STUB_PORT = 18749;
const OWNER = "0x1111111111111111111111111111111111111111";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
const PCS_V2 = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const MASTERCHEF = "0x73feaa1eE314F8c655E354234017bE2193C9E24E";
const UNKNOWN_SPENDER = "0xDeaDbeefdEAdbeefdEAdbeefdEAdbeefdEAdbeef"; // not in the known list
const MAX = (1n << 256n) - 1n;

function hex32(n) {
  return "0x" + n.toString(16).padStart(64, "0");
}

function handleRpc(body) {
  const req = JSON.parse(body);
  const items = Array.isArray(req) ? req : [req];
  const out = items.map((it) => {
    if (it.method === "eth_blockNumber") return { jsonrpc: "2.0", id: it.id, result: "0x100" };
    if (it.method === "eth_getCode") return { jsonrpc: "2.0", id: it.id, result: "0x" };
    if (it.method === "eth_getLogs") {
      // One Approval event: OWNER approved UNKNOWN_SPENDER for unlimited USDT.
      const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
      return { jsonrpc: "2.0", id: it.id, result: [{
        address: USDT,
        topics: [
          "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
          pad(OWNER),
          pad(UNKNOWN_SPENDER),
        ],
        data: hex32(MAX),
        blockNumber: "0x90",
        transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }] };
    }
    if (it.method === "eth_call") {
      const { to, data } = it.params[0];
      const sel = data.slice(0, 10);
      if (sel === "0xdd62ed3e") {
        // allowance(owner, spender): data = 0x + 8-char selector + 64-char
        // owner word + 64-char spender word; spender address = last 40 chars.
        const spender = "0x" + data.slice(98, 138);
        const t = to.toLowerCase(), s = spender.toLowerCase();
        if (t === USDT.toLowerCase() && s === PCS_V2.toLowerCase()) return { jsonrpc: "2.0", id: it.id, result: hex32(MAX) };
        if (t === USDT.toLowerCase() && s === UNKNOWN_SPENDER.toLowerCase()) return { jsonrpc: "2.0", id: it.id, result: hex32(MAX) };
        if (t === CAKE.toLowerCase() && s === MASTERCHEF.toLowerCase()) return { jsonrpc: "2.0", id: it.id, result: hex32(1000n * 10n ** 18n) };
        return { jsonrpc: "2.0", id: it.id, result: hex32(0n) };
      }
      if (sel === "0x70a08231") {
        // balanceOf(owner)
        if (to.toLowerCase() === USDT.toLowerCase()) return { jsonrpc: "2.0", id: it.id, result: hex32(5000n * 10n ** 18n) };
        return { jsonrpc: "2.0", id: it.id, result: hex32(0n) };
      }
      return { jsonrpc: "2.0", id: it.id, result: "0x" };
    }
    return { jsonrpc: "2.0", id: it.id, error: { code: -32601, message: "method not supported by fixture" } };
  });
  return JSON.stringify(Array.isArray(req) ? out : out[0]);
}

let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
}

const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(handleRpc(data));
  });
});

server.listen(STUB_PORT, async () => {
  process.env.BSC_RPC_URL = `http://127.0.0.1:${STUB_PORT}`;
  process.env.BSC_LOGS_RPC_URL = `http://127.0.0.1:${STUB_PORT}`;
  const { checkAddress } = require("../lib/check");
  try {
    // scanBlocks>0 exercises the event-scan path (unknown spender).
    const report = await checkAddress(OWNER, { scanBlocks: 50000 });
    require("fs").writeFileSync(
      require("path").join(__dirname, "last-run", "fixture-unlimited-approval.json"),
      JSON.stringify(report, null, 2)
    );
    check("fixture report returns 200-shape object", !!report && report.address === OWNER);
    check("riskLevel is high", report.riskLevel === "high", `got ${report.riskLevel}`);
    check("riskScore is low (15)", report.riskScore === 15, `got ${report.riskScore}`);
    check("verdict says HIGH RISK", /HIGH RISK/.test(report.verdict));
    check("3 active allowances found", report.summary.activeAllowances === 3, `got ${report.summary.activeAllowances}`);
    check("2 unlimited allowances", report.summary.unlimited === 2, `got ${report.summary.unlimited}`);
    check("1 unknown spender", report.summary.unknownSpenders === 1, `got ${report.summary.unknownSpenders}`);
    check("event scan ran (not skipped)", report.summary.eventScanSkipped === false);
    const usdt = report.allowances.find((a) => a.token === "USDT" && a.spenderKnown);
    check("USDT -> PancakeSwap V2 is unlimited (known spender, medium)", !!(usdt && usdt.unlimited && usdt.allowance === "unlimited" && usdt.risk === "medium"), JSON.stringify(usdt));
    check("USDT balance shown (5000)", usdt && usdt.balance === "5000", `got ${usdt && usdt.balance}`);
    const cake = report.allowances.find((a) => a.token === "CAKE");
    check("CAKE -> MasterChef is limited 1000, low risk", !!(cake && !cake.unlimited && cake.allowance === "1000" && cake.risk === "low"), JSON.stringify(cake));
    const unk = report.allowances.find((a) => !a.spenderKnown);
    check("unknown spender USDT allowance is unlimited + high risk", !!(unk && unk.unlimited && unk.risk === "high" && unk.token === "USDT"), JSON.stringify(unk));
    check("allowances sorted riskiest first", report.allowances[0].risk === "high");
  } catch (e) {
    check("fixture run completes", false, String((e && e.message) || e));
  } finally {
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
});
