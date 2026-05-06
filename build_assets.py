#!/usr/bin/env python3
"""Assemble the website's `assets/` tree from the upstream output dirs.

The site itself is fully static — once `assets/` is in place, opening
`index.html` is enough.  This script only matters if you want to rebuild
the asset tree from raw model outputs (e.g. on a different machine).

Source layout expected (override with --paper-ready / --novelview-run /
--selected-videos, or set env vars STREETNVS_PAPER_READY etc.):

  <paper-ready>/
    addref_bettercam_0.1/<ours-subdir>/waymo_*_{cond,gt,generated}.mp4
    addref_bettercam_0.001|0.01|0.1|1/<ours-subdir>/...
    streetcrafter_0.1/waymo_*_generated.mp4
    streetcrafter_star_0.1/<sc-star-subdir>/waymo_*_generated.mp4
    eval_freevs|eval_gen3c|eval_vace/waymo_*_generated.mp4

  <novelview-run>/sample_*_s{N}_c{traj}_{cond,generated}.mp4

  <selected-videos>/
    qual_eval/scene{NNN}_cam{C}/{01_input_lidar,02_gt,03_freevs,...}.mp4
    qual_ablation/scene{NNN}_cam{C}/{01_gt,02_ours_no_lidar,...}.mp4
    qual_multi_sparsity/scene{NNN}_cam{C}/{lidar,ours,sc_star}/{ratio}.mp4

Output paths are all relative to this script's directory.
By default uses os.symlink for speed; pass --mode copy to dereference.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
from pathlib import Path

ROOT   = Path(__file__).resolve().parent
ASSETS = ROOT / "website" / "assets"

OURS_SUBDIR = "GeoI2VLoRA_waymo_multi_vace_UCPE_addref_frameidv3_stronglora_vacedepth_encodevacemask_bettercam"
SC_STAR_SUB = "GeoI2VLoRA_waymo_multi_vace_UCPE_noref_frameidv3_stronglora_encodevacemask_novacemask_bettercam"

NOVEL_SCENES   = ["s10", "s3", "s11", "s2", "s5", "s15"]
TRAJS          = ["barron", "elevate", "lane_shift", "rotate"]
ABLATION_SCENES = [
    # (sample_id, scene_dir, note) — display order matches this list
    ("waymo_000002_s0_c2",   "scene000_cam2", "anchor"),
    ("waymo_000849_s169_c4", "scene169_cam4", ""),
    ("waymo_000362_s72_c2",  "scene072_cam2", ""),
]
SPARSITY_SCENES = [
    # (scene_dir, sample_id) — ordered as the website should display them.
    ("scene187_cam2", "waymo_000937_s187_c2"),
    ("scene030_cam3", "waymo_000153_s30_c3"),
    ("scene162_cam0", "waymo_000810_s162_c0"),
    ("scene121_cam0", "waymo_000605_s121_c0"),
]
SPARSITY_RATIOS = ["0.001", "0.01", "0.1", "1"]
PAPER_BASELINES = ["scene075_cam2", "scene076_cam3"]   # at ratio 0.01
NEW_BASELINES   = [
    # (sample_id, scene_dir, ratio)
    ("waymo_000453_s90_c3",  "scene090_cam3", "0.01"),
    ("waymo_000630_s126_c0", "scene126_cam0", "0.1"),
    ("waymo_000645_s129_c0", "scene129_cam0", "0.1"),
]


def install(src: Path, dst: Path, mode: str) -> None:
    if not src.exists():
        print(f"  MISSING: {src}")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.is_symlink() or dst.exists():
        dst.unlink()
    if mode == "copy":
        shutil.copy2(src, dst)
    else:
        dst.symlink_to(src)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--paper-ready",
                    default=os.environ.get("STREETNVS_PAPER_READY"),
                    help="Path to paper_ready/ output root.")
    ap.add_argument("--novelview-run",
                    default=os.environ.get("STREETNVS_NOVELVIEW_RUN"),
                    help="Path to outputs_novelview/<RUN>/ for novel-view samples.")
    ap.add_argument("--selected-videos",
                    default=os.environ.get("STREETNVS_SELECTED_VIDEOS"),
                    help="Path to selected_videos/ produced by paper-figure scripts.")
    ap.add_argument("--mode", choices=["symlink", "copy"], default="symlink",
                    help="Symlink (default, fast) or copy (portable).")
    args = ap.parse_args()

    missing = [k for k in ("paper_ready", "novelview_run", "selected_videos")
               if not getattr(args, k)]
    if missing:
        ap.error(f"missing source path(s): {missing}. Pass --{missing[0].replace('_', '-')} "
                 f"or set STREETNVS_{missing[0].upper()}.")

    PAPER  = Path(args.paper_ready).resolve()
    NV_RUN = Path(args.novelview_run).resolve()
    SEL    = Path(args.selected_videos).resolve()
    MODE   = args.mode

    # ---- §1 novel view --------------------------------------------------
    print("== novel_view ==")
    for scene in NOVEL_SCENES:
        sid_n   = int(scene[1:])
        out_dir = ASSETS / "novel_view" / f"scene{sid_n:03d}"
        for traj in TRAJS:
            match = sorted(NV_RUN.glob(f"sample_*_{scene}_c{traj}_generated.mp4"))
            if not match:
                print(f"  no sample for {scene}/{traj}")
                continue
            gen  = match[0]
            cond = gen.with_name(gen.name.replace("_generated.mp4", "_cond.mp4"))
            install(gen,  out_dir / traj / "gen.mp4",  MODE)
            install(cond, out_dir / traj / "cond.mp4", MODE)
        # Per-scene 'input' clip — encoded once from the source streetcrafter
        # frames (camera 0, frames 0–80). Skip if already on disk.
        input_mp4 = out_dir / "input.mp4"
        if not input_mp4.exists():
            print(f"  ! {scene}/input.mp4 missing — encode with the helper "
                  f"described in the file header.")

    # ---- §2 baselines ---------------------------------------------------
    print("== baselines ==")
    paper_pick_map = {
        "01_input_lidar.mp4":         "lidar.mp4",
        "02_gt.mp4":                  "gt.mp4",
        "03_freevs.mp4":              "freevs.mp4",
        "04_gen3c.mp4":               "gen3c.mp4",
        "05_vace.mp4":                "vace.mp4",
        "06_streetcrafter.mp4":       "sc.mp4",
        "07_streetcrafter_star.mp4":  "sc_star.mp4",
        "08_ours.mp4":                "ours.mp4",
    }
    for scene_dir in PAPER_BASELINES:
        src = SEL / "qual_eval" / scene_dir
        dst = ASSETS / "baselines" / scene_dir
        for k, v in paper_pick_map.items():
            install(src / k, dst / v, MODE)

    # Per-ratio source-dir resolvers (StreetCrafter at 0.01 is a flat dir;
    # StreetCrafter* at 0.01 lives in *_0.01_temp without an inner subdir).
    def ours_dir(r):    return PAPER / f"addref_bettercam_{r}" / OURS_SUBDIR
    def sc_dir(r):      return PAPER / f"streetcrafter_{r}"
    def sc_star_dir(r): return (PAPER / "streetcrafter_star_0.01_temp"
                                if r == "0.01"
                                else PAPER / f"streetcrafter_star_{r}" / SC_STAR_SUB)

    for sample_id, scene_dir, ratio in NEW_BASELINES:
        dst = ASSETS / "baselines" / scene_dir
        od  = ours_dir(ratio)
        install(od / f"{sample_id}_gt.mp4",        dst / "gt.mp4",    MODE)
        install(od / f"{sample_id}_cond.mp4",      dst / "lidar.mp4", MODE)
        install(od / f"{sample_id}_generated.mp4", dst / "ours.mp4",  MODE)
        install(PAPER / "eval_freevs" / f"{sample_id}_generated.mp4",
                dst / "freevs.mp4", MODE)
        install(PAPER / "eval_gen3c"  / f"{sample_id}_generated.mp4",
                dst / "gen3c.mp4",  MODE)
        install(PAPER / "eval_vace"   / f"{sample_id}_generated.mp4",
                dst / "vace.mp4",   MODE)
        install(sc_dir(ratio)      / f"{sample_id}_generated.mp4",
                dst / "sc.mp4",     MODE)
        install(sc_star_dir(ratio) / f"{sample_id}_generated.mp4",
                dst / "sc_star.mp4", MODE)

    # ---- §4 ablation ----------------------------------------------------
    # Source every ablation variant directly from paper_ready (so new scenes
    # don't have to be pre-staged into selected_videos).
    print("== ablation ==")
    full_dir     = PAPER / "addref_bettercam_0.01" / OURS_SUBDIR
    no_lidar_dir = (PAPER / "addref_novace_0.01"
                          / "GeoI2VLoRA_waymo_multi_vace_UCPE_addref_novace_frameidv3_stronglora_bettercam")
    no_cam_dir   = (PAPER / "noref_vaceonly_0.01"
                          / "GeoI2VLoRA_waymo_multi_vace_NoCam_noref_vaceonly_frameidv3_stronglora_vacedepth_encodevacemask")
    no_ref_dir   = (PAPER / "noref_bettercam_0.01"
                          / "GeoI2VLoRA_waymo_multi_vace_UCPE_noref_frameidv3_stronglora_vacedepth_encodevacemask_bettercam")
    for sample_id, scene_dir, _ in ABLATION_SCENES:
        dst = ASSETS / "ablation" / scene_dir
        install(full_dir     / f"{sample_id}_gt.mp4",        dst / "gt.mp4",       MODE)
        install(full_dir     / f"{sample_id}_cond.mp4",      dst / "lidar.mp4",    MODE)
        install(full_dir     / f"{sample_id}_generated.mp4", dst / "full.mp4",     MODE)
        install(no_lidar_dir / f"{sample_id}_generated.mp4", dst / "no_lidar.mp4", MODE)
        install(no_cam_dir   / f"{sample_id}_generated.mp4", dst / "no_cam.mp4",   MODE)
        install(no_ref_dir   / f"{sample_id}_generated.mp4", dst / "no_ref.mp4",   MODE)

    # ---- §4 sparsity ----------------------------------------------------
    # Source everything from paper_ready directly so new scenes don't need to
    # be pre-staged into selected_videos/qual_multi_sparsity.
    print("== sparsity ==")
    OURS_RATIO_DIRS = {
        r: PAPER / f"addref_bettercam_{r}" / OURS_SUBDIR for r in SPARSITY_RATIOS
    }
    SC_STAR_RATIO_DIRS = {
        "0.001": PAPER / "streetcrafter_star_0.001" / SC_STAR_SUB,
        "0.01":  PAPER / "streetcrafter_star_0.01_temp",          # no inner subdir
        "0.1":   PAPER / "streetcrafter_star_0.1"   / SC_STAR_SUB,
        "1":     PAPER / "streetcrafter_star_1"     / SC_STAR_SUB,
    }
    for scene_dir, sample_id in SPARSITY_SCENES:
        dst = ASSETS / "sparsity" / scene_dir
        # GT is identical across ratios; pull it from any one (use 0.1).
        install(OURS_RATIO_DIRS["0.1"] / f"{sample_id}_gt.mp4",
                dst / "gt.mp4", MODE)
        for ratio in SPARSITY_RATIOS:
            ours_dir = OURS_RATIO_DIRS[ratio]
            scs_dir  = SC_STAR_RATIO_DIRS[ratio]
            install(ours_dir / f"{sample_id}_cond.mp4",
                    dst / "lidar"  / f"{ratio}.mp4", MODE)
            install(ours_dir / f"{sample_id}_generated.mp4",
                    dst / "ours"   / f"{ratio}.mp4", MODE)
            install(scs_dir  / f"{sample_id}_generated.mp4",
                    dst / "sc_star"/ f"{ratio}.mp4", MODE)

    print("done")


if __name__ == "__main__":
    main()
