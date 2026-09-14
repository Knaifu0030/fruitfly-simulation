# Local data directory

Biological datasets and generated derivatives are deliberately excluded from Git.

The tracked `malecns-v1.0/manifest.json` records the official source URLs, expected byte sizes, version, and license. Run `python scripts/download-malecns.py` to reproduce the local raw-data directory. See [Data Guide](../docs/DATA.md) for storage tiers, attribution, and validation details.
