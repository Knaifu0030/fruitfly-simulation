# Contributing

Contributions are welcome, especially in connectome preprocessing, neural dynamics, FlyGym/MuJoCo embodiment, scientific validation, accessible explanation, and high-performance visualization.

## Before opening a pull request

1. Do not commit MaleCNS source files or generated derivatives.
2. Do not commit credentials, neuPrint tokens, experiment recordings, or model checkpoints.
3. Preserve raw body IDs and dataset provenance.
4. Label new biological interpretations with a primary source.
5. Label assumptions and engineered adapters explicitly.
6. Run `npm run build` and the applicable Python scripts/tests.
7. Update documentation when an interface, schema, data-selection rule, or scientific claim changes.

## Scientific claims

Prefer precise descriptions such as “the model produced increased activity in an appetitive DAN population” over anthropomorphic conclusions. Novel behavioral claims need reproducible experiment configurations, seeds, metrics, controls, and limitations.

## Data contributions

Submit manifests, download instructions, transforms, and checks—not copyrighted or externally hosted datasets themselves. Clearly state upstream licenses and attribution requirements.
