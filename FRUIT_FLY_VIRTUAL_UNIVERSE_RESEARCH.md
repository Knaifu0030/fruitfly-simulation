# Building an Embodied Male Fruit-Fly Brain in a Virtual Universe

## Executive conclusion

It is now practical to build a **connectome-constrained virtual fruit fly**: a simulated male fly body in a physics world, driven by a time-evolving network whose graph comes from the MaleCNS v1.0 connectome. It is not yet possible to reconstruct a biologically faithful individual fly mind from the connectome alone. The map gives neurons, synaptic partners, synapse counts, anatomy, many cell-type labels, and predicted transmitter identities; it does not fully specify membrane dynamics, receptor effects, electrical synapses, neuromodulatory state, synaptic plasticity, glia, developmental history, or the animal's learned memories.

The strongest project therefore has two explicit goals:

1. **Engineering goal:** create an interactive embodied agent with a real connectome-derived neural backbone, senses, movement, learning, and excellent visualization.
2. **Scientific goal:** progressively replace assumptions with measured parameters and test whether the model predicts held-out neural and behavioral experiments.

Call it a *connectome-constrained model*, not a brain upload or exact emulation.

## What became available

The MaleCNS project released v1.0 in June 2026 and the associated paper in September 2026. The dataset covers the full adult male central nervous system—brain plus ventral nerve cord—and contains roughly 166,000 neurons. The official release exposes interactive querying through neuPrint and Clio, bulk connectivity and synapse tables, neuron annotations, neurotransmitter predictions, skeletons, neuropil volumes, segmentation, and electron-microscopy imagery. It is CC BY licensed.[1][2]

This is unusually suitable for embodiment because the VNC and brain are in one reconstruction and sensory/motor pathways can be followed across the CNS. But anatomy is a constraint on a dynamic model, not the dynamic model itself.

## Closest existing projects

| Project | What it demonstrates | What to reuse | Important limitation |
|---|---|---|---|
| **Shiu et al. whole-brain model (2024)** | A whole-central-brain leaky-integrate-and-fire (LIF) model built from connectome weights and predicted neurotransmitters; it reproduced or predicted parts of taste, feeding, and grooming circuitry, with experimental validation. | Baseline neuron equations, signed synapse logic, stimulus protocol, validation philosophy. | Female central-brain dataset; not a complete embodied male CNS, and the simplified model is not a full physiological reconstruction.[3] |
| **NeuroMechFly v2 / FlyGym** | A MuJoCo-based adult fly body with vision, olfaction, contact, terrain, adhesion, other flies, and composable controllers. Demonstrations include odor navigation, obstacle avoidance, and fly following with a connectome-constrained visual network. | Body, sensors, environments, locomotor controllers, Gymnasium-like task loop, rendering. | Most motor competence comes from engineered or learned controllers, not directly from whole-connectome dynamics.[4][5] |
| **FlyBrainLab + Neurokernel** | Query, visualize, construct, execute, and compare executable fly neural circuits; Neurokernel supports modular GPU execution. | Circuit experimentation, notebooks, circuit diagrams, model comparison ideas. | Older modular architecture and datasets; integration work is required for MaleCNS and modern embodied control.[6][7] |
| **Virtual Fly Brain / neuPrint / Codex** | Interactive anatomy, cell types, connectivity, morphology, gene-expression context, and 3D exploration. | Research UI patterns, neuron lookup, morphology comparison, provenance links. | Exploration tools, not embodied simulators.[2][8] |
| **Community whole-connectome demos** | Recent repositories connect FlyWire-derived LIF networks to MuJoCo bodies or games and show compelling live neural visuals. | Useful prototypes and performance/UI ideas. | Claims such as “emergent behavior” need independent validation; several use the female FlyWire graph, custom mappings, or undocumented assumptions. Treat as experimental software, not established scientific results.[9] |
| **NEST GPU / Brian2CUDA** | General-purpose sparse spiking-network simulation on GPUs. | A route from a readable model to high-throughput trials. | They provide execution machinery, not fly-specific biological parameters.[10][11] |

## Recommended system architecture

```text
Virtual universe / physics
  MuJoCo + FlyGym body, terrain, objects, food, odor plumes, other flies
          | sensory observations                         ^ muscle commands
          v                                              |
Sensory transducers                              motor interface
  ommatidia, odor receptors, taste, touch,       descending neurons ->
  proprioception, temperature                    VNC circuits -> actuators
          |                                              ^
          v                                              |
MaleCNS neural runtime ----------------------------------+
  sparse signed graph + delays + neuron states + plastic synapses
          |
          +--> event/telemetry stream --> scientific dashboard + 3D brain
          +--> checkpoints, trial data, seeds, provenance, replay
```

Keep four layers separate:

- **Canonical biological graph:** immutable MaleCNS IDs, annotations, skeleton references, raw synapse counts, transmitter probabilities, and release version.
- **Model interpretation:** sign rules, weight normalization, delays, neuron equations, thresholds, noise, plasticity, and confidence. Every assumption is versioned.
- **Embodiment adapter:** maps physical sensor values into identified sensory populations and identified descending/motor activity into body control.
- **Experiment layer:** task, reward or reinforcement, stimulus schedule, lesions, parameter set, random seed, and evaluation measures.

This separation lets the same anatomy support a fast LIF baseline, a more detailed circuit-specific model, or a conventional neural controller constrained by the connectome.

## Data pipeline

Start with the official MaleCNS v1.0 resources, not scraped viewer data. The full weighted segment-to-segment graph is approximately 1.1 GB; annotations and aggregate neurotransmitter predictions are available as Feather files; synapse partners and points are much larger; skeletons are provided in SWC and Neuroglancer formats.[2]

1. Download annotations, neurotransmitter predictions, body statistics, and weighted connectivity.
2. Join on immutable body ID; retain confidence values and nulls.
3. Classify neurons into sensory, intrinsic/interneuron, ascending, descending, motor, modulatory, and uncertain sets.
4. Convert the edge list to a compressed sparse representation sorted by presynaptic neuron.
5. Infer excitatory/inhibitory sign only where transmitter evidence and receptor interpretation justify it. Store the inference and confidence, never overwrite the raw data.
6. Normalize synapse-count weights. Begin with the published Shiu-style baseline, then calibrate by cell class rather than inventing one global scale.
7. Add conduction/synaptic delays only as a documented model layer. Skeleton path length can inform delays, but conduction speed and synaptic kinetics remain assumptions unless measured.
8. Load morphology on demand. The simulation needs IDs and edges; the viewer fetches only selected skeletons and low-resolution neuropil meshes.
9. Build integrity tests: neuron/edge counts, no accidental ID coercion, transmitter probability sums, reproducible graph hashes, expected pathway queries, and stable results under file-order changes.

## Neural dynamics: a staged fidelity ladder

### Level 0 — graph propagation

Use deterministic activation spreading to test data ingestion, signs, pathways, UI, lesions, and sensor/motor routing. This is not a brain simulation, but it catches integration errors cheaply.

### Level 1 — whole-CNS point-neuron baseline

Implement event-driven or fixed-step LIF neurons:

`tau_m dV_i/dt = -(V_i - V_rest) + I_i(t)`

When neuron `i` crosses threshold, reset it and deliver signed, delayed input `w_ij` to postsynaptic neurons. Start with cell-class-specific time constants, refractory periods, baseline drive, and noise distributions. Reproduce the Shiu et al. central-brain experiments before extending to MaleCNS.[3]

### Level 2 — biologically relevant heterogeneity

Add transmitter-specific kinetics, graded transmission where supported, short-term facilitation/depression, realistic spontaneous drive, and distinct sensory, descending, VNC, motor, and modulatory cell parameters. Only add morphology-dependent compartments to circuits where dendritic computation materially affects the question.

### Level 3 — learning and internal state

Add plasticity locally, especially in mushroom-body compartments. Model Kenyon cell to mushroom-body-output-neuron (KC→MBON) plasticity gated by compartment-specific dopamine neurons (DANs). Hunger, thirst, arousal, and satiety should be latent physiological variables that modulate sensory gain, action selection, and reinforcement—not arbitrary global reward numbers. Work on dopamine-mediated short/long-term memory provides a useful connectome- and physiology-constrained template.[12]

Do not make every one of millions of synapses freely trainable. That destroys the value of the biological prior, makes interpretation difficult, and can compensate for broken sensor/motor mappings in biologically meaningless ways.

## Embodiment in the virtual universe

Use **FlyGym 2.x / NeuroMechFly v2** as the default substrate. It already supplies a realistic articulated adult body, MuJoCo physics, visual and olfactory sensing, difficult terrain, contact and adhesion, and interaction with objects and other flies. Its 2026 2.x implementation reports about 2× real-time CPU simulation and about 60× real-time GPU physics throughput, though end-to-end speed will depend on the neural runtime.[5]

The hard problem is the neural–body interface:

- **Vision:** render panoramic scenes into ommatidial channels; route them through identified visual input populations. Begin with looming, moving bars, optomotor stimuli, and target tracking before natural images.
- **Olfaction:** simulate turbulent or prerecorded odor fields; sample at left/right antennae; transduce through receptor-specific populations.
- **Taste:** activate identified gustatory receptor neurons only on proboscis or leg contact with material surfaces.
- **Mechanosensation/proprioception:** encode joint angle, angular velocity, strain/contact, haltere, and antennal signals into mapped sensory cells. This interface is essential for stable locomotion.
- **Motor output:** aggregate identified motor-neuron activity into muscle activation where mappings exist. Where incomplete, use a transparent hierarchical bridge: descending-neuron activity selects/modulates a validated locomotor primitive or central-pattern-generator controller.

That bridge is scientifically preferable to pretending that arbitrary spike-to-torque projections are biological. Expose it in the UI and ablate it in experiments.

## How to train the fly

“Training” should mean one of three different things; keep them distinct.

### 1. Biologically modeled associative learning

For odor or visual conditioning, represent the cue in projection-neuron/Kenyon-cell activity. Couple reward or punishment to the anatomically appropriate DAN compartments. Apply dopamine-gated plasticity primarily at KC→MBON synapses, then let MBON and downstream circuits bias action selection. This is the best route for scientifically interpretable learning.

Example curriculum:

1. Two odors, one paired with sugar.
2. Test choice with no reward.
3. Reverse the pairing.
4. Test extinction, retention, and generalization.
5. Compare DAN, KC, and MBON activity and lesion effects with published experiments.

### 2. Connectome-constrained machine learning

Use the MaleCNS adjacency as a fixed sparse topology while optimizing a limited set of edge gains, neuron-class parameters, or low-rank modulatory variables with surrogate gradients, evolutionary strategies, or policy gradients. Penalize deviation from raw synapse-count priors and keep held-out biological tasks. This can yield capable agents but should be labeled engineered connectome-constrained learning, not native fly learning.

### 3. Hierarchical reinforcement learning for the body

Train low-level locomotor primitives by imitation learning from fly kinematics, then let descending-neuron outputs choose primitives, steering, speed, posture, or wing state. This is the fastest practical path to walking and navigation. NeuroMechFly already demonstrates RL and hybrid controllers, and its ecosystem includes muscle imitation-learning examples.[4][13]

Recommended task sequence:

| Phase | Task | Success metrics |
|---|---|---|
| Sensor calibration | flashes, motion, odor pulse, joint perturbation | response latency, tuning curve, laterality |
| Reflexes | looming escape, proboscis extension, grooming trigger | action probability and latency under graded stimuli |
| Stable locomotion | stand, walk, turn, recover from perturbation | fall rate, speed, gait phase, energy |
| Navigation | odor source with obstacle; visual target following | arrival rate, path efficiency, collision rate |
| Learning | odor/reward association and reversal | preference index, trials to criterion, retention |
| Male-specific behavior | courtship sequence or aggression components | sequence transitions, context dependence, dimorphic-circuit ablations |

Use curriculum learning, randomized terrain and sensory noise, and many short parallel trials. Save all seeds and pre/post-training parameters. Never evaluate only in the training world.

## Visualization design

A proper visualization is not a giant glowing hairball. Build four synchronized views around a shared simulation clock:

1. **World view:** high-quality 3D fly, terrain, odors, contacts, forces, gaze rays, and trajectory. MuJoCo provides scientific rendering; a Unity/Unreal or Three.js client can provide a more cinematic public-facing view while remaining driven by recorded simulation state.
2. **Brain anatomy view:** neuropil shells plus on-demand SWC neuron skeletons. Color by membrane potential or recent spike rate, with separate styling for excitation, inhibition, and uncertain sign. Use level of detail and GPU instancing.
3. **Circuit view:** a filtered causal subgraph—selected sensory cells → active intermediates → descending/motor cells—with edge thickness based on transmitted current, not raw connectivity alone.
4. **Scientific dashboard:** raster plot, population rates, DAN/MBON traces, joint angles, muscle activation, reward events, state variables, trial markers, and behavioral metrics.

Essential interactions:

- click a body part to reveal active sensor-to-motor pathways;
- click a neuron to show ID, type, transmitter confidence, neuropils, inputs/outputs, morphology, and raw-data link;
- scrub, slow, pause, step, branch from a checkpoint, and compare two runs;
- inject current, stimulate a cell type, silence/lesion neurons, freeze plasticity, or alter internal state;
- show a “model assumption” badge for every inferred sign, parameter, or engineered adapter;
- switch among spike events, voltage, synaptic current, calcium-like low-pass signal, and population activity;
- replay deterministically from a compact event log.

For scale, stream spikes as compact `(time, neuron_id)` events and compute aggregates server-side. At normal zoom, render neuropil/cell-type heatmaps; at close zoom, render thousands—not all 166,000—of active or selected skeletons. Store full-resolution neural data in chunked arrays for offline analysis, but use downsampled telemetry live.

## Validation: what makes it science

Use a hierarchy of tests:

- **Structural:** reproduce known cell counts, pathway connectivity, bilateral symmetry/asymmetry, neuropil distributions, and transmitter composition.
- **Unit/circuit:** tuning curves, latencies, sign, and responses under activation/silencing.
- **Behavioral:** speed, gait, turning, optomotor response, looming escape, odor taxis, taste response, grooming, learning curves, and state dependence.
- **Causal:** predict the effect of activating, silencing, or lesioning a neuron/type, then compare with published optogenetic experiments.
- **Generalization:** fit on some stimuli and predict different intensities, combinations, contexts, or genotypes.
- **Robustness:** parameter ensembles, confidence intervals, and sensitivity to uncertain connections and model parameters.

The Shiu et al. result is the right standard: the model should generate testable predictions, and at least some should be checked against independent experiments.[3]

## Practical implementation plan

### Milestone A — six-to-eight-week demonstrator

- Ingest MaleCNS annotations, neurotransmitters, and weighted adjacency.
- Implement deterministic graph propagation and a CPU LIF baseline.
- Build one FlyGym arena and connect a small, biologically identified sensorimotor pathway.
- Deliver synchronized world, neuropil, raster, and selected-neuron views.
- Reproduce one published stimulus-response result.

### Milestone B — three-to-six-month research prototype

- Move sparse spikes to GPU; add delays, class parameters, checkpoints, and deterministic replay.
- Integrate vision, odor, proprioception, and transparent descending-to-motor bridging.
- Implement stable walking plus odor taxis and looming escape.
- Add lesion/stimulation experiments and automated parameter sweeps.
- Add a mushroom-body associative-learning task.

### Milestone C — six-to-eighteen-month platform

- Replace engineered adapters with mapped VNC/muscle pathways as evidence permits.
- Fit neural parameters to electrophysiology/calcium data using simulation-based inference.
- Run parameter ensembles instead of presenting a single arbitrary “fly.”
- Validate novel causal predictions with a collaborating fly-neuroscience laboratory.
- Add multi-fly courtship/aggression environments and male–female connectome comparisons.

## Suggested software stack

| Layer | First choice | Rationale |
|---|---|---|
| Data/analysis | Python, Polars/PyArrow, neuprint-python, NetworkX/igraph, NAVis | Direct compatibility with official tables and morphology tooling |
| Neural prototype | Brian2 or a small custom sparse LIF engine | Fast iteration and readable equations |
| Neural scale-up | NEST GPU, Brian2CUDA, or custom CUDA/JAX sparse event engine | Large sparse spiking networks and batched experiments |
| Body/world | FlyGym 2.x + MuJoCo/MJWarp | Best existing adult-fly embodiment and task ecosystem |
| Experiment API | Gymnasium-compatible environments + Hydra-style versioned configs | Repeatable tasks and sweeps |
| Storage | Parquet for tables; Zarr/HDF5 for timeseries; JSON metadata | Chunked, replayable, provenance-aware results |
| Visualization | Python scientific dashboard first; Three.js/WebGPU public viewer later | Quick validation followed by accessible, polished 3D |
| Reproducibility | containers, graph/config hashes, seed manifests, CI fixture circuits | Prevents silent data/model drift |

On Windows, WSL2/Linux is the least-friction environment for CUDA neuroscience tools and MuJoCo pipelines. A modern NVIDIA GPU with ample VRAM is useful, but first profile a representative graph: memory is dominated by edge state and logging, not merely 166,000 neuron states. Batch training worlds and high-detail neural logging compete for GPU memory, so run the physics and neural engines on separate devices or stagger logging if needed.

## Main scientific and engineering risks

- **Connectome ≠ physiology:** synapse count is not synaptic efficacy; transmitter identity alone may not determine effect without receptors.
- **Unknown initial state:** spontaneous activity, metabolic state, hormonal state, and prior experience are not recovered from EM.
- **Interface circularity:** a learned arbitrary sensory or motor adapter can manufacture convincing behavior while bypassing the connectome.
- **Motor complexity:** stable whole-body control may require VNC, muscle, sensory-feedback, and mechanical details that remain incomplete.
- **Overfitting:** millions of tunable gains can fit tasks without discovering biological mechanisms.
- **Visualization deception:** smooth animation and glowing neurons can look more validated than the underlying model is.
- **Compute and telemetry:** logging every neuron every sub-millisecond creates more difficulty than simulating simple point neurons.
- **Ethics and language:** there is no evidence that a point-neuron connectome model is conscious or experiences suffering, but avoid sensational claims and predefine ethical review triggers as models gain physiological detail.

## The best first experiment

Build an **odor-conditioned navigation arena**. It exercises sensing, action, learning, embodiment, and visualization without requiring full natural vision or flight.

- Two odor sources are placed in an arena; one is paired with sugar contact during training.
- Antennal odor signals enter known olfactory populations; sparse Kenyon-cell activity represents odor identity.
- Reward activates an appropriate appetitive DAN compartment; KC→MBON synapses undergo constrained plasticity.
- MBON/downstream population activity biases left/right descending steering signals.
- A validated FlyGym walking controller handles gait mechanics while the brain controls direction and speed.
- The viewer shows plume concentration, antennal input, KC sparsity, dopamine events, changing KC→MBON weights, MBON choice signal, descending activity, and the resulting path.
- Evaluation uses unrewarded probe trials, reversal, novel plume geometry, lesions, frozen-plasticity controls, and multiple parameter seeds.

This yields a compelling visual demo while preserving a scientifically interpretable chain from environment to sensor to plastic circuit to action.

## Immediate repository layout

```text
fly-universe/
  data-manifest/        # URLs, licenses, hashes; no undocumented copies
  connectome/           # ingestion, canonical IDs, sparse graph, queries
  dynamics/             # equations, neuron/synapse families, GPU kernels
  embodiment/           # FlyGym worlds and sensor/motor adapters
  learning/             # dopamine rules, imitation/RL curricula
  experiments/          # immutable configs and validation protocols
  telemetry/            # event schema, recording, replay, aggregation
  viewer/               # world, anatomy, circuit, dashboard clients
  tests/                # fixture circuits, pathways, determinism, benchmarks
  reports/              # result cards, figures, assumption register
```

The first files to freeze are a **model card**, an **assumption register**, and a **validation matrix**. These are as important as the simulator: they make clear which behavior comes from data, which from a model equation, which from training, and which from an engineered bridge.

## Sources

1. Google Research. “[A connectomics milestone: Mapping the complete male fruit fly brain](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/).” September 3, 2026.
2. HHMI Janelia FlyEM. “[Male CNS Connectome](https://male-cns.janelia.org/)” and “[Download](https://male-cns.janelia.org/download/).” MaleCNS v1.0, 2026.
3. Shiu, P. K. et al. “[A Drosophila computational brain model reveals sensorimotor processing](https://www.nature.com/articles/s41586-024-07763-9).” *Nature* 2024.
4. Lobato-Rios, V. et al. “[NeuroMechFly v2: simulating embodied sensorimotor control in adult Drosophila](https://www.nature.com/articles/s41592-024-02497-y).” *Nature Methods* 2025.
5. NeuroMechFly. “[FlyGym / NeuroMechFly documentation](https://neuromechfly.org/).” Accessed September 2026.
6. Givon, L. E. and Lazar, A. A. “[Neurokernel: An Open Source Platform for Emulating the Fruit Fly Brain](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0146581).” *PLOS ONE* 2016.
7. Lazar, A. A. et al. “[Accelerating with FlyBrainLab the discovery of the functional logic of the Drosophila brain in the connectomic and synaptomic era](https://pmc.ncbi.nlm.nih.gov/articles/PMC8016480/).” *eLife* 2021.
8. Virtual Fly Brain. “[About Virtual Fly Brain](https://www.virtualflybrain.org/about/).” Accessed September 2026.
9. rndlabsoy. “[Embodied Drosophila: whole-brain connectome simulation](https://github.com/rndlabsoy/fly-brain-full).” Community repository; accessed September 2026.
10. NEST Initiative. “[NEST GPU documentation](https://nest-gpu.readthedocs.io/en/latest/).” Accessed September 2026.
11. Brian team. “[Brian2CUDA](https://github.com/brian-team/brian2cuda).” Accessed September 2026.
12. Huang, C. et al. “[Dopamine-mediated interactions between short- and long-term memory dynamics](https://www.nature.com/articles/s41586-024-07819-w).” *Nature* 2024.
13. NeuroMechFly. “[Muscle-based imitation learning](https://neuromechfly.org/tutorials/6_muscle_imitation/).” Accessed September 2026.
