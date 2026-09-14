# Development Guide

## Requirements

- Git
- Python 3.11
- [uv](https://docs.astral.sh/uv/)
- Node.js 20 or newer
- Approximately 50 GiB free disk for full data and processing
- A WebGL2-capable browser

An NVIDIA GPU is not required for the anatomy explorer. It will become useful for whole-CNS dynamics and parallel virtual-world experiments.

## Setup

```bash
git clone https://github.com/Knaifu0030/fruitfly-simulation.git
cd fruitfly-simulation
uv sync
npm ci
uv run python scripts/download-malecns.py
uv run python scripts/build-brain-view.py
uv run python scripts/build-simulation-graph.py
npm run dev
```

Open http://127.0.0.1:5173/.

## Faster visualization-only setup

The explorer only needs annotations to generate its current soma view. Run the minimal download, then build the view:

```bash
uv run python scripts/download-malecns.py --minimal
uv run python scripts/build-brain-view.py
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

The build deliberately does not bundle biological data from Git. Generate `viewer/public/data/` before previewing a functional explorer.

To test the frontend against the real local service rather than the labelled demo stream:

```bash
# terminal 1
uv run fruitfly-blackjack-api

# terminal 2
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

On PowerShell, set `$env:VITE_API_URL='http://127.0.0.1:8000'` before `npm run dev`. The production build must likewise receive `VITE_API_URL`; it is compiled into the client bundle.

## Processing design

Large Feather files are memory-mapped and consumed as bounded Arrow record batches. Do not replace this with an all-at-once Pandas load. The full source graph contains more than 151 million rows.

## Verification checklist

1. Downloader reports every requested file as ready and verified.
2. `dataset-summary.json` reports 165,122 simulation neurons.
3. The compact graph reports 25,563,197 connections.
4. `uv run ruff check fruitfly_blackjack tests` and `uv run pytest -q` succeed.
5. `npm run build` succeeds and copies `staticwebapp.config.json` into `dist/`.
6. The explorer reports 140,024 traced somas.
7. A real seeded run displays initial cards, decisions, hits, splits, dealer reveal, settlement, shoe progress, and synchronized brain frames.
8. The owner panel can add/reduce virtual funds, change the next-run wager, and toggle late surrender; reserved exposure cannot be removed.
9. Desktop and phone layouts remain readable, keyboard-focusable, and respect reduced motion.

## Regenerating from scratch

Generated directories are disposable. Remove only the explicitly named generated directory you intend to rebuild, then rerun the relevant command. Never modify or manually “clean” raw Feather files.
