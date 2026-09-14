# Fruitfly Simulation

An open, reproducible foundation for exploring and eventually embodying the complete adult male *Drosophila melanogaster* central nervous system in a virtual world.

The repository currently provides:

- a verified downloader for the official MaleCNS v1.0 bulk tables;
- a bounded-memory pipeline that converts the source graph into compact simulation indices;
- a live Three.js blackjack table and synchronized MaleCNS aggregate activity view;
- a deterministic six-deck blackjack service, strategy oracle, hybrid learner, replay API, and WebSocket telemetry;
- reversible links from public-facing labels to scientific neuron annotations;
- an explicit integration contract for an independently developed 3D world;
- documentation separating anatomical facts, interpretations, assumptions, and simulation results.

> [!IMPORTANT]
> This is a connectome-constrained modeling project—not a brain upload or exact emulation. The connectome does not fully specify cell physiology, receptor effects, electrical synapses, neuromodulation, internal state, plasticity, developmental history, or learned memories.

## Current result

The processing pipeline selects **165,122 officially traced neurons** and retains **25,563,197 weighted connections** between them. It produces a compact connection table of approximately **125 MiB** from the official 151,856,684-row source graph.

The live dashboard renders **140,024 soma locations** while the local agent plays independent, bankroll-free blackjack. Anatomy is genuine MaleCNS-derived data; activity values are explicitly labeled model outputs and engineered mappings rather than measurements or subjective feelings.

## Quick start

### Requirements

- Git
- Python 3.11
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+
- WebGL2-capable browser
- 50 GiB free disk for the full data workflow

### Clone and install

```bash
git clone https://github.com/Knaifu0030/fruitfly-simulation.git
cd fruitfly-simulation
uv sync
npm ci
```

### Download MaleCNS

Full 22.70 GiB tabular package:

```bash
uv run python scripts/download-malecns.py
```

Minimal graph package, approximately 1.76 GiB:

```bash
uv run python scripts/download-malecns.py --minimal
```

The downloader is cross-platform, resume-safe, verifies official byte lengths, and checks Arrow/Feather signatures. The biological data is never committed to Git.

### Build the visualization and graph

```bash
uv run python scripts/build-brain-view.py
uv run python scripts/build-simulation-graph.py
```

### Run the live simulation

```bash
uv run fruitfly-blackjack-api
npm run dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

The site uses a clearly marked demonstration stream if the API is offline. Owner-run commands, rules, event schemas, and validation are documented in [Blackjack simulation](docs/BLACKJACK_SIMULATION.md). Azure infrastructure is inert by default and covered by a separate approval gate in [Azure deployment](docs/AZURE_DEPLOYMENT.md).

## Repository map

```text
├── data/
│   └── malecns-v1.0/manifest.json   official URLs, sizes, version, license
├── docs/
│   ├── ARCHITECTURE.md              component and data-flow boundaries
│   ├── DATA.md                      acquisition, storage and attribution
│   ├── DEVELOPMENT.md               complete local setup and validation
│   ├── SCIENTIFIC_LIMITATIONS.md    claims, evidence and language policy
│   └── WORLD_INTEGRATION.md         contract for the future 3D world
├── scripts/
│   ├── download-malecns.py          cross-platform resumable downloader
│   ├── build-brain-view.py          anatomy and browser payload builder
│   └── build-simulation-graph.py     bounded-memory graph preprocessing
├── src/                              Three.js explorer
├── viewer/public/data/               generated and ignored browser data
├── PRODUCT.md                        audience and design principles
└── FRUIT_FLY_VIRTUAL_UNIVERSE_RESEARCH.md
```

## Virtual-world boundary

The 3D world is intentionally independent from the neural model:

```text
world physics and environment
          │ sensory observations
          ▼
sensory transduction → MaleCNS dynamics → descending/VNC activity
          ▲                                      │
          └──────── changed sensory input ◀──── body actions
```

World implementations provide physical quantities—ommatidial samples, odor concentration, contact, temperature, wind and body state. They must not provide privileged labels such as “food direction” or “best action.” See [World Integration Contract](docs/WORLD_INTEGRATION.md).

## Scientific communication

“Learning & reward” is an accessible label for circuits associated with reinforcement, learned value and memory, including Kenyon cells, dopaminergic neurons and mushroom-body output neurons. It is not evidence that the simulated system experiences human-like happiness.

Every future visualization should identify whether information is:

- an anatomical dataset fact;
- a literature-backed interpretation;
- an explicit model assumption; or
- a simulation result.

See [Scientific Scope and Limitations](docs/SCIENTIFIC_LIMITATIONS.md).

## Data and licenses

Repository code is licensed under the [MIT License](LICENSE). MaleCNS v1.0 is provided separately by HHMI Janelia FlyEM and collaborators under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Downloaded and derived biological data is excluded from this repository. Cite the [MaleCNS project](https://male-cns.janelia.org/) and associated publication in derived research.

## Contributing

Public contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code, datasets, scientific interpretations, or virtual-world adapters.
