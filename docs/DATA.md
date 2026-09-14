# Data Guide

## What is downloaded

The full reproducible package consists of seven official MaleCNS v1.0 Feather files totaling 24,377,419,334 bytes (22.70 GiB): annotations, aggregate neurotransmitter predictions, body statistics, weighted connectivity, synaptic partners, synapse locations, and per-synapse transmitter predictions.

The raw electron-microscopy and voxel-segmentation volumes are intentionally excluded. They are unnecessary for connectome simulation and are far too large for ordinary local replication.

## Download

Full package:

```bash
uv run python scripts/download-malecns.py
```

Minimal graph package (about 1.76 GiB):

```bash
uv run python scripts/download-malecns.py --minimal
```

Downloads resume from partial files. Completion requires both the exact official byte length and valid Arrow/Feather start/end signatures.

## Build derivatives

```bash
uv run python scripts/build-brain-view.py
uv run python scripts/build-simulation-graph.py
```

The first command produces the soma visualization payload and canonical neuron table. The second scans 151,856,684 weighted rows in bounded batches and produces an indexed 25,563,197-edge graph between 165,122 traced neurons.

## Local outputs

```text
data/malecns-v1.0/raw/          official immutable source files
data/malecns-v1.0/processed/    generated Parquet tables and reports
viewer/public/data/             generated browser payload
```

All three locations are ignored by Git. The manifest and this documentation are tracked.

## Licensing and attribution

MaleCNS v1.0 is provided by HHMI Janelia FlyEM and collaborators under CC BY 4.0. Cite and link the [MaleCNS project](https://male-cns.janelia.org/) and associated publication when redistributing derived results. The repository's Apache-2.0 code license does not replace the dataset's CC BY license.

## Storage guidance

- Source package: 22.70 GiB
- Current compact traced-neuron graph: approximately 125 MiB
- Current soma viewer payload: approximately 3.2 MiB plus metadata
- Recommended free working space: at least 50 GiB

Experiment recordings can exceed the source data. Store sparse spike events, selected voltage traces, and downsampled population statistics instead of every neuron's voltage at every simulation step.
