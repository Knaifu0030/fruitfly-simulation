from __future__ import annotations

import json
import struct
from collections import Counter
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.parquet as pq
from pyarrow import feather

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "malecns-v1.0" / "raw"
PROCESSED = ROOT / "data" / "malecns-v1.0" / "processed"
PUBLIC = ROOT / "viewer" / "public" / "data"

CATEGORIES = [
    {"key": "learning", "label": "Learning & reward", "plain": "Circuits associated with learning, memory, reward signals and learned value.", "color": "#f2b84b"},
    {"key": "sensory", "label": "Sensory input", "plain": "Neurons carrying sight, smell, taste, touch, temperature and body-sense information.", "color": "#53c7d6"},
    {"key": "motor", "label": "Motor output", "plain": "Neurons that ultimately influence muscles and physical action.", "color": "#ee6b63"},
    {"key": "descending", "label": "Brain → body", "plain": "Descending pathways carrying commands from the brain toward the ventral nerve cord.", "color": "#c88cf2"},
    {"key": "ascending", "label": "Body → brain", "plain": "Ascending pathways carrying processed body information toward the brain.", "color": "#78d98b"},
    {"key": "processing", "label": "Internal processing", "plain": "Intrinsic neurons that transform and combine information within the brain or nerve cord.", "color": "#a6afbd"},
    {"key": "other", "label": "Other / unresolved", "plain": "Traced neurons whose role is not represented by the broad public-facing categories.", "color": "#68717e"},
]
CATEGORY_INDEX = {item["key"]: i for i, item in enumerate(CATEGORIES)}


def text(value: object) -> str:
    return "" if value is None else str(value)


def category_for(superclass: str, class_name: str) -> str:
    if class_name in {"Kenyon_Cell", "DAN", "MBON"}:
        return "learning"
    if "sensory" in superclass or class_name in {
        "visual", "olfactory", "gustatory", "chemosensory", "hygrosensory",
        "thermosensory", "mechanosensory", "mechanosensory_tactile",
        "mechanosensory_proprioceptive", "unknown_sensory",
    }:
        return "sensory"
    if "motor" in superclass or "efferent" in superclass:
        return "motor"
    if "descending" in superclass:
        return "descending"
    if "ascending" in superclass:
        return "ascending"
    if "intrinsic" in superclass or superclass in {"visual_projection", "visual_centrifugal"}:
        return "processing"
    return "other"


def main() -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    path = RAW / "body-annotations-male-cns-v1.0-minconf-0.5.feather"
    source = feather.read_table(path, memory_map=True)
    traced = source.filter(pc.equal(source["status"], "Traced"))

    pq.write_table(traced, PROCESSED / "neurons.parquet", compression="zstd")

    rows: list[dict[str, object]] = []
    class_values: set[str] = set()
    super_values: set[str] = set()
    type_values: set[str] = set()
    side_values: set[str] = set()
    category_counts: Counter[str] = Counter()

    wanted = traced.select(["bodyId", "somaLocation", "superclass", "class", "type", "rootSide"])
    for body_id, soma, superclass, class_name, type_name, side in zip(
        wanted["bodyId"].to_pylist(),
        wanted["somaLocation"].to_pylist(),
        wanted["superclass"].to_pylist(),
        wanted["class"].to_pylist(),
        wanted["type"].to_pylist(),
        wanted["rootSide"].to_pylist(),
    ):
        if soma is None or len(soma) < 3:
            continue
        superclass_s, class_s, type_s, side_s = map(text, (superclass, class_name, type_name, side))
        category = category_for(superclass_s, class_s)
        category_counts[category] += 1
        class_values.add(class_s)
        super_values.add(superclass_s)
        type_values.add(type_s)
        side_values.add(side_s)
        rows.append({
            "body": int(body_id), "x": float(soma[0]), "y": float(soma[1]), "z": float(soma[2]),
            "category": category, "class": class_s, "superclass": superclass_s,
            "type": type_s, "side": side_s,
        })

    classes = sorted(class_values)
    supers = sorted(super_values)
    types = sorted(type_values)
    sides = sorted(side_values)
    class_index = {value: i for i, value in enumerate(classes)}
    super_index = {value: i for i, value in enumerate(supers)}
    type_index = {value: i for i, value in enumerate(types)}
    side_index = {value: i for i, value in enumerate(sides)}

    mins = [min(float(row[axis]) for row in rows) for axis in ("x", "y", "z")]
    maxs = [max(float(row[axis]) for row in rows) for axis in ("x", "y", "z")]
    centers = [(a + b) / 2 for a, b in zip(mins, maxs)]
    scale = max(b - a for a, b in zip(mins, maxs))

    # 24-byte little-endian record: xyz, body ID, category, class, superclass,
    # side, type index, flags/padding. Coordinates are centered and normalized.
    record = struct.Struct("<fffIBBBBHBB")
    binary_path = PUBLIC / "brain-somas.bin"
    with binary_path.open("wb") as output:
        for row in rows:
            xyz = [(float(row[axis]) - centers[i]) / scale for i, axis in enumerate(("x", "y", "z"))]
            output.write(record.pack(
                xyz[0], xyz[1], xyz[2], int(row["body"]),
                CATEGORY_INDEX[str(row["category"])], class_index[str(row["class"])],
                super_index[str(row["superclass"])], side_index[str(row["side"])],
                type_index[str(row["type"])], 0, 0,
            ))

    metadata = {
        "dataset": "MaleCNS v1.0",
        "source": "https://male-cns.janelia.org/",
        "record_bytes": record.size,
        "visible_somas": len(rows),
        "traced_neurons": traced.num_rows,
        "annotated_segments": source.num_rows,
        "coordinate_units": "normalized from MaleCNS 8 nm voxel coordinates",
        "categories": [dict(item, count=category_counts[item["key"]]) for item in CATEGORIES],
        "dictionaries": {"classes": classes, "superclasses": supers, "types": types, "sides": sides},
        "bounds_raw": {"min": mins, "max": maxs, "center": centers, "normalization_scale": scale},
        "scientific_note": "Points are soma locations, not full neuron morphologies. Functional labels describe evidence-supported circuit associations, not subjective experience.",
    }
    (PUBLIC / "brain-metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    summary = {
        "annotated_segments": source.num_rows,
        "traced_neurons": traced.num_rows,
        "traced_neurons_with_soma": len(rows),
        "category_counts": dict(category_counts),
        "viewer_binary_bytes": binary_path.stat().st_size,
    }
    (PROCESSED / "dataset-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
