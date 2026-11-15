// Core logic: build a token-approval risk report for one EVM address on BSC.
// Read-only. No keys, no signing, no spending.
//
// Method:
//  1. Allowance matrix — for each curated token x each known spender, read
//     allowance(owner, spender) + balanceOf(owner) via batched eth_call.
//  2. Event scan — Approval logs for this owner over the last N blocks,
//     to surface allowances to spenders NOT in the curated list. Only runs
//     when BSC_LOGS_RPC_URL points at a log-capable node (public BSC
//     endpoints reject eth_getLogs — verified 2026-11-15).
//  3. Risk verdict — unlimited allowance to an unknown spender is the
//     headline risk; unlimited to a known spender is a caution; everything
//     zero is clean (within the checked scope — stated honestly).
//
// What this CANNOT do (stated in the report too): it does not see approvals
// granted before the event-scan window to spenders outside the curated list,
// it does not audit spender contracts, and it cannot revoke anything.

const { TOKENS, KNOWN_SPENDERS, MAX_UINT256 } = require("./data");
const bsc = require("./bsc");

const DEFAULT_SCAN_BLOCKS = 50000; // ~1.7 days of BSC blocks (3s/block)
const MAX_SCAN_BLOCKS = 200000;

function isAddress(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

function fmtAmount(raw, decimals) {
  try {
    const v = BigInt(raw);
    if (v === 0n) return "0";
    const d = BigInt(decimals);
    const whole = v / 10n ** d;
    const frac = v % 10n ** d;
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return raw;
  }
}

function riskOf(allowance, isKnownSpender) {
  if (allowance === 0n) return { level: "none", label: "No allowance" };
  if (allowance >= MAX_UINT256) {
    return isKnownSpender
      ? { level: "medium", label: "UNLIMITED allowance to a known spender" }
      : { level: "high", label: "UNLIMITED allowance to an UNKNOWN spender" };
  }
  return isKnownSpender
    ? { level: "low", label: "Limited allowance to a known spender" }
    : { level: "medium", label: "Limited allowance to an unknown spender" };
}

const LEVEL_RANK = { none: 0, low: 1, medium: 2, high: 3 };

async function checkAddress(address, opts = {}) {
  const started = Date.now();
  const scanBlocks = Math.min(
    Math.max(0, Number(opts.scanBlocks ?? DEFAULT_SCAN_BLOCKS) || 0),
    MAX_SCAN_BLOCKS
  );
  const knownByAddr = new Map(KNOWN_SPENDERS.map((s) => [s.address.toLowerCase(), s]));

  // --- 1. Allowance matrix (batched eth_call) ---
  const calls = [];
  let id = 0;
  const balanceIds = new Map(); // token address -> call id
  const allowanceIds = new Map(); // "token|spender" -> call id
  for (const t of TOKENS) {
    const bid = ++id;
    balanceIds.set(t.address.toLowerCase(), bid);
    calls.push({ id: bid, method: "eth_call", params: [{ to: t.address, data: bsc.encodeBalanceCall(address) }, "latest"] });
    for (const s of KNOWN_SPENDERS) {
      const aid = ++id;
      allowanceIds.set(`${t.address.toLowerCase()}|${s.address.toLowerCase()}`, aid);
      calls.push({ id: aid, method: "eth_call", params: [{ to: t.address, data: bsc.encodeAllowanceCall(t.address, address, s.address) }, "latest"] });
    }
  }
  const results = await bsc.rpcBatch(calls);

  const allowances = [];
  let highest = "none";
  for (const t of TOKENS) {
    const b = results.get(balanceIds.get(t.address.toLowerCase()));
    const balance = b && !b.error ? bsc.parseUint(b.result) : null;
    for (const s of KNOWN_SPENDERS) {
      const r = results.get(allowanceIds.get(`${t.address.toLowerCase()}|${s.address.toLowerCase()}`));
      if (!r || r.error) continue; // skip unreadable pairs, don't fail the report
      const value = bsc.parseUint(r.result);
      if (value === 0n) continue;
      const risk = riskOf(value, true);
      if (LEVEL_RANK[risk.level] > LEVEL_RANK[highest]) highest = risk.level;
      allowances.push({
        token: t.symbol,
        tokenAddress: t.address,
        spender: s.name,
        spenderAddress: s.address,
        spenderKnown: true,
        spenderKind: s.kind,
        allowanceRaw: value.toString(),
        allowance: value >= MAX_UINT256 ? "unlimited" : fmtAmount(value.toString(), t.decimals),
        unlimited: value >= MAX_UINT256,
        balance: balance === null ? null : fmtAmount(balance.toString(), t.decimals),
        risk: risk.level,
        note: risk.label,
      });
    }
  }

  // --- 2. Event scan for spenders outside the curated list ---
  // Only runs when a log-capable RPC is configured (BSC_LOGS_RPC_URL):
  // public BSC endpoints reject eth_getLogs (verified 2026-11-15), so
  // without one the scan is skipped and the report says so.
  const scanned = [];
  let scan = { events: [], latestBlock: null, scannedFromBlock: null, scanErrors: 0, scanSkipped: false, scanNote: "" };
  if (scanBlocks > 0) {
    if (!bsc.LOGS_RPC_URL) {
      scan.scanSkipped = true;
      scan.scanNote = "Event scan skipped: no log-capable RPC configured (set BSC_LOGS_RPC_URL). Public BSC endpoints reject eth_getLogs, so approvals to spenders outside the curated list are not visible in this report.";
      try { scan.latestBlock = await bsc.getLatestBlock(); } catch { /* report stays usable */ }
    } else {
      try {
        scan = await bsc.scanApprovals(address, scanBlocks);
      } catch (e) {
        scan = { events: [], latestBlock: null, scannedFromBlock: null, scanErrors: 1, scanError: String(e.message || e) };
      }
    }
    // Keep only the LATEST Approval per (token, spender); a later zero
    // allowance revokes an earlier one.
    const latestByPair = new Map();
    for (const ev of scan.events) {
      const key = `${ev.token.toLowerCase()}|${ev.spender.toLowerCase()}`;
      const prev = latestByPair.get(key);
      if (!prev || ev.blockNumber >= prev.blockNumber) latestByPair.set(key, ev);
    }
    // Resolve token symbols/decimals for unknown tokens (best effort).
    const unknownTokens = [...new Set([...latestByPair.values()]
      .filter((ev) => !TOKENS.some((t) => t.address.toLowerCase() === ev.token.toLowerCase()))
      .map((ev) => ev.token.toLowerCase()))];
    const meta = new Map();
    if (unknownTokens.length) {
      const mcalls = [];
      let mid = 0;
      for (const tok of unknownTokens) {
        const sid = ++mid, did = ++mid;
        meta.set(tok, { symbolId: sid, decimalsId: did });
        mcalls.push({ id: sid, method: "eth_call", params: [{ to: tok, data: bsc.encodeSymbolCall() }, "latest"] });
        mcalls.push({ id: did, method: "eth_call", params: [{ to: tok, data: bsc.encodeDecimalsCall() }, "latest"] });
      }
      try {
        const mres = await bsc.rpcBatch(mcalls);
        for (const [tok, ids] of meta) {
          let symbol = "UNKNOWN";
          let decimals = 18;
          const sr = mres.get(ids.symbolId);
          if (sr && !sr.error && sr.result && sr.result.length > 130) {
            try {
              const raw = Buffer.from(sr.result.slice(130), "hex").toString("utf8").replace(/\0/g, "").trim();
              if (raw) symbol = raw.slice(0, 12);
            } catch { /* keep UNKNOWN */ }
          }
          const dr = mres.get(ids.decimalsId);
          if (dr && !dr.error) { const d = Number(bsc.parseUint(dr.result)); if (d >= 0 && d <= 36) decimals = d; }
          meta.set(tok, { symbol, decimals });
        }
      } catch { /* metadata is best-effort */ }
    }

    for (const ev of latestByPair.values()) {
      const value = BigInt(ev.value);
      if (value === 0n) continue; // revoked — nothing active
      const tokenKnown = TOKENS.find((t) => t.address.toLowerCase() === ev.token.toLowerCase());
      const spenderKnown = knownByAddr.get(ev.spender.toLowerCase());
      // Already covered by the matrix? Skip duplicates.
      if (tokenKnown && spenderKnown) continue;
      const m = tokenKnown
        ? { symbol: tokenKnown.symbol, decimals: tokenKnown.decimals }
        : meta.get(ev.token.toLowerCase()) || { symbol: "UNKNOWN", decimals: 18 };
      const risk = riskOf(value, !!spenderKnown);
      if (LEVEL_RANK[risk.level] > LEVEL_RANK[highest]) highest = risk.level;
      let isContract = null;
      if (!spenderKnown) isContract = await bsc.getCode(ev.spender);
      scanned.push({
        token: m.symbol,
        tokenAddress: ev.token,
        spender: spenderKnown ? spenderKnown.name : ev.spender,
        spenderAddress: ev.spender,
        spenderKnown: !!spenderKnown,
        spenderKind: spenderKnown ? spenderKnown.kind : (isContract === true ? "unknown contract" : isContract === false ? "EOA (externally owned account)" : "unknown"),
        allowanceRaw: value.toString(),
        allowance: value >= MAX_UINT256 ? "unlimited" : fmtAmount(value.toString(), m.decimals),
        unlimited: value >= MAX_UINT256,
        balance: null,
        risk: risk.level,
        note: risk.label,
        firstSeenBlock: ev.blockNumber,
        txHash: ev.txHash,
      });
    }
  }

  const all = [...allowances, ...scanned].sort(
    (a, b) => LEVEL_RANK[b.risk] - LEVEL_RANK[a.risk] || (b.unlimited - a.unlimited)
  );

  const verdict =
    highest === "high"
      ? "HIGH RISK — an unknown spender holds an unlimited (or large) allowance and could drain this token at any time. Revoke it before depositing more."
      : highest === "medium"
        ? "CAUTION — there are active allowances worth reviewing. Unlimited allowances to known DEX routers are normal, but any allowance to an unknown spender should be revoked if you do not recognise it."
        : highest === "low"
          ? "LOW RISK — only small, limited allowances to known spenders were found in the checked scope."
          : "CLEAN — no active allowances found in the checked scope. (See coverage limits below.)";

  const score = highest === "high" ? 15 : highest === "medium" ? 55 : highest === "low" ? 80 : 95;

  return {
    agent: "approval-guard",
    track: "wildcard",
    network: "BSC (chain 56)",
    address,
    checkedAt: new Date().toISOString(),
    checkedBlock: scan.latestBlock,
    riskScore: score, // 0-100, higher = safer
    riskLevel: highest === "none" ? "clean" : highest,
    verdict,
    summary: {
      activeAllowances: all.length,
      unlimited: all.filter((a) => a.unlimited).length,
      unknownSpenders: all.filter((a) => !a.spenderKnown).length,
      tokensChecked: TOKENS.length,
      knownSpendersChecked: KNOWN_SPENDERS.length,
      eventScanBlocks: scan.scanSkipped ? 0 : scanBlocks,
      eventScanFromBlock: scan.scannedFromBlock,
      eventScanErrors: scan.scanErrors,
      eventScanSkipped: !!scan.scanSkipped,
    },
    allowances: all,
    coverage: {
      tokens: TOKENS.map((t) => t.symbol),
      knownSpenders: KNOWN_SPENDERS.map((s) => s.name),
      eventScan: scan.scanSkipped
        ? scan.scanNote
        : scanBlocks > 0
          ? `Approval events for this address over the last ${scanBlocks} blocks (~${(scanBlocks * 3 / 86400).toFixed(1)} days), for the ${TOKENS.length} curated tokens. Approvals granted earlier, or for tokens outside the curated list, are NOT visible to this scan — that is the main coverage gap.`
          : "Event scan disabled (scanBlocks=0). Only the curated token x spender matrix was checked.",
      limits: [
        "Does not audit spender contracts — a 'known' spender is trusted by reputation, not by proof.",
        "Cannot see approvals on other chains — this report is BSC only.",
        "Read-only: this agent cannot revoke anything. Revoke in your own wallet (e.g. revoke.cash, BscScan Token Approvals) after checking the address yourself.",
      ],
    },
    tookMs: Date.now() - started,
  };
}

module.exports = { checkAddress, isAddress, TOKENS, KNOWN_SPENDERS };
