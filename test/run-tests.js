// End-to-end tests for Approval Guard.
// Usage: BASE_URL=http://localhost:3000 node test/run-tests.mjs
// Hits the live BSC public RPC — read-only. Prints a PASS/FAIL line per case
// and saves full reports to test/last-run/ for the writeup.
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "last-run");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function post(addr, extra = {}) {
  const r = await fetch(`${BASE}/api/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: addr, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

(async () => {
  // 0. Health
  const h = await fetch(`${BASE}/api/`).then((r) => r.json()).catch(() => null);
  check("GET /api/ health ok", h && h.status === "ok");

  // 1. Invalid address -> 400
  const bad = await post("not-an-address");
  check("invalid address -> 400", bad.status === 400 && bad.j.error === "invalid_address");

  // 2. Burn address: expect clean (no approvals possible)
  const burn = await post("0x000000000000000000000000000000000000dead");
  fs.writeFileSync(path.join(OUT, "burn-address.json"), JSON.stringify(burn.j, null, 2));
  check("burn address -> 200 + clean", burn.status === 200 && burn.j.riskLevel === "clean" && burn.j.summary.activeAllowances === 0,
    `risk=${burn.j.riskLevel} allowances=${burn.j.summary && burn.j.summary.activeAllowances}`);

  // 3. User main wallet: real-world address, expected to have approvals
  const main = await post("0xce0a13d8aed5f8227c79d750ce42032753037037");
  fs.writeFileSync(path.join(OUT, "main-wallet.json"), JSON.stringify(main.j, null, 2));
  check("main wallet -> 200", main.status === 200, `risk=${main.j.riskLevel} score=${main.j.riskScore} allowances=${main.j.summary && main.j.summary.activeAllowances} unlimited=${main.j.summary && main.j.summary.unlimited} tookMs=${main.j.tookMs}`);

  // 4. User agentic wallet
  const ag = await post("0xE8BF9bb3A4A63385B6c1e0e4F44AE23c883c16C3");
  fs.writeFileSync(path.join(OUT, "agentic-wallet.json"), JSON.stringify(ag.j, null, 2));
  check("agentic wallet -> 200", ag.status === 200, `risk=${ag.j.riskLevel} score=${ag.j.riskScore} allowances=${ag.j.summary && ag.j.summary.activeAllowances} tookMs=${ag.j.tookMs}`);

  // 5. scanBlocks=0 still works (matrix only)
  const noscan = await post("0x000000000000000000000000000000000000dead", { scanBlocks: 0 });
  check("scanBlocks=0 -> 200 + clean", noscan.status === 200 && noscan.j.riskLevel === "clean");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
