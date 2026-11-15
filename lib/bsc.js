// Minimal keyless BSC JSON-RPC client (public endpoint, no API key).
// Uses the global fetch (Node >= 18). All calls are read-only eth_call /
// eth_getLogs / eth_blockNumber / eth_getCode — no signing, no spending.
//
// NOTE (verified 2026-11-15): the public BSC dataseeds reject eth_getLogs
// with -32005 "limit exceeded" even for a 100-block range with an address +
// topic filter; Ankr's public endpoint requires an API key and
// bsc.publicnode.com rate-limits. So the event scan can only run against a
// log-capable RPC supplied via BSC_LOGS_RPC_URL. Without it the scan is
// skipped and the report says so honestly — the allowance matrix (eth_call)
// is the primary check and works fine on the public endpoint.

const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
const LOGS_RPC_URL = process.env.BSC_LOGS_RPC_URL || ""; // optional, log-capable node
const { TOKENS } = require("./data");

const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"; // Approval(address,address,uint256)

function padAddress(addr) {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeAllowanceCall(token, owner, spender) {
  return "0xdd62ed3e" + padAddress(owner).slice(2) + padAddress(spender).slice(2);
}
function encodeBalanceCall(owner) {
  return "0x70a08231" + padAddress(owner).slice(2);
}
function encodeSymbolCall() { return "0x95d89b41"; }
function encodeDecimalsCall() { return "0x313ce567"; }

async function rpcBatch(calls) {
  // calls: [{ id, method, params }]
  // The public endpoint rejects oversized batches, so chunk to <= 50.
  const out = new Map();
  const CHUNK = 50;
  for (let s = 0; s < calls.length; s += CHUNK) {
    const part = calls.slice(s, s + CHUNK);
    const body = part.map((c) => ({ jsonrpc: "2.0", id: c.id, method: c.method, params: c.params }));
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const json = await res.json();
    for (const item of Array.isArray(json) ? json : [json]) {
      if (item.error) out.set(item.id, { error: item.error.message || "rpc error" });
      else out.set(item.id, { result: item.result });
    }
  }
  return out;
}

async function rpcSingle(method, params, url = RPC_URL) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}

function parseUint(hex) {
  if (!hex || hex === "0x") return 0n;
  try { return BigInt(hex); } catch { return 0n; }
}

async function getLatestBlock() {
  const hex = await rpcSingle("eth_blockNumber", []);
  return parseInt(hex, 16);
}

async function getCode(address) {
  try {
    const code = await rpcSingle("eth_getCode", [address, "latest"]);
    return code && code !== "0x" && code.length > 2;
  } catch {
    return null; // unknown — do not fail the whole report over this
  }
}

// Scan Approval events where `owner` granted an allowance, over the last
// `scanBlocks` blocks, chunked into 10k-block ranges run in parallel.
// Requires BSC_LOGS_RPC_URL (a log-capable node); throws otherwise — the
// caller reports this honestly instead of faking a scan.
// Returns [{ token, spender, value, blockNumber, txHash }] (best effort:
// on any chunk error that chunk is skipped and `scanErrors` counts it).
async function scanApprovals(owner, scanBlocks) {
  if (!LOGS_RPC_URL) {
    throw new Error("no log-capable RPC configured (set BSC_LOGS_RPC_URL); public BSC endpoints reject eth_getLogs");
  }
  const latest = await getLatestBlock();
  const from = Math.max(0, latest - scanBlocks);
  const CHUNK = 10000;
  const ranges = [];
  for (let s = from; s <= latest; s += CHUNK) {
    ranges.push([s, Math.min(s + CHUNK - 1, latest)]);
  }
  let scanErrors = 0;
  const settled = await Promise.allSettled(
    ranges.map(([f, t]) =>
      rpcSingle("eth_getLogs", [{
        fromBlock: "0x" + f.toString(16),
        toBlock: "0x" + t.toString(16),
        // Restrict to the curated tokens: the matrix already reads current
        // allowances for the known spenders; the scan's job is to surface
        // approvals to spenders OUTSIDE that list, for these tokens.
        address: TOKENS.map((t) => t.address),
        topics: [APPROVAL_TOPIC, padAddress(owner)],
      }], LOGS_RPC_URL)
    )
  );
  const events = [];
  for (const s of settled) {
    if (s.status !== "fulfilled" || !Array.isArray(s.value)) { scanErrors++; continue; }
    for (const log of s.value) {
      if (!log.topics || log.topics.length < 3) continue;
      events.push({
        token: log.address,
        spender: "0x" + log.topics[2].slice(26),
        value: parseUint(log.data).toString(),
        blockNumber: parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
      });
    }
  }
  return { events, latestBlock: latest, scannedFromBlock: from, scanErrors };
}

module.exports = {
  RPC_URL, LOGS_RPC_URL, APPROVAL_TOPIC, padAddress,
  encodeAllowanceCall, encodeBalanceCall, encodeSymbolCall, encodeDecimalsCall,
  rpcBatch, rpcSingle, parseUint, getLatestBlock, getCode, scanApprovals,
};
