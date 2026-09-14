# Architecture

## Current system

```text
Official MaleCNS v1.0 Feather tables
                │
                ├── build-brain-view.py
                │      ├── canonical traced-neuron Parquet
                │      ├── compact 24-byte soma records
                │      └── visualization dictionaries and metadata
                │
                └── build-simulation-graph.py
                       ├── contiguous neuron index
                       ├── traced-to-traced weighted edges
                       └── in/out degree tables and summary

Generated anatomy payload ──▶ Vite + Three.js explorer
Processed graph ─────────────▶ future neural-dynamics runtime
```

Raw data is immutable and versioned by the tracked manifest. Derived data can always be deleted and reconstructed.

## Live blackjack path

```text
LocalBlackjackProvider -- public observation --> hybrid policy + exact oracle
          |                                           | action
          | immediate card events                     v
          +------------------------------------- round settlement
                                                      |
                             +-- brain aggregate frames
WebSocket event bus <--------+-- deterministic hand replay
                             +-- atomic virtual-wallet settlement
                                      |
                      Azure Table state + append-only ledger
```

The browser keeps one felt-state model and renders it in Three.js. `hand.started` creates the visible initial deal and face-down hole card; `agent.decision` selects the active split hand and explains the move; `card.dealt` advances the public shoe and deal animation; `hand.result` reveals the dealer, lays out every split hand, moves spent cards to the tray, and updates the virtual bankroll. The scripted demonstration stream uses the same event contract but is visibly labelled as a demonstration.

The scene is split into focused modules under `src/stage/`: procedural felt and leather textures, table geometry and fixtures, playing-card meshes, and the articulated fly. Card rank comes from simulation data; suit is deterministically derived from the hand ID because the engine intentionally models blackjack values rather than suit-dependent gameplay.

## Layer boundaries

### Canonical biological graph

Preserves official body IDs, annotations, transmitter evidence, coordinates, connectivity, dataset version, and provenance. No simulation assumptions belong here.

### Model interpretation

Will define neuron equations, inferred synaptic sign, weight normalization, delays, noise, initial conditions, and plasticity. Every parameter set must be versioned and attributable.

### Embodiment adapter

Will translate world observations into biologically identified sensory populations and descending/motor activity into body control. Engineered mappings must remain explicit and inspectable.

### Experiment layer

Will own arenas, stimuli, internal-state variables, training curricula, interventions, evaluation metrics, random seeds, and replay logs.

### Presentation layer

The explorer consumes compact generated files rather than reading scientific tables in the browser. It prioritizes public explanations and exposes technical annotations on demand. Screen-space labels are projected from real Three.js anchors, and the table camera adapts to its panel until the viewer intentionally orbits it.

## Data invariants

- Raw MaleCNS body IDs are never replaced or rounded.
- Simulation indices are contiguous unsigned 32-bit integers with a reversible index table.
- Only rows with official status `Traced` enter the baseline simulation graph.
- A retained edge must have both endpoints in the canonical traced-neuron set.
- Anatomical facts, literature interpretation, model assumptions, and simulated activity are separate evidence classes.
- Generated browser payloads are disposable and never committed.
