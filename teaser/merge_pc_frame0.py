#!/usr/bin/env python3
"""Merge a 0.01-sub-sampled background point cloud with frame-0 actors.

Background source:
    waymo_vace_val_ratio0.111/vace_stride_global_ratio0.01_scale0.02/pc/0NN.ply
    (already in world coordinates; carries x,y,z,r,g,b,timestamp)

Actor source:
    processed_streetcrafter/validation/0NN/lidar/actor/<id>/000000.ply
    (actor-local; x,y,z,r,g,b,mask,camera_mask) +
    processed_streetcrafter/validation/0NN/track/track_info.pkl
    (rigid pose at frame 000000: lidar_box.center_{x,y,z} + heading)

Output schema is the minimal common subset — x,y,z,r,g,b — written to
``paper_materials/teaser/scene{NNN}/scene_static.ply``.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np

OUT_DTYPE = np.dtype([
    ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
    ("r", "u1"), ("g", "u1"), ("b", "u1"),
])

SRC_ROOT = Path("/scratch/m000051/adsun/data_waymo/processed_streetcrafter/validation")
BG_ROOT  = Path(
    "/scratch/m000051/zhengfei/datasets/waymo_zhengfei/waymo_vace_val_ratio0.111/"
    "vace_stride_global_ratio0.01_scale0.02/pc"
)
OUT_ROOT  = Path(__file__).resolve().parent
SCENES    = ["002", "005", "010", "011", "015"]
FRAME_TAG = "000000"


def _parse_header(f):
    """Read a binary-little-endian PLY header; return (vertex_count, dtype)."""
    n = None
    fields = []
    while True:
        ln = f.readline()
        if not ln:
            raise RuntimeError("unexpected EOF in PLY header")
        s = ln.decode("ascii", errors="replace").strip()
        if s.startswith("element vertex"):
            n = int(s.split()[-1])
        elif s.startswith("property"):
            parts = s.split()
            ty, name = parts[1], parts[-1]
            np_ty = {
                "float": "<f4", "float32": "<f4",
                "uchar": "u1", "uint8": "u1",
                "ushort": "<u2", "uint16": "<u2",
                "short": "<i2", "int16": "<i2",
                "int": "<i4", "int32": "<i4",
            }[ty]
            fields.append((name, np_ty))
        elif s == "end_header":
            break
    if n is None:
        raise RuntimeError("no 'element vertex' line in PLY header")
    return n, np.dtype(fields)


def read_binary_ply(path: Path) -> np.ndarray:
    with open(path, "rb") as f:
        n, dt = _parse_header(f)
        if n == 0:
            return np.empty((0,), dtype=dt)
        return np.frombuffer(f.read(), dtype=dt, count=n).copy()


def to_xyzrgb(verts: np.ndarray) -> np.ndarray:
    """Project any input record array down to (x,y,z,r,g,b)."""
    out = np.empty(len(verts), dtype=OUT_DTYPE)
    for fld in ("x", "y", "z"):
        out[fld] = verts[fld].astype(np.float32)
    # source files use property names red/green/blue or r/g/b (we wrote r/g/b before)
    rmap = {"red": "r", "green": "g", "blue": "b", "r": "r", "g": "g", "b": "b"}
    for src in verts.dtype.names:
        if src in rmap:
            out[rmap[src]] = verts[src].astype(np.uint8)
    return out


def write_binary_ply(path: Path, verts: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {len(verts)}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property uchar red\n"
        "property uchar green\n"
        "property uchar blue\n"
        "end_header\n"
    ).encode("ascii")
    with open(path, "wb") as f:
        f.write(header)
        f.write(verts.tobytes())


def transform_actor(verts_xyzrgb: np.ndarray, box: dict) -> np.ndarray:
    if len(verts_xyzrgb) == 0:
        return verts_xyzrgb
    cx, cy, cz = box["center_x"], box["center_y"], box["center_z"]
    h = box["heading"]
    cos_h, sin_h = np.cos(h), np.sin(h)
    out = verts_xyzrgb.copy()
    out["x"] = (cos_h * verts_xyzrgb["x"] - sin_h * verts_xyzrgb["y"] + cx).astype(np.float32)
    out["y"] = (sin_h * verts_xyzrgb["x"] + cos_h * verts_xyzrgb["y"] + cy).astype(np.float32)
    out["z"] = (verts_xyzrgb["z"] + cz).astype(np.float32)
    return out


def merge_one_scene(scene_id: str) -> None:
    bg_path    = BG_ROOT / f"{scene_id}.ply"
    src_dir    = SRC_ROOT / scene_id
    track_pkl  = src_dir / "track" / "track_info.pkl"
    actor_root = src_dir / "lidar" / "actor"

    bg_xyzrgb = to_xyzrgb(read_binary_ply(bg_path))
    print(f"[s{scene_id}] bg (0.01-sub): {len(bg_xyzrgb):>6d} pts")

    track = pickle.load(open(track_pkl, "rb"))
    frame_tracks = track.get(FRAME_TAG, {})

    chunks = [bg_xyzrgb]
    actor_total, actor_count = 0, 0
    for actor_dir in sorted(actor_root.iterdir()):
        actor_id = actor_dir.name
        ply_path = actor_dir / f"{FRAME_TAG}.ply"
        if not ply_path.exists():
            continue
        info = frame_tracks.get(actor_id)
        if info is None or info.get("lidar_box") is None:
            continue
        verts = to_xyzrgb(read_binary_ply(ply_path))
        if len(verts) == 0:
            continue
        chunks.append(transform_actor(verts, info["lidar_box"]))
        actor_total += len(verts)
        actor_count += 1

    merged = np.concatenate(chunks)
    out = OUT_ROOT / f"scene{int(scene_id):03d}" / "scene_static.ply"
    write_binary_ply(out, merged)
    print(f"[s{scene_id}]     actors: {actor_total:>6d} pts ({actor_count} actors)")
    print(f"[s{scene_id}]    merged: {len(merged):>6d} pts -> {out}")


def main():
    for s in SCENES:
        merge_one_scene(s)


if __name__ == "__main__":
    main()
