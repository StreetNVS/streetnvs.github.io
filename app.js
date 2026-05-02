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
  { key: "barron",     label: "Barron"     },
  { key: "elevate",    label: "Elevate"    },
  { key: "lane_shift", label: "Lane Shift" },
  { key: "rotate",     label: "Rotate"     },
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

/* ---- §4 sparsity (sorted: largest avg PSNR gap over StreetCrafter* first) ---- */
const SPARSITY_SCENES = [
  { id: "scene173_cam2", label: "Scene 173 · cam 2" },  // gap_avg 2.74
  { id: "scene156_cam1", label: "Scene 156 · cam 1" },  // gap_avg 2.26
  { id: "scene054_cam2", label: "Scene 054 · cam 2" },  // gap_avg 2.03
  { id: "scene137_cam0", label: "Scene 137 · cam 0" },  // gap_avg 2.03
  { id: "scene107_cam0", label: "Scene 107 · cam 0" },  // gap_avg 1.84
  { id: "scene136_cam1", label: "Scene 136 · cam 1" },  // gap_avg 1.84
  { id: "scene013_cam0", label: "Scene 013 · cam 0" },  // gap_avg 1.46
  { id: "scene105_cam0", label: "Scene 105 · cam 0" },  // gap_avg 1.44
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
function buildBaselines() {
  const root = document.getElementById("baseline-blocks");
  for (const scene of BASELINE_SCENES) {
    const dir = `assets/baselines/${scene.id}`;
    const block = document.createElement("div");
    block.className = "scene-block compare-block";
    block.innerHTML = `
      <div class="scene-block-header">
        <h3>${scene.label}</h3>
        <span class="tag">${scene.note}</span>
      </div>
      <div class="row row-2"></div>
      <div class="row row-3 baselines"></div>
      <div class="row row-3 ours-row"></div>
    `;
    const r1 = block.querySelector(".row-2");
    const r2 = block.querySelector(".baselines");
    const r3 = block.querySelector(".ours-row");

    r1.appendChild(makeStaticCard({ src: `${dir}/gt.mp4`,    label: "Ground Truth" }));
    r1.appendChild(makeStaticCard({ src: `${dir}/lidar.mp4`, label: "LiDAR Input", lidar: true }));

    r2.appendChild(makeStaticCard({ src: `${dir}/freevs.mp4`, label: "FreeVS" }));
    r2.appendChild(makeStaticCard({ src: `${dir}/gen3c.mp4`,  label: "Gen3C"  }));
    r2.appendChild(makeStaticCard({ src: `${dir}/vace.mp4`,   label: "VACE"   }));

    r3.appendChild(makeStaticCard({ src: `${dir}/sc.mp4`,      label: "StreetCrafter"  }));
    r3.appendChild(makeStaticCard({ src: `${dir}/sc_star.mp4`, label: "StreetCrafter*" }));
    r3.appendChild(makeStaticCard({ src: `${dir}/ours.mp4`,    label: "StreetNVS (Ours)", ours: true }));

    root.appendChild(block);
  }
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
  const vOurs   = document.getElementById("spa-ours");

  let curScene = SPARSITY_SCENES[0].id;
  let curRatio = "0.1";   // default — middle of meaningful range
  // align the slider with the default ratio (0.1 is index 2 in RATIOS)
  slider.value = String(RATIOS.indexOf(curRatio));

  // swap a video's source while preserving the current playback time, so the
  // density toggle doesn't visually restart the clip.
  function swapSrcKeepTime(video, newSrc) {
    if (video.getAttribute("src") === newSrc) return;
    const t = isFinite(video.currentTime) ? video.currentTime : 0;
    const wasPaused = video.paused;
    const resume = () => {
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      video.currentTime = dur ? Math.min(t, Math.max(dur - 0.05, 0)) : t;
      if (!wasPaused) video.play().catch(() => {});
    };
    video.addEventListener("loadedmetadata", resume, { once: true });
    video.src = newSrc;
  }

  function applyState() {
    const dir = `assets/sparsity/${curScene}`;
    // GT does not depend on ratio — only swap on scene change.
    if (vGT.dataset.scene !== curScene) {
      vGT.dataset.scene = curScene;
      swapSrcKeepTime(vGT, `${dir}/gt.mp4`);
    }
    // ratio-dependent panels: preserve currentTime across the toggle.
    swapSrcKeepTime(vLid,  `${dir}/lidar/${curRatio}.mp4`);
    swapSrcKeepTime(vOurs, `${dir}/ours/${curRatio}.mp4`);

    valLbl.textContent = curRatio;
    tickEls.forEach((el, i) => el.classList.toggle("active", RATIOS[i] === curRatio));
  }

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
