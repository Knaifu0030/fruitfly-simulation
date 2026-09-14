from __future__ import annotations

import argparse
import json
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data" / "malecns-v1.0" / "manifest.json"
RAW_DIR = ROOT / "data" / "malecns-v1.0" / "raw"
CHUNK_SIZE = 8 * 1024 * 1024


def feather_signature_is_valid(path: Path) -> bool:
    if path.stat().st_size < 12:
        return False
    with path.open("rb") as source:
        head = source.read(6)
        source.seek(-6, 2)
        tail = source.read(6)
    return head == b"ARROW1" and tail == b"ARROW1"


def download(url: str, destination: Path, expected_bytes: int) -> None:
    existing = destination.stat().st_size if destination.exists() else 0
    if existing == expected_bytes and feather_signature_is_valid(destination):
        print(f"ready  {destination.name} ({expected_bytes:,} bytes)")
        return
    if existing > expected_bytes:
        raise RuntimeError(f"{destination} is larger than the official object; remove it manually")

    request = urllib.request.Request(url)
    if existing:
        request.add_header("Range", f"bytes={existing}-")
    mode = "ab" if existing else "wb"
    try:
        with urllib.request.urlopen(request) as response, destination.open(mode) as output:
            while chunk := response.read(CHUNK_SIZE):
                output.write(chunk)
                existing += len(chunk)
                percent = existing / expected_bytes * 100
                print(f"\rfetch  {destination.name}: {percent:6.2f}%", end="", flush=True)
    except urllib.error.HTTPError as error:
        if error.code == 416 and destination.stat().st_size == expected_bytes:
            pass
        else:
            raise
    print()
    if destination.stat().st_size != expected_bytes:
        raise RuntimeError(
            f"size mismatch for {destination.name}: "
            f"{destination.stat().st_size:,} != {expected_bytes:,}"
        )
    if not feather_signature_is_valid(destination):
        raise RuntimeError(f"invalid Arrow/Feather signature: {destination.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download and verify MaleCNS v1.0 bulk tables")
    parser.add_argument(
        "--minimal",
        action="store_true",
        help="download annotations, aggregate transmitters, stats, and weighted graph only",
    )
    args = parser.parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    files = manifest["files"]
    if args.minimal:
        files = files[:4]
    required = sum(item["bytes"] for item in files)
    free = shutil.disk_usage(ROOT).free
    safety_margin = 5 * 1024**3
    if free < required + safety_margin:
        raise RuntimeError(
            f"insufficient disk space: {free / 1024**3:.1f} GiB free; "
            f"need about {(required + safety_margin) / 1024**3:.1f} GiB"
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    print(f"MaleCNS {manifest['version']} -> {RAW_DIR}")
    print(f"planned download: {required / 1024**3:.2f} GiB")
    for item in files:
        download(f"{manifest['base_url']}/{item['name']}", RAW_DIR / item["name"], item["bytes"])
    print("All requested files are present and structurally verified.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted. Run the command again to resume.", file=sys.stderr)
        raise SystemExit(130)
