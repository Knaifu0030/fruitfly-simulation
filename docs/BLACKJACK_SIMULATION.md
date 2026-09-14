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

The local provider uses six decks, S17, DAS, late surrender, 3:2 naturals, at most four split hands, one card after split aces, no ace resplitting, and no insurance. The observation contains only player cards, dealer up-card, legal-action mask, cards-dealt count, and previous reward. The dealer hole card and future shoe order never enter the agent observation or public deal event.

Reward is +1 for a win, +1.5 for blackjack, -1 for a loss, 0 for a push, and -0.5 for surrender, multiplied for doubles and clipped to [-2, 2]. Larger visual pulses are presentation only.

## What the brain display means

MaleCNS soma positions are anatomical data. The displayed perception, working-state, choice, Kenyon-cell/MBON learning, appetitive DAN, and aversive reinforcement values are population aggregates produced by the declared model. The mapping from blackjack variables to those populations is engineered and does not prove happiness, pain, or consciousness.

## API

Public: `GET /api/live`, `/api/stats`, `/api/hands/{id}`, `/api/checkpoints`, and `WS /api/stream`. Owner-only: create, inspect, and stop `/api/admin/runs`. Events use `fruitfly-blackjack/1`; sequence numbers let viewers reject duplicates. The current service retains 10,000 hands in memory and writes deterministic checkpoints to `.runtime/checkpoints`.

## Validation

`uv run pytest -q` checks rules, payouts, split aces, surrender, deterministic policy agreement, API authorization, replay lookup, and the WebSocket envelope. `npm run build` verifies the public client. Run `uv run python scripts/evaluate-blackjack-agent.py --hands 1000000` and archive its seed and output before claiming the 99.5% milestone; no run can guarantee profit because blackjack retains variance and usually a house edge.
