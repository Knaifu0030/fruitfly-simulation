from collections import Counter
from pathlib import Path

from pyarrow import feather

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "data" / "malecns-v1.0" / "raw" / "body-annotations-male-cns-v1.0-minconf-0.5.feather"
columns = [
    "bodyId", "status", "statusLabel", "superclass", "class", "subclass",
    "type", "instance", "somaSide", "rootSide", "somaNeuromere",
    "entryNerve", "exitNerve", "receptorType", "dimorphism", "fruDsx",
    "somaLocation",
]
table = feather.read_table(path, columns=columns, memory_map=True)

print(f"rows={table.num_rows:,}")
for name in ["status", "statusLabel", "superclass", "class", "subclass", "somaNeuromere", "dimorphism"]:
    values = table[name].to_pylist()
    counts = Counter("(null)" if value is None else str(value) for value in values)
    print(f"\n{name} ({len(counts)} values)")
    for value, count in counts.most_common(30):
        print(f"  {value}: {count:,}")

print(f"\nwith_soma={sum(value is not None for value in table['somaLocation'].to_pylist()):,}")
