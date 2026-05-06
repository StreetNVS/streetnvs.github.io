#!/usr/bin/env python3
"""Recompress every .mp4 under ``website/assets`` so the static site fits
into a small upload budget (target: 50–80 MB total).

Defaults are tuned for the StreetNVS asset tree (832×480 to 1280×854
clips, 49–81 frames, 10 fps): re-encode with libx264 at CRF 32 and
downscale anything wider than 720 px. Audio is stripped. The +faststart
flag is set so videos start playing without buffering the whole file.

Usage:
  python compress_videos.py                     # in-place re-encode under ./website/assets
  python compress_videos.py --crf 34            # smaller files, slightly softer
  python compress_videos.py --max-width 640
  python compress_videos.py --dry-run           # show what would happen
  python compress_videos.py --skip-smaller-than 200000

The script is idempotent in the sense that a second run on already-
compressed files just makes them slightly smaller again; pass
``--skip-smaller-than <bytes>`` to leave already-tiny files alone.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_ASSETS = ROOT / "website" / "assets"

# Fallback ffmpeg locations to try if `ffmpeg` is not on PATH.
FFMPEG_FALLBACKS = [
    "/users/zhengfei/zhengfei/conda_env/streetcrafter/bin/ffmpeg",
]
LIB_FALLBACKS = [
    "/users/zhengfei/zhengfei/conda_env/streetcrafter/lib",
]


def find_ffmpeg(explicit: str | None) -> tuple[str, dict[str, str]]:
    env = os.environ.copy()
    if explicit:
        return explicit, env
    found = shutil.which("ffmpeg")
    if found:
        return found, env
    for cand in FFMPEG_FALLBACKS:
        if Path(cand).exists():
            extra = ":".join(p for p in LIB_FALLBACKS if Path(p).exists())
            if extra:
                env["LD_LIBRARY_PATH"] = (
                    extra + ":" + env.get("LD_LIBRARY_PATH", "")
                ).rstrip(":")
            return cand, env
    sys.exit("error: ffmpeg not found. Pass --ffmpeg /path/to/ffmpeg.")


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def encode_one(
    src: Path,
    ffmpeg: str,
    env: dict[str, str],
    crf: int,
    max_width: int,
    preset: str,
) -> None:
    tmp = src.with_suffix(src.suffix + ".tmp.mp4")
    # `scale=...:flags=lanczos` only downscales when larger than max_width.
    vf = (
        f"scale='if(gt(iw,{max_width}),{max_width},iw)':"
        f"'if(gt(iw,{max_width}),trunc(ih*{max_width}/iw/2)*2,ih)':flags=lanczos"
    )
    cmd = [
        ffmpeg, "-y", "-loglevel", "error", "-i", str(src),
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-pix_fmt", "yuv420p", "-vf", vf,
        "-movflags", "+faststart",
        "-an", str(tmp),
    ]
    subprocess.run(cmd, check=True, env=env)
    os.replace(tmp, src)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--assets", type=Path, default=DEFAULT_ASSETS,
                    help=f"directory holding mp4s (default {DEFAULT_ASSETS})")
    ap.add_argument("--crf", type=int, default=32,
                    help="x264 CRF: higher → smaller/softer (default 32)")
    ap.add_argument("--max-width", type=int, default=720,
                    help="downscale anything wider than this (default 720)")
    ap.add_argument("--preset", default="veryfast",
                    help="x264 preset (default veryfast)")
    ap.add_argument("--skip-smaller-than", type=int, default=0,
                    help="leave files already ≤ this many bytes alone")
    ap.add_argument("--ffmpeg", default=None, help="override ffmpeg binary")
    ap.add_argument("--dry-run", action="store_true",
                    help="list files and totals, do not re-encode")
    args = ap.parse_args()

    if not args.assets.is_dir():
        sys.exit(f"error: assets dir not found: {args.assets}")

    ffmpeg, env = find_ffmpeg(args.ffmpeg)

    files = sorted(args.assets.rglob("*.mp4"))
    if not files:
        sys.exit(f"error: no .mp4 under {args.assets}")

    before_total = sum(f.stat().st_size for f in files)
    print(f"found {len(files)} mp4(s) totaling {human_size(before_total)} "
          f"under {args.assets}")
    print(f"settings: crf={args.crf}, max_width={args.max_width}, "
          f"preset={args.preset}, skip<={args.skip_smaller_than}B")

    if args.dry_run:
        return

    after_total = 0
    skipped = 0
    for i, f in enumerate(files, start=1):
        sz = f.stat().st_size
        if args.skip_smaller_than and sz <= args.skip_smaller_than:
            after_total += sz
            skipped += 1
            print(f"[{i:3d}/{len(files)}] skip {human_size(sz):>9} {f.relative_to(args.assets)}")
            continue
        encode_one(f, ffmpeg, env, args.crf, args.max_width, args.preset)
        new_sz = f.stat().st_size
        after_total += new_sz
        delta = new_sz / sz if sz else 1.0
        print(f"[{i:3d}/{len(files)}] {human_size(sz):>9} → "
              f"{human_size(new_sz):>9}  ({delta*100:5.1f}%)  "
              f"{f.relative_to(args.assets)}")

    print()
    print(f"before: {human_size(before_total)}")
    print(f"after : {human_size(after_total)}  "
          f"(re-encoded {len(files) - skipped}, skipped {skipped})")
    print(f"ratio : {after_total / before_total * 100:.1f}%")


if __name__ == "__main__":
    main()
