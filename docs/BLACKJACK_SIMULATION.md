# Blackjack simulation

This is an independent, bankroll-free research simulator. It does not connect to Stake or any casino, place wagers, automate a browser, or consume credentials.

## Run locally

Terminal one:

```bash
uv sync --group dev
ADMIN_TOKEN=replace-me uv run fruitfly-blackjack-api
```

On PowerShell use `$env:ADMIN_TOKEN='replace-me'`. Terminal two:

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Start a bounded run:

```bash
curl -X POST http://127.0.0.1:8000/api/admin/runs \
  -H "Authorization: Bearer replace-me" -H "Content-Type: application/json" \
  -d '{"hands":1000,"seed":20260914,"duration_seconds":7200,"speed_hands_per_second":10}'
```

Without the API, the website explicitly reports a demonstration stream.

## Rules and information boundary

The local provider uses six decks, S17, DAS, 3:2 naturals, at most four split hands, one card after split aces, no ace resplitting, and no insurance. Late surrender is offered by default and can be switched off per run; the resolved value is recorded on every hand as `rules.late_surrender`. The observation contains only player cards, dealer up-card, legal-action mask, cards-dealt count, and previous reward. The dealer hole card and future shoe order never enter the agent observation or public deal event.

Reward is +1 for a win, +1.5 for blackjack, -1 for a loss, 0 for a push, and -0.5 for surrender, multiplied for doubles and clipped to [-2, 2]. Larger visual pulses are presentation only.

## What the brain display means

MaleCNS soma positions are anatomical data. The displayed perception, working-state, choice, Kenyon-cell/MBON learning, appetitive DAN, and aversive reinforcement values are population aggregates produced by the declared model. The mapping from blackjack variables to those populations is engineered and does not prove happiness, pain, or consciousness.

## What the table display means

The Three.js table is an original visualization of the local provider, not a capture or automation of an external casino. It renders a six-deck shoe, discard tray, wager-sized chips, an articulated fly, player and dealer cards, splits, doubles, surrender, and dealer reveal. Rank is authoritative simulation state. Suit is visual-only and deterministically derived from the hand ID because suits do not affect blackjack strategy; this keeps every replay stable.

The client maintains a single felt-state model. Immediate WebSocket events animate decisions and public cards, while the final `hand.result` is the canonical replay record. If the backend is unavailable or idle, the UI clearly switches to a scripted demonstration that exercises the same event schema. The demonstration never modifies or replaces the persisted wallet display, uses the configured wager, and omits surrender examples when late surrender is disabled.

## API

Public: `GET /api/live`, `/api/stats`, `/api/hands/{id}`, `/api/checkpoints`, and `WS /api/stream`. Owner-only: create, inspect, and stop `/api/admin/runs` using the Azure-held bearer secret. Direct clients cannot impersonate an Azure identity header. Events use `fruitfly-blackjack/1`; sequence numbers let viewers reject duplicates. The current service retains 10,000 hands in memory and writes deterministic checkpoints to `.runtime/checkpoints`.

## Virtual wallet

The canonical wallet uses non-redeemable simulated INR stored as integer paise. It starts at ₹10,000 with a ₹100 flat wager and reserves eight wager units before dealing so splits and doubles cannot make the balance negative. Public endpoints expose the wallet summary and shadow wager experiments. PIN sessions expire after 15 minutes and remain only in page memory.

PIN-authenticated owner endpoints:

| Endpoint | Effect |
| --- | --- |
| `POST /api/admin/wallet/adjustments` | Adds or removes virtual funds. `direction` is `add` or `reduce`; a reduction that would dip into reserved exposure is rejected with `409 reduction_exceeds_available_funds`. |
| `POST /api/admin/wallet/topups` | Compatibility alias for an `add` adjustment. |
| `POST /api/admin/wallet/config` | Sets the next run's base wager and late-surrender rule. Rejected with `409` while a run is active. |
| `GET /api/admin/wallet/ledger` | Reads the full append-only ledger. |

Adjustments require an `Idempotency-Key` header and are replay-safe: a repeated key returns the original transaction with `created: false`. Removing funds is bookkeeping only — it is recorded as `total_removed_paise` and excluded from realized profit and loss, so ROI is measured against net contributed funds rather than the gross amount ever added. Adding or removing funding shifts the peak-balance baseline by the same amount, preserving game drawdown instead of manufacturing a gain or loss.

Wallet state and its append-only ledger use Azure Table Storage when `AZURE_STORAGE_ACCOUNT_URL` is configured; local development uses an in-memory store. Neural reinforcement stays in bounded units and is never scaled by the displayed wallet amount.

## Validation

`uv run pytest -q` checks rules, payouts, split aces, surrender, deterministic policy agreement, API authorization, replay lookup, and the WebSocket envelope. `npm run build` verifies the public client. Run `uv run python scripts/evaluate-blackjack-agent.py --hands 1000000` and archive its seed and output before claiming the 99.5% milestone; no run can guarantee profit because blackjack retains variance and usually a house edge.
