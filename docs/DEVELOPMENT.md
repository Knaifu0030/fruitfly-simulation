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

## Processing design

Large Feather files are memory-mapped and consumed as bounded Arrow record batches. Do not replace this with an all-at-once Pandas load. The full source graph contains more than 151 million rows.

## Verification checklist

1. Downloader reports every requested file as ready and verified.
2. `dataset-summary.json` reports 165,122 simulation neurons.
3. The compact graph reports 25,563,197 connections.
4. `npm run build` succeeds.
5. The explorer reports 140,024 traced somas.
6. Functional-lens buttons toggle point populations.
7. Selecting a visible point reveals its body ID and annotation fields.

## Regenerating from scratch

Generated directories are disposable. Remove only the explicitly named generated directory you intend to rebuild, then rerun the relevant command. Never modify or manually “clean” raw Feather files.
