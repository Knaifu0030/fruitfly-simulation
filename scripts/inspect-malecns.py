from pathlib import Path

import pyarrow as pa
from pyarrow import feather, ipc

RAW = Path(__file__).resolve().parents[1] / "data" / "malecns-v1.0" / "raw"


for path in sorted(RAW.glob("*.feather")):
    with pa.memory_map(str(path), "r") as source:
        reader = ipc.RecordBatchFileReader(source)
        rows = feather.read_table(str(path), columns=[], memory_map=True).num_rows
        print(f"\n{path.name}")
        print(f"  rows: {rows:,}")
        print(f"  columns: {len(reader.schema)}")
        print(reader.schema)
