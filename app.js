/* ===================================================================
 * StreetNVS — paper-companion site
 *
 * Builds four sections at runtime from a small data manifest, then wires
 * up the swipe (RGB ↔ LiDAR) reveal and the sparsity demo controls.
 * =================================================================== */

const NOVEL_SCENES = [
  { id: "scene010", label: "Scene 010", note: "paper anchor (s10)" },
  { id: "scene002", label: "Scene 002", note: "s2" },
  { id: "scene005", label: "Scene 005", note: "s5" },
  { id: "scene011", label: "Scene 011", note: "s11" },
  { id: "scene015", label: "Scene 015", note: "s15" },
];
const NOVEL_TRAJ_ORDER = [
  { key: "elevate",    label: "Elevation"  },
  { key: "lane_shift", label: "Lane Shift" },
  { key: "barron",     label: "Spiral"     },
  { key: "rotate",     label: "Rotation"   },
];

/* ---- §2 baselines ---- */
const BASELINE_SCENES = [
  { id: "scene075_cam2", label: "Scene 075 · cam 2", note: "paper anchor (s75_c2, ratio 0.01)" },
  { id: "scene076_cam3", label: "Scene 076 · cam 3", note: "paper anchor (s76_c3, ratio 0.01)" },
  { id: "scene090_cam3", label: "Scene 090 · cam 3", note: "ratio 0.1 · gain +4.87 PSNR"       },
  { id: "scene085_cam0", label: "Scene 085 · cam 0", note: "ratio 0.1 · gain +3.12 PSNR"       },
  { id: "scene129_cam0", label: "Scene 129 · cam 0", note: "ratio 0.1 · gain +2.70 PSNR"       },
  { id: "scene126_cam0", label: "Scene 126 · cam 0", note: "ratio 0.1 · gain +2.26 PSNR"       },
];

/* ---- §3 ablation ---- */
const ABLATION_SCENES = [
  { id: "scene000_cam2", label: "Scene 000 · cam 2", note: "paper anchor (s0_c2, frame 20)" },
  { id: "scene169_cam4", label: "Scene 169 · cam 4", note: "paper anchor (s169_c4)"         },
];

/* ---- §4 sparsity (user-pinned order; scene 136 cam 0 unavailable, falls back to cam 1) ---- */
const SPARSITY_SCENES = [
  { id: "scene137_cam0", label: "Scene 137 · cam 0" },
  { id: "scene107_cam0", label: "Scene 107 · cam 0" },
  { id: "scene136_cam1", label: "Scene 136 · cam 1" },
  { id: "scene173_cam2", label: "Scene 173 · cam 2" },
  { id: "scene156_cam1", label: "Scene 156 · cam 1" },
  { id: "scene054_cam2", label: "Scene 054 · cam 2" },
  { id: "scene013_cam0", label: "Scene 013 · cam 0" },
  { id: "scene105_cam0", label: "Scene 105 · cam 0" },
  { id: "scene162_cam0", label: "Scene 162 · cam 0" },
  { id: "scene121_cam0", label: "Scene 121 · cam 0" },
  { id: "scene182_cam0", label: "Scene 182 · cam 0" },
  { id: "scene142_cam0", label: "Scene 142 · cam 0" },
];
const RATIOS = ["0.001", "0.01", "0.1", "1"];

/* =================================================================== */
/* Generic swipe video card                                            */
/* =================================================================== */
function makeSwipeCard({ topSrc, bottomSrc, label, ours = false, hint = "drag to reveal LiDAR" }) {
  // top = generated RGB, bottom = LiDAR conditioning.
  // swipe handle controls how much of the top is clipped from the right.
  const card = document.createElement("div");
  card.className = "video-card swipe";
  card.style.setProperty("--swipe-pos", "70%");
  card.style.setProperty("--swipe-right", "30%");

  card.innerHTML = `
    <video class="bottom" src="${bottomSrc}" autoplay loop muted playsinline></video>
    <video class="top"    src="${topSrc}"    autoplay loop muted playsinline></video>
    <span class="label ${ours ? "ours" : ""}">${label}</span>
    <span class="swipe-side left">RGB</span>
    <span class="swipe-side right">LiDAR</span>
    <div class="swipe-handle"></div>
    <div class="swipe-knob">⇆</div>
    <div class="swipe-track" tabindex="0"></div>
  `;

  // sync the two videos so the wipe shows aligned frames
  const [vBottom, vTop] = card.querySelectorAll("video");
  vTop.addEventListener("play", () => { vBottom.currentTime = vTop.currentTime; });
  vTop.addEventListener("seeked", () => { vBottom.currentTime = vTop.currentTime; });
  setInterval(() => {
    if (Math.abs(vTop.currentTime - vBottom.currentTime) > 0.15) {
      vBottom.currentTime = vTop.currentTime;
    }
  }, 1000);

  // drag handler
  const track = card.querySelector(".swipe-track");
  let dragging = false;
  const setPos = (clientX) => {
    const r = card.getBoundingClientRect();
    let x = ((clientX - r.left) / r.width) * 100;
    x = Math.max(0, Math.min(100, x));
    card.style.setProperty("--swipe-pos", `${x}%`);
    card.style.setProperty("--swipe-right", `${100 - x}%`);
  };
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    setPos(e.clientX);
  });
  track.addEventListener("pointermove", (e) => { if (dragging) setPos(e.clientX); });
  track.addEventListener("pointerup",   () => { dragging = false; });
  track.addEventListener("click", (e) => setPos(e.clientX));

  return card;
}

/* a plain (non-swipe) video card */
function makeStaticCard({ src, label, ours = false, lidar = false }) {
  const card = document.createElement("div");
  card.className = "video-card";
  const labelClass = ours ? "ours" : (lidar ? "lidar" : "");
  card.innerHTML = `
    <video src="${src}" autoplay loop muted playsinline></video>
    <span class="label ${labelClass}">${label}</span>
  `;
  return card;
}

/* =================================================================== */
/* §1 — novel view                                                     */
/* =================================================================== */
function buildNovel() {
  const root = document.getElementById("novel-blocks");
  for (const scene of NOVEL_SCENES) {
    const block = document.createElement("div");
    block.className = "scene-block";
    block.innerHTML = `
      <div class="scene-block-header">
        <h3>${scene.label}</h3>
        <span class="tag">${scene.note}</span>
      </div>
      <div class="novel-grid"></div>
    `;
    const grid = block.querySelector(".novel-grid");
    for (const traj of NOVEL_TRAJ_ORDER) {
      const dir = `assets/novel_view/${scene.id}/${traj.key}`;
      grid.appendChild(makeSwipeCard({
        topSrc:    `${dir}/gen.mp4`,
        bottomSrc: `${dir}/cond.mp4`,
        label:     traj.label,
      }));
    }
    root.appendChild(block);
  }
}

/* =================================================================== */
/* §2 — baselines (2-3-3)                                              */
/* =================================================================== */
const BASELINE_METHODS = [
  { key: "freevs",  label: "FreeVS"         },
  { key: "gen3c",   label: "Gen3C"          },
  { key: "vace",    label: "VACE"           },
  { key: "sc",      label: "StreetCrafter"  },
  { key: "sc_star", label: "StreetCrafter*" },
];

function buildBaselines() {
  const sceneBtns  = document.getElementById("baseline-scene-buttons");
  const methodBtns = document.getElementById("baseline-method-buttons");
  const noteEl     = document.getElementById("baseline-note");
  const lblBase    = document.getElementById("bsl-baseline-label");

  const vGT   = document.getElementById("bsl-gt");
  const vLid  = document.getElementById("bsl-lidar");
  const vBase = document.getElementById("bsl-baseline");
  const vOurs = document.getElementById("bsl-ours");

  let curScene  = BASELINE_SCENES[0];
  let curMethod = "sc_star";   // strongest LiDAR-aware baseline by default

  // Re-use the master-clock pattern: vOurs leads, the rest follow.
  const FOLLOWERS = [vGT, vLid, vBase];
  const SYNC_TOL  = 0.15;
  function seekTo(v, t) {
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    v.currentTime = dur ? Math.min(t, Math.max(dur - 0.05, 0)) : t;
  }
  function swapAndSeek(v, newSrc, t) {
    if (v.getAttribute("src") === newSrc) return;
    const wasPaused = v.paused;
    v.addEventListener("loadedmetadata", () => {
      seekTo(v, t);
      if (!wasPaused) v.play().catch(() => {});
    }, { once: true });
    v.src = newSrc;
  }

  function applyState() {
    const dir = `assets/baselines/${curScene.id}`;
    const t = isFinite(vOurs.currentTime) ? vOurs.currentTime : 0;
    swapAndSeek(vGT,   `${dir}/gt.mp4`,    t);
    swapAndSeek(vLid,  `${dir}/lidar.mp4`, t);
    swapAndSeek(vBase, `${dir}/${curMethod}.mp4`, t);
    swapAndSeek(vOurs, `${dir}/ours.mp4`,  t);
    lblBase.textContent = BASELINE_METHODS.find((m) => m.key === curMethod).label;
    noteEl.textContent = `${curScene.label} — ${curScene.note}`;
  }

  vOurs.addEventListener("timeupdate", () => {
    const t = vOurs.currentTime;
    if (!isFinite(t)) return;
    for (const v of FOLLOWERS) {
      if (!isFinite(v.duration) || v.duration <= 0) continue;
      if (Math.abs(v.currentTime - t) > SYNC_TOL) seekTo(v, t);
    }
  });

  // Scene buttons
  for (const [i, scene] of BASELINE_SCENES.entries()) {
    const b = document.createElement("button");
    b.textContent = scene.label;
    if (i === 0) b.classList.add("active");
    b.addEventListener("click", () => {
      [...sceneBtns.children].forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      curScene = scene;
      applyState();
    });
    sceneBtns.appendChild(b);
  }

  // Method buttons
  for (const m of BASELINE_METHODS) {
    const b = document.createElement("button");
    b.textContent = m.label;
    if (m.key === curMethod) b.classList.add("active");
    b.addEventListener("click", () => {
      [...methodBtns.children].forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      curMethod = m.key;
      applyState();
    });
    methodBtns.appendChild(b);
  }

  applyState();
}

/* =================================================================== */
/* §3 — ablation                                                       */
/* =================================================================== */
function buildAblation() {
  const root = document.getElementById("ablation-blocks");
  for (const scene of ABLATION_SCENES) {
    const dir = `assets/ablation/${scene.id}`;
    const block = document.createElement("div");
    block.className = "scene-block ablation-block";
    block.innerHTML = `
      <div class="scene-block-header">
        <h3>${scene.label}</h3>
        <span class="tag">${scene.note}</span>
      </div>
      <div class="grid-2x3"></div>
    `;
    const grid = block.querySelector(".grid-2x3");
    // Top row: inputs + full result. Bottom row: three ablations.
    grid.appendChild(makeStaticCard({ src: `${dir}/lidar.mp4`,    label: "LiDAR Input", lidar: true }));
    grid.appendChild(makeStaticCard({ src: `${dir}/gt.mp4`,       label: "Ground Truth" }));
    grid.appendChild(makeStaticCard({ src: `${dir}/full.mp4`,     label: "StreetNVS Full", ours: true }));
    grid.appendChild(makeStaticCard({ src: `${dir}/no_lidar.mp4`, label: "Ours w/ Camera Only" }));
    grid.appendChild(makeStaticCard({ src: `${dir}/no_cam.mp4`,   label: "Ours w/ Projection Only" }));
    grid.appendChild(makeStaticCard({ src: `${dir}/no_ref.mp4`,   label: "Ours w/o Reference" }));
    root.appendChild(block);
  }
}

/* =================================================================== */
/* §4 — sparsity demo                                                  */
/* =================================================================== */
function buildSparsity() {
  const buttons = document.getElementById("sparsity-scene-buttons");
  const tickEls = [...document.querySelectorAll("#spa-density-ticks span")];
  const slider  = document.getElementById("spa-density");
  const valLbl  = document.getElementById("spa-density-value");
  const vGT     = document.getElementById("spa-gt");
  const vLid    = document.getElementById("spa-lidar");
  const vSCS    = document.getElementById("spa-scstar");
  const vOurs   = document.getElementById("spa-ours");

  let curScene = SPARSITY_SCENES[0].id;
  let curRatio = "0.1";   // default — middle of meaningful range
  // align the slider with the default ratio (0.1 is index 2 in RATIOS)
  slider.value = String(RATIOS.indexOf(curRatio));

  // vOurs is the master clock; the others are kept aligned to it. This avoids
  // drift from independent autoplay and from per-video swap timings.
  const FOLLOWERS = [vGT, vLid, vSCS];
  const SYNC_TOL  = 0.15;   // seconds — drift threshold before we resync

  function seekTo(video, t) {
    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    video.currentTime = dur ? Math.min(t, Math.max(dur - 0.05, 0)) : t;
  }

  // swap a video's source and seek it to `t` once metadata is ready.
  function swapAndSeek(video, newSrc, t) {
    if (video.getAttribute("src") === newSrc) return false;
    const wasPaused = video.paused;
    const onReady = () => {
      seekTo(video, t);
      if (!wasPaused) video.play().catch(() => {});
    };
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.src = newSrc;
    return true;
  }

  function applyState() {
    const dir = `assets/sparsity/${curScene}`;
    // Capture master time *once* and replay every panel from the same offset.
    const t = isFinite(vOurs.currentTime) ? vOurs.currentTime : 0;

    // GT only depends on scene, but if scene changed we still want it on the
    // master clock; if scene didn't change, the timeupdate sync below covers it.
    if (vGT.dataset.scene !== curScene) {
      vGT.dataset.scene = curScene;
      swapAndSeek(vGT, `${dir}/gt.mp4`, t);
    }
    swapAndSeek(vLid,  `${dir}/lidar/${curRatio}.mp4`,    t);
    swapAndSeek(vSCS,  `${dir}/sc_star/${curRatio}.mp4`,  t);
    swapAndSeek(vOurs, `${dir}/ours/${curRatio}.mp4`,     t);

    valLbl.textContent = curRatio;
    tickEls.forEach((el, i) => el.classList.toggle("active", RATIOS[i] === curRatio));
  }

  // Re-align followers to the master a few times per second. Using timeupdate
  // (fires ~4×/s during playback) handles loop boundaries cleanly: when the
  // master loops to 0, the followers exceed SYNC_TOL and snap back too.
  vOurs.addEventListener("timeupdate", () => {
    const t = vOurs.currentTime;
    if (!isFinite(t)) return;
    for (const v of FOLLOWERS) {
      if (!isFinite(v.duration) || v.duration <= 0) continue;
      if (Math.abs(v.currentTime - t) > SYNC_TOL) seekTo(v, t);
    }
  });

  // scene buttons
  for (const [i, scene] of SPARSITY_SCENES.entries()) {
    const b = document.createElement("button");
    b.textContent = scene.label;
    b.dataset.scene = scene.id;
    if (i === 0) b.classList.add("active");
    b.addEventListener("click", () => {
      [...buttons.children].forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      curScene = scene.id;
      applyState();
    });
    buttons.appendChild(b);
  }

  // ratio slider
  slider.addEventListener("input", () => {
    curRatio = RATIOS[+slider.value];
    applyState();
  });
  // tick clicks
  tickEls.forEach((el) => el.addEventListener("click", () => {
    slider.value = el.dataset.i;
    curRatio = RATIOS[+el.dataset.i];
    applyState();
  }));

  applyState();
}

/* =================================================================== */
/* Per-section play/pause toggle                                       */
/* =================================================================== */
function wireSectionToggles() {
  document.querySelectorAll(".section-toggle").forEach((btn) => {
    const section = btn.closest("section");
    const text = btn.querySelector(".text");
    const icon = btn.querySelector(".icon");
    btn.addEventListener("click", () => {
      const playing = btn.dataset.state === "playing";
      const videos = section.querySelectorAll("video");
      if (playing) {
        videos.forEach((v) => v.pause());
        btn.dataset.state = "paused";
        text.textContent = "Play";
        icon.textContent = "▶";
        btn.setAttribute("aria-label", "Resume videos in this section");
      } else {
        videos.forEach((v) => v.play().catch(() => {}));
        btn.dataset.state = "playing";
        text.textContent = "Pause";
        icon.textContent = "❚❚";
        btn.setAttribute("aria-label", "Pause videos in this section");
      }
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  buildNovel();
  buildBaselines();
  buildAblation();
  buildSparsity();
  wireSectionToggles();
});
