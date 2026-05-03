#!/usr/bin/env python3
"""Collect novel-view teaser material.

For each website scene in §1 we write:

    teaser/scene{NNN}/refs/cam{0..4}.jpg
        First-frame reference from each of the 5 source cameras.
    teaser/scene{NNN}/{traj}/{percent}.jpg          # percent ∈ {0,33,50,66,100}
        Five evenly-sampled frames from the generated novel-view clip
        for each trajectory (elevate / lane_shift / barron / rotate).
"""

from __future__ import annotations

from pathlib import Path

import cv2

# Scenes used by the website's §1, with their streetcrafter source-dir indices.
SCENES = [
    ("scene010", "010"),
    ("scene011", "011"),
    ("scene002", "002"),
    ("scene005", "005"),
    ("scene015", "015"),
]
TRAJS = ["elevate", "lane_shift", "barron", "rotate"]
PERCENTS = [0, 33, 50, 66, 100]
NUM_CAMS = 5

NV_RUN = Path(
    "/scratch/m000051/zhengfei/geo_synth/outputs_novelview/"
    "GeoI2VLoRA_waymo_multi_vace_UCPE_addref_frameidv3_stronglora_"
    "vacedepth_encodevacemask_bettercam"
)
SRC_ROOT = Path("/scratch/m000051/adsun/data_waymo/processed_streetcrafter/validation")
OUT_ROOT = Path(__file__).resolve().parent

def write_jpg(img, path: Path, q: int = 95) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, q])


def find_clip(scene_tag: str, traj: str) -> Path | None:
    """`scene_tag` is the s<n> form used in the run filenames (e.g. s10)."""
    for p in NV_RUN.glob(f"sample_*_{scene_tag}_c{traj}_generated.mp4"):
        return p
    return None


def extract_percent_frames(clip: Path, out_dir: Path, percents):
    cap = cv2.VideoCapture(str(clip))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if n <= 0:
        cap.release()
        print(f"  ! empty clip: {clip}")
        return
    for p in percents:
        idx = max(0, min(n - 1, round((p / 100) * (n - 1))))
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            print(f"  ! couldn't read frame {idx} of {clip.name}")
            continue
        write_jpg(frame, out_dir / f"{p:03d}.jpg")
    cap.release()


def copy_first_frame(src_png: Path, out_path: Path):
    """Source frames are JPEG-encoded with .png extension; cv2 reads by content."""
    img = cv2.imread(str(src_png), cv2.IMREAD_COLOR)
    if img is None:
        print(f"  ! couldn't read {src_png}")
        return
    write_jpg(img, out_path)


def main():
    for scene_dir, src_idx in SCENES:
        s_tag = f"s{int(src_idx)}"   # scene010 -> s10, scene002 -> s2, ...
        scene_out = OUT_ROOT / scene_dir

        # Reference images: first frame of each camera (0 = front, 1–4 = sides).
        for c in range(NUM_CAMS):
            src = SRC_ROOT / src_idx / "images" / f"000000_{c}.png"
            if not src.exists():
                print(f"  ! missing ref: {src}")
                continue
            copy_first_frame(src, scene_out / "refs" / f"cam{c}.jpg")

        # Five frames per trajectory.
        for traj in TRAJS:
            clip = find_clip(s_tag, traj)
            if clip is None:
                print(f"  ! no clip for {s_tag}/{traj}")
                continue
            extract_percent_frames(clip, scene_out / traj, PERCENTS)

        # The merged 0.01-sub-sampled background + frame-0 actor PLY is
        # produced by merge_pc_frame0.py — run it after this script.

        print(f"== wrote {scene_dir}")


if __name__ == "__main__":
    main()
