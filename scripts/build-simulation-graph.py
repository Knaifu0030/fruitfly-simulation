from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from pyarrow import feather, ipc

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "malecns-v1.0" / "raw"
PROCESSED = ROOT / "data" / "malecns-v1.0" / "processed"


def map_ids(values: np.ndarray, sorted_ids: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    positions = np.searchsorted(sorted_ids, values)
    inside = positions < sorted_ids.size
    matched = np.zeros(values.size, dtype=bool)
    matched[inside] = sorted_ids[positions[inside]] == values[inside]
    return positions.astype(np.uint32, copy=False), matched


def main() -> None:
    start = time.monotonic()
    PROCESSED.mkdir(parents=True, exist_ok=True)

    annotation_path = RAW / "body-annotations-male-cns-v1.0-minconf-0.5.feather"
    annotations = feather.read_table(annotation_path, columns=["bodyId", "status"], memory_map=True)
    traced = annotations.filter(pc.equal(annotations["status"], "Traced"))
    body_ids = np.sort(traced["bodyId"].to_numpy(zero_copy_only=False).astype(np.int64, copy=False))
    index_table = pa.table({
        "neuron_index": pa.array(np.arange(body_ids.size, dtype=np.uint32)),
        "body_id": pa.array(body_ids),
    })
    pq.write_table(index_table, PROCESSED / "neuron-index.parquet", compression="zstd")

    edge_path = RAW / "connectome-weights-male-cns-v1.0-minconf-0.5.feather"
    output_path = PROCESSED / "connections.parquet"
    total_input = 0
    total_kept = 0
    batch_count = 0
    writer: pq.ParquetWriter | None = None
    out_degree = np.zeros(body_ids.size, dtype=np.uint64)
    in_degree = np.zeros(body_ids.size, dtype=np.uint64)

    try:
        with pa.memory_map(str(edge_path), "r") as source:
            reader = ipc.RecordBatchFileReader(source)
            for batch_number in range(reader.num_record_batches):
                batch = reader.get_batch(batch_number)
                pre = batch.column("body_pre").to_numpy(zero_copy_only=False).astype(np.int64, copy=False)
                post = batch.column("body_post").to_numpy(zero_copy_only=False).astype(np.int64, copy=False)
                weight = batch.column("weight").to_numpy(zero_copy_only=False)
                total_input += batch.num_rows

                src, pre_match = map_ids(pre, body_ids)
                dst, post_match = map_ids(post, body_ids)
                keep = pre_match & post_match
                if not np.any(keep):
                    continue

                src_kept = src[keep]
                dst_kept = dst[keep]
                weight_kept = weight[keep]
                np.add.at(out_degree, src_kept, 1)
                np.add.at(in_degree, dst_kept, 1)
                output = pa.table({
                    "source": pa.array(src_kept, type=pa.uint32()),
                    "target": pa.array(dst_kept, type=pa.uint32()),
                    "synapse_count": pa.array(weight_kept, type=pa.int64()),
                })
                if writer is None:
                    writer = pq.ParquetWriter(output_path, output.schema, compression="zstd")
                writer.write_table(output, row_group_size=1_000_000)
                total_kept += output.num_rows
                batch_count += 1
                print(
                    f"batch {batch_number + 1}/{reader.num_record_batches}: "
                    f"read={total_input:,} kept={total_kept:,}",
                    flush=True,
                )
    finally:
        if writer is not None:
            writer.close()

    degree_table = pa.table({
        "neuron_index": pa.array(np.arange(body_ids.size, dtype=np.uint32)),
        "in_degree": pa.array(in_degree),
        "out_degree": pa.array(out_degree),
    })
    pq.write_table(degree_table, PROCESSED / "degrees.parquet", compression="zstd")

    summary_path = PROCESSED / "dataset-summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
    summary.update({
        "simulation_neurons": int(body_ids.size),
        "source_connection_rows": int(total_input),
        "simulation_connection_rows": int(total_kept),
        "connection_batches_written": batch_count,
        "connection_output_bytes": output_path.stat().st_size,
        "graph_processing_seconds": round(time.monotonic() - start, 2),
    })
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
