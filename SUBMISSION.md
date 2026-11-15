# Wildcard Track Submission — Approval Guard

**Agent:** Approval Guard — a token-approval / wallet-security checker agent for BSC
**Builder:** boskuhh (X @Andysyahputra__)
**Date built:** 2026-11-15
**Status:** Built and deployed. **NOT submitted** — the user submits the Wildcard form.

## Links

- **Demo (public, live):** https://agent-games-wildcard.vercel.app
- **Public endpoint:** `POST https://agent-games-wildcard.vercel.app/api/check`
  with `{"address": "0x..."}` → JSON risk report. `GET /api/check` returns usage.
- **Health:** `GET https://agent-games-wildcard.vercel.app/api/` → `{"status":"ok",...}`
- **Repo:** local git repo in `~/workspace/agent-games/wildcard/` (1 commit,
  `26eeec5`), **not yet pushed to GitHub** — pushing needs the user's GitHub
  account (connected at Agent Games registration). Push it, then put the
  GitHub URL in the submission form. No secrets are in the repo (there are
  none to leak: the agent is keyless).
- **Vercel project:** `agent-games-wildcard`, account **andysyahputra**
  (Hobby), latest deployment `dpl_9JDZKGRGchwameTQTW6pJCiEsMjp`, state READY.
  Note: the deployment-specific URL (`...-qge7b1r77-....vercel.app`) is
  behind Vercel Authentication; the stable project URL above is public —
  use the stable URL in the form.

## Use case

Anyone who has ever clicked "Approve" on a DEX, a staking pool, or an NFT
marketplace. An unlimited ERC-20 approval lets the approved contract move
*all* of that token out of the wallet — forever, until revoked. Most people
have no idea which approvals they still have open. Approval Guard answers
that in seconds, in plain language, without asking the user to connect a
wallet, sign anything, or paste a key.

It helps: a casual DeFi user checking their own wallet before depositing
more funds; someone who just used a new/suspicious dApp and wants to know
what it can still take; a creator or community helper screening a wallet
before recommending it. The report names each spender, says whether the
allowance is unlimited, says whether the spender is a known contract
(PancakeSwap routers, MasterChef, 1inch, Seaport, Permit2) or unknown, and
ends with a plain-language verdict and a 0–100 risk score — plus the honest
coverage limits (see README).

## Build context

- **Stack:** Node.js, no framework, zero dependencies. One serverless
  function (`api/check.js`) + a static demo page (`public/index.html`) +
  local dev server (`server.js`). ~400 lines of agent code.
- **Data source:** keyless public BSC RPC (`https://bsc-dataseed.binance.org`)
  — batched `eth_call` for `allowance`/`balanceOf` (8 tokens × 6 known
  spenders) plus an optional `Approval`-event scan. No API keys, no
  spending, no signing, no private data. BSC-only by design (the user's
  wallets are BSC/EVM); other chains are a config change.
- **Key decision, verified by experiment:** the first design relied on
  `eth_getLogs` to find approvals to *any* spender. That does not work on
  keyless infrastructure — the public BSC dataseeds reject `eth_getLogs`
  with `-32005 "limit exceeded"` even for a 100-block range with address +
  topic filters, Ankr's public endpoint requires an API key, and
  bsc.publicnode.com rate-limits (all verified 2026-11-15). So the
  allowance matrix (which only needs `eth_call`) is the primary check, and
  the event scan only runs when `BSC_LOGS_RPC_URL` points at a log-capable
  node. When it cannot run, the report says so (`eventScanSkipped: true`)
  instead of pretending full coverage.
- **Repo hygiene:** no secrets anywhere; `.git` local only; `npm test`
  runs the live suite + the fixture suite.

## Test results (end-to-end, live)

**Live suite** (`node test/run-tests.js`) — **6/6 PASS locally and 6/6 PASS
against the deployed URL** (raw JSON in `test/last-run-deployed/` and
`test/last-run-local/`):

| # | Address | Result |
|---|---------|--------|
| 1 | `0x000000000000000000000000000000000000dead` (burn address) | 200, CLEAN, score 95, 0 allowances |
| 2 | `0xce0a13d8aed5f8227c79d750ce42032753037037` (user main wallet) | 200, CLEAN, score 95, 0 allowances, ~25 ms server-side |
| 3 | `0xE8BF9bb3A4A63385B6c1e0e4F44AE23c883c16C3` (user Agentic wallet) | 200, CLEAN, score 95, 0 allowances, ~22 ms server-side |
| 4 | Invalid address `"not-an-address"` | 400 `invalid_address` |
| 5 | `GET /api/` health | 200 `{"status":"ok",...}` |
| 6 | `scanBlocks=0` (matrix only) | 200, CLEAN |

**The "one with approvals" case:** no sampled real mainnet address had a
live approval to show. In total **928 further real addresses were checked
live** (recent DEX traders from GeckoTerminal, CAKE traders, EOAs taken
from BSC blocks 90M/105M/115M, 2022–2025) — **all came back clean**. That
is a real finding, not a bug: the RPC layer was verified independently
(a Binance hot wallet's genuine 1,279,936 USDT and 3,000,072 CAKE
balances decode correctly through the same `eth_call` code path), and
modern UIs use exact-amount approvals and signature-based permits, so
live unlimited approvals are rare in a random sample. The risk path was
therefore validated with a **fixture test** (`node test/fixture-test.js`,
**13/13 PASS**, report in `test/last-run/fixture-unlimited-approval.json`):
a stubbed JSON-RPC server returns an unlimited USDT approval to
PancakeSwap V2, a limited 1000 CAKE approval to MasterChef, and an
unlimited USDT approval to an unknown spender via an `Approval` log; the
agent (all real code, only the chain stubbed) reports **HIGH RISK, score
15, 3 allowances, 2 unlimited, 1 unknown spender, riskiest first**.

## zkVerify note (honest)

**zkVerify is not used in this build, and no proof is claimed or
referenced.** The checkable claim this agent could prove is: *"this
approval snapshot is the correct on-chain state at block N"* — a Groth16
proof over the allowance values committed against the block hash would
make the report itself verifiable instead of trusted, and that proof
could be submitted to zkVerify for verification (the same pattern as the
Track 1 Gatekeeper proof in this project). That is a real, sensible use
of zkVerify for this agent, but it is **not implemented** here: proving
storage values needs a circuit over state proofs, which is out of scope
for a one-day Wildcard build. The entry is judged on the agent itself,
not on a zkVerify integration it does not have.

## What the user must do to submit

1. **Push the repo to GitHub** (needs the GitHub account connected at
   Agent Games registration):
   `cd ~/workspace/agent-games/wildcard && git remote add origin <repo-url> && git push -u origin master`
   — then put the GitHub URL in the form.
2. **Register / sign in at https://agentgames.zkverify.io with X
   @Andysyahputra__** (if not done already for the Gatekeeper track),
   attach the prize wallet `0xE8BF9bb3A4A63385B6c1e0e4F44AE23c883c16C3`,
   and pick the **Wildcard** track.
3. In the Wildcard submission form, enter:
   - Demo URL: https://agent-games-wildcard.vercel.app
   - Endpoint URL: https://agent-games-wildcard.vercel.app/api/check
   - Repo URL: (the GitHub URL from step 1)
   - Use case + build context: copy from this file / README.md.
   - zkVerify note: copy the section above (states clearly it is not used).
4. Nothing to configure on the deployment: no env vars, no secrets, no
   HMAC (that is only for the Gatekeeper track). No account, wallet, or
   key was created by this build, and no money was spent.
