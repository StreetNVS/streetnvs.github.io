/* ===================================================================
 * StreetNVS — paper-companion site
 *
 * Builds four sections at runtime from a small data manifest, then wires
 * up the swipe (RGB ↔ LiDAR) reveal and the sparsity demo controls.
 * =================================================================== */

const NOVEL_SCENES = [
  { id: "scene010", label: "Scene 010", note: "paper anchor (s10)" },
  { id: "scene011", label: "Scene 011", note: "s11" },
  { id: "scene002", label: "Scene 002", note: "s2" },
  { id: "scene005", label: "Scene 005", note: "s5" },
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
  { id: "scene075_cam2", label: "Scene 075 · cam 2", note: "paper anchor"     },
  { id: "scene076_cam3", label: "Scene 076 · cam 3", note: "paper anchor"     },
  { id: "scene090_cam3", label: "Scene 090 · cam 3", note: "extrapolation"    },
  { id: "scene129_cam0", label: "Scene 129 · cam 0", note: "extrapolation"    },
  { id: "scene126_cam0", label: "Scene 126 · cam 0", note: "extrapolation"    },
];

/* ---- §4 ablation ---- */
const ABLATION_SCENES = [
  { id: "scene072_cam2", label: "Scene 072 · cam 2", note: "+4.16 PSNR vs. mean of variants" },
  { id: "scene000_cam2", label: "Scene 000 · cam 2", note: "paper anchor" },
  { id: "scene169_cam4", label: "Scene 169 · cam 4", note: "paper anchor" },
];

/* ---- sparsity (cam-0 trio first, then two side-camera cases) ---- */
const SPARSITY_SCENES = [
  { id: "scene162_cam0", label: "Scene 162 · cam 0" },
  { id: "scene121_cam0", label: "Scene 121 · cam 0" },
  { id: "scene137_cam0", label: "Scene 137 · cam 0" },
  { id: "scene187_cam2", label: "Scene 187 · cam 2" },
  { id: "scene030_cam3", label: "Scene 030 · cam 3" },
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

  return { card, top: vTop, bottom: vBottom };
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
  const grid      = document.getElementById("novel-grid");
  const sceneBtns = document.getElementById("novel-scene-buttons");
  const noteEl    = document.getElementById("novel-note");

  let curScene = NOVEL_SCENES[0];

  // Build the four trajectory cards once and remember each pair of videos so
  // we can swap their srcs in place when the user picks a different scene.
  const cards = NOVEL_TRAJ_ORDER.map((traj) => {
    const dir = `assets/novel_view/${curScene.id}/${traj.key}`;
    const c = makeSwipeCard({
      topSrc:    `${dir}/gen.mp4`,
      bottomSrc: `${dir}/cond.mp4`,
      label:     traj.label,
    });
    grid.appendChild(c.card);
    return { traj, top: c.top, bottom: c.bottom };
  });

  // Scene change always resets to t=0; pause state is preserved by swapAndSeek.
  function applyState() {
    for (const { traj, top, bottom } of cards) {
      const dir = `assets/novel_view/${curScene.id}/${traj.key}`;
      swapAndSeek(top,    `${dir}/gen.mp4`,  0);
      swapAndSeek(bottom, `${dir}/cond.mp4`, 0);
    }
    noteEl.textContent = `${curScene.label} — ${curScene.note}`;
  }

  for (const [i, scene] of NOVEL_SCENES.entries()) {
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

  noteEl.textContent = `${curScene.label} — ${curScene.note}`;
}

/* =================================================================== */
/* Shared video helpers (used by §2, §3, §4)                           */
/* =================================================================== */

// Section pause-state: read from the section-head toggle (not the per-block
// pills, which share the .section-toggle class for styling).
function sectionPaused(sectionEl) {
  if (!sectionEl) return false;
  const btn = sectionEl.querySelector(".section-head > .section-toggle:not(.block-toggle)");
  return btn?.dataset.state === "paused";
}

function seekTo(v, t) {
  const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : null;
  v.currentTime = dur ? Math.min(t, Math.max(dur - 0.05, 0)) : t;
}

// Lazily attach a canvas overlay to the video's parent .video-card. When src
// is about to change, paint the current frame onto the canvas and show it —
// once the new video's first frame is decoded ('loadeddata'), hide the
// overlay. This masks the brief black flash that browsers render between
// src swap and first-frame.
function _ensureOverlay(v) {
  const parent = v.parentElement;
  if (!parent) return null;
  let canvas = parent.querySelector(":scope > canvas.swap-overlay");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "swap-overlay";
    parent.appendChild(canvas);
  }
  return canvas;
}

function _showLastFrame(v) {
  if (!v.videoWidth || !v.videoHeight) return;
  const canvas = _ensureOverlay(v);
  if (!canvas) return;
  canvas.width  = v.videoWidth;
  canvas.height = v.videoHeight;
  try { canvas.getContext("2d").drawImage(v, 0, 0); }
  catch (e) { return; }                // tainted-canvas / not-ready guard
  canvas.style.display = "block";
}

function _hideOverlay(v) {
  const canvas = v.parentElement?.querySelector(":scope > canvas.swap-overlay");
  if (canvas) canvas.style.display = "none";
}

// Swap a video's src, restore play-time, honor the section pause state,
// and overlay the previous frame so the black flash is hidden.
//
// Sets v.dataset.swapping while the swap is in flight; the per-section
// master-clock listeners skip their work whenever the master has that tag,
// so followers are not yanked to currentTime=0 while the new src loads.
function swapAndSeek(v, newSrc, t) {
  if (v.getAttribute("src") === newSrc) return;
  const sectionEl = v.closest("section");
  v.dataset.swapping = "1";
  _showLastFrame(v);
  v.addEventListener("loadedmetadata", () => {
    seekTo(v, t);
    delete v.dataset.swapping;
    if (sectionPaused(sectionEl)) v.pause();
    else v.play().catch(() => {});
  }, { once: true });
  v.addEventListener("loadeddata", () => _hideOverlay(v), { once: true });
  setTimeout(() => {
    _hideOverlay(v);
    delete v.dataset.swapping;          // clear even if loadedmetadata never fires
  }, 1500);
  v.src = newSrc;
}

/* =================================================================== */
/* §2 — baselines                                                      */
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

  // Master-clock pattern: vOurs leads, the rest follow.
  const FOLLOWERS = [vGT, vLid, vBase];
  const SYNC_TOL  = 0.15;

  // resetTime=true when the scene changes, so all four panels restart from 0;
  // false when only the baseline method changes, so we keep the timeline.
  function applyState({ resetTime = false } = {}) {
    const dir = `assets/baselines/${curScene.id}`;
    const t = resetTime ? 0 : (isFinite(vOurs.currentTime) ? vOurs.currentTime : 0);
    swapAndSeek(vGT,   `${dir}/gt.mp4`,    t);
    swapAndSeek(vLid,  `${dir}/lidar.mp4`, t);
    swapAndSeek(vBase, `${dir}/${curMethod}.mp4`, t);
    swapAndSeek(vOurs, `${dir}/ours.mp4`,  t);
    lblBase.textContent = BASELINE_METHODS.find((m) => m.key === curMethod).label;
    noteEl.textContent = `${curScene.label} — ${curScene.note}`;
  }

  vOurs.addEventListener("timeupdate", () => {
    if (vOurs.dataset.swapping) return;          // master mid-swap — don't drag followers to 0
    const t = vOurs.currentTime;
    if (!isFinite(t)) return;
    for (const v of FOLLOWERS) {
      if (v.dataset.swapping) continue;
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
      applyState({ resetTime: true });
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
      applyState();              // method swap keeps the timeline
    });
    methodBtns.appendChild(b);
  }

  applyState();
}

/* =================================================================== */
/* §3 — ablation                                                       */
/* =================================================================== */
function buildAblation() {
  const sceneBtns = document.getElementById("ablation-scene-buttons");
  const noteEl    = document.getElementById("ablation-note");

  const vLid   = document.getElementById("abl-lidar");
  const vGT    = document.getElementById("abl-gt");
  const vFull  = document.getElementById("abl-full");
  const vNoLid = document.getElementById("abl-no-lidar");
  const vNoCam = document.getElementById("abl-no-cam");
  const vNoRef = document.getElementById("abl-no-ref");

  let curScene = ABLATION_SCENES[0];

  // vFull is the master clock; everyone else follows.
  const FOLLOWERS = [vLid, vGT, vNoLid, vNoCam, vNoRef];
  const SYNC_TOL  = 0.15;

  // §4 only has a scene selector → every applyState resets to t=0.
  function applyState() {
    const dir = `assets/ablation/${curScene.id}`;
    swapAndSeek(vLid,   `${dir}/lidar.mp4`,    0);
    swapAndSeek(vGT,    `${dir}/gt.mp4`,       0);
    swapAndSeek(vFull,  `${dir}/full.mp4`,     0);
    swapAndSeek(vNoLid, `${dir}/no_lidar.mp4`, 0);
    swapAndSeek(vNoCam, `${dir}/no_cam.mp4`,   0);
    swapAndSeek(vNoRef, `${dir}/no_ref.mp4`,   0);
    noteEl.textContent = `${curScene.label} — ${curScene.note}`;
  }

  vFull.addEventListener("timeupdate", () => {
    if (vFull.dataset.swapping) return;
    const t = vFull.currentTime;
    if (!isFinite(t)) return;
    for (const v of FOLLOWERS) {
      if (v.dataset.swapping) continue;
      if (!isFinite(v.duration) || v.duration <= 0) continue;
      if (Math.abs(v.currentTime - t) > SYNC_TOL) seekTo(v, t);
    }
  });

  for (const [i, scene] of ABLATION_SCENES.entries()) {
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

  applyState();
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

  // resetTime=true on scene change → all four panels restart from 0;
  // false on density-slider change → keep the current timeline.
  function applyState({ resetTime = false } = {}) {
    const dir = `assets/sparsity/${curScene}`;
    const t = resetTime ? 0 : (isFinite(vOurs.currentTime) ? vOurs.currentTime : 0);

    if (vGT.dataset.scene !== curScene) {
      vGT.dataset.scene = curScene;
      swapAndSeek(vGT, `${dir}/gt.mp4`, t);
    }
    swapAndSeek(vLid,  `${dir}/lidar/${curRatio}.mp4`,   t);
    swapAndSeek(vSCS,  `${dir}/sc_star/${curRatio}.mp4`, t);
    swapAndSeek(vOurs, `${dir}/ours/${curRatio}.mp4`,    t);

    valLbl.textContent = curRatio;
    tickEls.forEach((el, i) => el.classList.toggle("active", RATIOS[i] === curRatio));
  }

  // Re-align followers to the master a few times per second. Using timeupdate
  // (fires ~4×/s during playback) handles loop boundaries cleanly: when the
  // master loops to 0, the followers exceed SYNC_TOL and snap back too.
  vOurs.addEventListener("timeupdate", () => {
    if (vOurs.dataset.swapping) return;
    const t = vOurs.currentTime;
    if (!isFinite(t)) return;
    for (const v of FOLLOWERS) {
      if (v.dataset.swapping) continue;
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
      applyState({ resetTime: true });        // scene change → restart from 0
    });
    buttons.appendChild(b);
  }

  // ratio slider — keeps the current timeline
  slider.addEventListener("input", () => {
    curRatio = RATIOS[+slider.value];
    applyState();
  });
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
  // Only the section-head pills — exclude the per-block buttons that share
  // the .section-toggle class for styling.
  document.querySelectorAll(".section-toggle:not(.block-toggle)").forEach((btn) => {
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
