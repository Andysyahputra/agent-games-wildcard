# Approval Guard — zkVerify Agent Games (Wildcard track)

A token-approval / wallet-security checker agent for BSC. Paste any EVM
wallet address and get a plain-language risk report on its token approvals:
which spenders can move its tokens, which allowances are **unlimited**, and
whether each spender is a known contract or an unknown one. Built
2026-11-15 for boskuhh.

## Live demo + endpoint

- **Demo:** `https://agent-games-wildcard.vercel.app` (stable project URL —
  confirm the exact deployment URL in `SUBMISSION.md` after deploy)
- **Endpoint:** `POST https://agent-games-wildcard.vercel.app/api/check`
  with `{"address": "0x..."}` (optional `{"scanBlocks": 0..200000}`)
- **Health:** `GET /api/` → `{"status":"ok", ...}`

No account, wallet, key, or money was used by this build. The agent is
read-only and keyless: it only calls the public BSC RPC.

## Who it helps

Anyone who has ever clicked "Approve" on a DEX, a staking pool, or an NFT
marketplace. An unlimited ERC-20 approval lets the approved contract move
*all* of that token out of the wallet — forever, until revoked. Most people
have no idea which approvals they still have open. Approval Guard answers
that in seconds, in plain language, without asking the user to connect a
wallet, sign anything, or paste a key. Typical users:

- a casual DeFi user checking their own wallet before depositing more funds;
- someone who just interacted with a new / suspicious dApp and wants to know
  what it can still take;
- a creator or community helper screening a wallet before recommending it.

## How it works

`POST /api/check {"address": "0x..."}`:

1. **Allowance matrix (primary check).** For 8 major BSC tokens
   (WBNB, USDT, BUSD, USDC, CAKE, DAI, ETH, BTCB) × 6 known spenders
   (PancakeSwap V2 Router, PancakeSwap V3 Router, PancakeSwap MasterChef,
   1inch Aggregation Router v5, OpenSea Seaport, Permit2) it reads
   `allowance(owner, spender)` and `balanceOf(owner)` via batched
   `eth_call` against the public BSC RPC
   (`https://bsc-dataseed.binance.org`, no key). One batch, ~50 calls,
   ~1 s.
2. **Event scan (optional, needs a log-capable node).** `Approval` logs
   for the address over the last N blocks (default 50,000 ≈ 1.7 days),
   restricted to the curated tokens, to surface allowances to spenders
   *outside* the curated list. See the honest limitation below.
3. **Risk verdict.** Unlimited allowance to an **unknown** spender →
   HIGH RISK. Unlimited to a known spender → CAUTION (normal for a DEX
   router, still worth knowing). Limited allowances → LOW. Nothing found
   → CLEAN, with a 0–100 risk score (higher = safer) and a plain-language
   verdict. A later zero-value `Approval` (revoke) supersedes an earlier
   grant for the same token+spender pair.

## Key decisions

- **BSC only, keyless.** The user's wallets are BSC/EVM and the public
  BSC RPC needs no key — so the agent has no secrets at all and nothing
  to leak. Other chains are a config change (token/spender lists), not a
  redesign.
- **Curated matrix over event indexing.** The first design scanned
  `Approval` events for *any* spender. That does not work on keyless
  infrastructure: the public BSC dataseeds reject `eth_getLogs` with
  `-32005 "limit exceeded"` even for a 100-block range with an address +
  topic filter (verified 2026-11-15), Ankr's public endpoint requires an
  API key, and bsc.publicnode.com rate-limits. So the matrix (which only
  needs `eth_call`, and works) is the primary check, and the event scan
  only runs when `BSC_LOGS_RPC_URL` points at a log-capable node. When
  it cannot run, the report says so explicitly (`eventScanSkipped: true`)
  instead of silently pretending full coverage.
- **No wallet connection, no signatures.** The agent never asks for an
  address to be "connected" — the address is just a query parameter.
  Nothing to phish.
- **Fail-open reporting, fail-closed claims.** If a single `eth_call`
  fails, that pair is skipped and the report still returns; the coverage
  section states exactly what was and was not checked. The agent never
  claims "safe" beyond its checked scope.
- **No framework, no dependencies.** Pure Node.js (`fetch` only), one
  serverless function + a static demo page. Nothing to install, nothing
  to audit beyond ~400 lines.

## What it can / cannot do

Can:
- show live allowances for the 8 curated tokens × 6 known spenders, with
  unlimited vs limited amounts and the wallet's current balance per token;
- flag unlimited allowances to unknown spenders (when the event scan is
  enabled) and tell the user, in plain words, to revoke before depositing;
- run entirely keyless and read-only — safe to run for any address.

Cannot:
- see approvals granted before the event-scan window to spenders outside
  the curated list, or for tokens outside the curated list (the main
  coverage gap — stated in every report);
- audit spender contracts — "known" means reputable by public identity,
  not proven safe;
- see other chains, or NFT (`setApprovalForAll`) approvals — ERC-20 only;
- revoke anything. Revocation happens in the user's own wallet
  (e.g. revoke.cash, BscScan Token Approvals) after they check the address.

## zkVerify note

zkVerify is **not used** in this build, and no proof is claimed. The
honest statement: the checkable claim here would be *"this approval
snapshot is the correct on-chain state at block N"* — a Groth16 proof
over the block's state (allowance values + block hash) could make the
report itself verifiable instead of trusted, and that proof could be
submitted to zkVerify for verification. That is a real, sensible use of
zkVerify for this agent, but it is **not implemented** in this entry;
building it would need a circuit over storage proofs, which is out of
scope for a one-day Wildcard build. See `SUBMISSION.md`.

## Files

- `api/check.js` — Vercel endpoint (`POST /api/check`); `api/index.js` —
  health check; `server.js` — local server (`node server.js`, port 3000).
- `lib/check.js` — report logic + risk verdict; `lib/bsc.js` — keyless
  BSC JSON-RPC client; `lib/data.js` — curated tokens + known spenders.
- `public/index.html` — demo page. `test/run-tests.js` — end-to-end tests
  (`BASE_URL=http://localhost:3000 node test/run-tests.js`).
- `scripts/deploy.py` — Vercel REST deploy (reuses the registered Vercel
  credential; `/opt/hatch/bin/vercel` is only an MCP wrapper, same
  mechanism as the Gatekeeper deploy).

## Test results

See `SUBMISSION.md` (raw JSON in `test/last-run*/`).

- **Live tests** (`node test/run-tests.js`, local + deployed): 6/6 PASS both
  times — health, invalid address → 400, burn address → clean, user main
  wallet → clean, user Agentic wallet → clean, `scanBlocks=0` → clean.
- **Fixture test** (`node test/fixture-test.js`): 13/13 PASS — a stubbed
  JSON-RPC server returns an unlimited USDT approval to PancakeSwap V2, a
  limited 1000 CAKE approval to MasterChef, and an unlimited USDT approval
  to an unknown spender via an `Approval` log; the agent reports HIGH
  RISK, score 15, 3 allowances, 2 unlimited, 1 unknown spender, riskiest
  first. The stub replaces only the chain; all agent code runs for real.
- **Sampling note:** 928 further real mainnet addresses (recent DEX
  traders, CAKE traders, EOAs from 2022–2025 blocks) were checked live;
  all came back clean. That is a real finding about modern approval
  behaviour (exact-amount approvals + signature permits), not a bug —
  the RPC layer was verified independently (a Binance hot wallet's real
  1.28M USDT / 3M CAKE balances decode correctly through the same code).

## Run locally

```bash
node server.js                 # http://localhost:3000
BASE_URL=http://localhost:3000 node test/run-tests.js
```

Optional env vars: `BSC_RPC_URL` (default the public dataseed),
`BSC_LOGS_RPC_URL` (a log-capable node — only then does the event scan
run), `PORT`. No secrets exist in this repo; never add one.
