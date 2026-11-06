(() => {
  const VERSION = 3;
  if (window.__asciiVisionLoaded === VERSION) return; // guard against double injection
  window.__asciiVisionLoaded = VERSION;

  const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const DEFAULTS = { enabled: false, mode: "green", detail: 240 };
  const COLORS = { green: "#00ff41", amber: "#ffb000", white: "#e8e8e8", color: "#e8e8e8" };
  const MIN_SIZE = 20;      // smallest image (px) that gets converted
  const CELL_PX = 3.6;      // target character width in CSS px (smaller = more detail)
  const MONO = '"Courier New", Consolas, Menlo, monospace';
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "TITLE", "BR", "CANVAS"]);
  const BG_PROPS = ["background-image", "background-size", "background-repeat", "background-position"];

  // NOTE: backgrounds are NOT forced on every element (that made transparent
  // overlay layers opaque and covered videos). Only elements that really have an
  // opaque background get the "av-bgc" class from the scanner below.
  const CSS = `
html.av-on, html.av-on body { background: #000 !important; }
html.av-on .av-bgc { background-color: #000 !important; }
html.av-on .av-bgn { background-image: none !important; }
html.av-on *:not(.av-ascii) {
  color: var(--av-fg) !important;
  border-color: var(--av-fg) !important;
  text-shadow: 0 0 5px var(--av-fg) !important;
  caret-color: var(--av-fg) !important;
}
html.av-on *:not(.av-ascii):not([class*="icon" i]):not([class*="material" i]) {
  font-family: ui-monospace, Menlo, Consolas, "Courier New", monospace !important;
}
html.av-on a, html.av-on a * { text-decoration: underline !important; }
html.av-on svg { filter: brightness(0) invert(1) drop-shadow(0 0 2px var(--av-fg)) !important; }
html.av-on img { filter: grayscale(1) contrast(1.3) !important; }
html.av-on .av-hidden { opacity: 0 !important; }
html.av-on::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px);
}`;

  let settings = { ...DEFAULTS };
  let active = false;
  let items = new Map(); // element -> state
  let seen = new WeakSet();
  let stack = [];
  let pumping = false;
  let io = null, mo = null, styleEl = null;
  let rafId = 0, timerId = 0, lastFrame = 0;
  const bgCache = new Map();

  /* ---------- helpers ---------- */

  function makeScratch() {
    const c = document.createElement("canvas");
    return { c, x: c.getContext("2d", { willReadFrequently: true }) };
  }

  function dims(w, h, kind) {
    let cap = settings.detail;
    if (kind === "video" && settings.mode === "color") cap = Math.min(cap, 170);
    const cols = Math.max(12, Math.min(cap, Math.floor(w / CELL_PX)));
    const cellW = w / cols;
    const rows = Math.max(1, Math.round(h / (cellW * 2)));
    return { cols, rows };
  }

  function isOpaque(bc) {
    if (!bc || bc === "transparent") return false;
    const m = bc.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(/[ ,\/]+/).filter(Boolean);
    const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
    return a > 0.5;
  }

  // Auto-contrast: find the 2nd..98th brightness percentile so dark and washed-out
  // pictures still use the whole character ramp (this is what adds detail).
  function computeRange(pix, n) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      hist[(pix[j] * 77 + pix[j + 1] * 150 + pix[j + 2] * 29) >> 8]++;
    }
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.98) { hi = v; break; } }
    if (hi - lo < 24) {
      const mid = (hi + lo) / 2;
      lo = Math.max(0, mid - 12);
      hi = Math.min(255, mid + 12);
    }
    return [lo, hi];
  }

  // Draw the source into a tiny canvas (cols x rows) and return its pixels,
  // or null if the browser blocks reading them.
  function sample(src, cols, rows, scratch, fit, w, h) {
    const s = scratch || makeScratch();
    if (s.c.width !== cols) s.c.width = cols;
    if (s.c.height !== rows) s.c.height = rows;
    const nw = src.naturalWidth || src.videoWidth || src.width;
    const nh = src.naturalHeight || src.videoHeight || src.height;
    try {
      s.x.fillStyle = "#000";
      s.x.fillRect(0, 0, cols, rows);
      if (nw && nh && (fit === "cover" || fit === "contain")) {
        const srcAR = nw / nh, elAR = w / h;
        if (fit === "cover") {
          let sw, sh, sx, sy;
          if (srcAR > elAR) { sh = nh; sw = nh * elAR; sx = (nw - sw) / 2; sy = 0; }
          else { sw = nw; sh = nw / elAR; sx = 0; sy = (nh - sh) / 2; }
          s.x.drawImage(src, sx, sy, sw, sh, 0, 0, cols, rows);
        } else {
          let dw, dh, dx, dy;
          if (srcAR > elAR) { dw = cols; dh = rows * (elAR / srcAR); dx = 0; dy = (rows - dh) / 2; }
          else { dh = rows; dw = cols * (srcAR / elAR); dy = 0; dx = (cols - dw) / 2; }
          s.x.drawImage(src, 0, 0, nw, nh, dx, dy, dw, dh);
        }
      } else {
        s.x.drawImage(src, 0, 0, cols, rows);
      }
      return s.x.getImageData(0, 0, cols, rows).data;
    } catch (e) {
      return null;
    }
  }

  function fetchViaBackground(url) {
    if (!/^https?:/.test(url)) return Promise.resolve(null);
    if (bgCache.has(url)) return bgCache.get(url);
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "fetch-image", url }, (res) => {
          if (chrome.runtime.lastError || !res || !res.ok) return resolve(null);
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = `data:${res.mime};base64,${res.b64}`;
        });
      } catch (e) {
        resolve(null);
      }
    });
    if (bgCache.size > 80) bgCache.delete(bgCache.keys().next().value);
    bgCache.set(url, p);
    return p;
  }

  function loadAny(url) {
    if (/^https?:/.test(url)) return fetchViaBackground(url);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /* ---------- ASCII drawing ---------- */

  function draw(c, pix, cols, rows, w, h, dpr, range) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const rowH = H / rows, cellW = W / cols;
    ctx.font = `${rowH}px ${MONO}`;
    ctx.textBaseline = "top";
    const charW = ctx.measureText("M").width || rowH * 0.6;
    const sx = cellW / charW;
    const n = RAMP.length;
    const lo = range[0], span = Math.max(1, range[1] - range[0]);
    const colorMode = settings.mode === "color";

    ctx.save();
    ctx.scale(sx, 1);
    if (!colorMode) ctx.fillStyle = COLORS[settings.mode] || COLORS.green;
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = pix[i], g = pix[i + 1], b = pix[i + 2];
        const L = (r * 77 + g * 150 + b * 29) >> 8;
        let t = (L - lo) / span;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = Math.pow(t, 0.9);
        const idx = (t * (n - 1)) | 0;
        if (colorMode) {
          if (idx > 0) {
            const k = Math.max(0.7, Math.min(3, (t + 0.2) / (L / 255 + 0.08)));
            ctx.fillStyle = `rgb(${Math.min(255, (r * k) | 0)},${Math.min(255, (g * k) | 0)},${Math.min(255, (b * k) | 0)})`;
            ctx.fillText(RAMP[idx], x * charW, y * rowH);
          }
        } else {
          line += RAMP[idx];
        }
      }
      if (!colorMode) ctx.fillText(line, 0, y * rowH);
    }
    ctx.restore();
  }

  function ensureCanvas(st) {
    if (st.canvas && st.canvas.isConnected) return st.canvas;
    const cs = getComputedStyle(st.el);
    const c = document.createElement("canvas");
    c.className = "av-ascii";
    c.style.cssText = "position:absolute;pointer-events:none;background:#000;overflow:hidden;";
    c.style.zIndex = cs.zIndex;
    c.style.borderRadius = cs.borderRadius;
    st.el.after(c);
    st.canvas = c;
    st.key = "";
    return c;
  }

  function removeCanvas(st) {
    if (st.canvas) st.canvas.remove();
    st.canvas = null;
    st.el.classList.remove("av-hidden");
  }

  function releaseItem(st) {
    if (st.kind === "bg") {
      if (st.orig) {
        for (const [p, v, pri] of st.orig) {
          if (v) st.el.style.setProperty(p, v, pri);
          else st.el.style.removeProperty(p);
        }
      }
    } else {
      removeCanvas(st);
    }
  }

  // Keep the ASCII canvas exactly on top of the original element.
  function place(st) {
    const el = st.el, c = st.canvas;
    if (!c) return;
    if (!el.offsetParent) { c.style.display = "none"; return; }
    c.style.display = "";
    const l = el.offsetLeft, t = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
    const key = l + "," + t + "," + w + "," + h;
    if (st.key === key) return;
    st.key = key;
    c.style.left = l + "px";
    c.style.top = t + "px";
    c.style.width = w + "px";
    c.style.height = h + "px";
  }

  /* ---------- images (<img>) ---------- */

  async function renderImage(st) {
    const el = st.el;
    if (st.busy || st.failed || !active) return;
    if (!(el.complete && el.naturalWidth)) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < MIN_SIZE || h < MIN_SIZE || !el.offsetParent) return;
    st.busy = true;
    try {
      const { cols, rows } = dims(w, h, "img");
      const fit = getComputedStyle(el).objectFit;
      let pix = sample(el, cols, rows, null, fit, w, h);
      if (!pix) {
        const alt = await fetchViaBackground(el.currentSrc || el.src);
        if (alt) pix = sample(alt, cols, rows, null, fit, w, h);
      }
      if (!pix || !active) { if (!pix) st.failed = true; return; }
      const c = ensureCanvas(st);
      place(st);
      draw(c, pix, cols, rows, w, h, Math.min(2, window.devicePixelRatio || 1), computeRange(pix, cols * rows));
      el.classList.add("av-hidden");
      st.rendered = true;
    } finally {
      st.busy = false;
    }
  }

  /* ---------- CSS background images ---------- */

  async function renderBg(st) {
    const el = st.el;
    if (st.busy || st.failed || !active) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < MIN_SIZE || h < MIN_SIZE) return;
    st.busy = true;
    try {
      const img = await loadAny(st.url);
      if (!img) { st.failed = true; return; }
      const { cols, rows } = dims(w, h, "img");
      const pix = sample(img, cols, rows, null, st.fit, w, h);
      if (!pix) { st.failed = true; return; }
      const c = document.createElement("canvas");
      draw(c, pix, cols, rows, w, h, Math.min(2, window.devicePixelRatio || 1), computeRange(pix, cols * rows));
      if (!active) return;
      if (!st.orig) {
        st.orig = BG_PROPS.map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      }
      el.style.setProperty("background-image", `url(${c.toDataURL("image/png")})`, "important");
      el.style.setProperty("background-size", "100% 100%", "important");
      el.style.setProperty("background-repeat", "no-repeat", "important");
      el.style.setProperty("background-position", "center", "important");
      st.rendered = true;
    } finally {
      st.busy = false;
    }
  }

  function renderItem(st) {
    if (st.kind === "img") renderImage(st);
    else if (st.kind === "bg") renderBg(st);
  }

  /* ---------- videos ---------- */

  function renderVideo(st) {
    const el = st.el;
    const now = performance.now();
    if (st.failed || el.readyState < 2 || !el.offsetParent) return;
    if (st.pauseUntil && now < st.pauseUntil) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < MIN_SIZE * 2 || h < MIN_SIZE * 2) return;
    const t = el.currentTime;
    const vkey = w + "x" + h + "|" + settings.detail + "|" + settings.mode;
    if (el.paused && st.lastTime === t && st.vkey === vkey && st.canvas) return;

    const { cols, rows } = dims(w, h, "video");
    if (!st.scratch) st.scratch = makeScratch();
    if (st.vkey !== vkey || !st.fit) st.fit = getComputedStyle(el).objectFit;
    const pix = sample(el, cols, rows, st.scratch, st.fit, w, h);
    if (!pix) { st.failed = true; removeCanvas(st); return; }

    const rng = computeRange(pix, cols * rows);
    st.range = st.range ? [st.range[0] * 0.8 + rng[0] * 0.2, st.range[1] * 0.8 + rng[1] * 0.2] : rng;

    // Safety net: if the video keeps coming back pure black, show the original instead.
    st.dark = rng[1] <= 12 ? (st.dark || 0) + 1 : 0;
    if (st.dark > 60 && !el.paused) {
      st.dark = 0;
      st.pauseUntil = now + 3000;
      removeCanvas(st);
      return;
    }

    const c = ensureCanvas(st);
    place(st);
    draw(c, pix, cols, rows, w, h, 1, st.range);
    el.classList.add("av-hidden");
    st.lastTime = t;
    st.vkey = vkey;
  }

  function loop(t) {
    rafId = requestAnimationFrame(loop);
    if (t - lastFrame < 66) return; // ~15 fps
    lastFrame = t;
    for (const st of items.values()) {
      if (st.kind === "video" && st.visible) {
        try { renderVideo(st); } catch (e) { st.failed = true; removeCanvas(st); }
      }
    }
  }

  /* ---------- scanning the page ---------- */

  function track(el) {
    if (items.has(el)) return;
    const st = {
      el, kind: el.tagName === "VIDEO" ? "video" : "img",
      canvas: null, visible: false, rendered: false, failed: false, busy: false
    };
    items.set(el, st);
    if (st.kind === "img") {
      el.addEventListener("load", () => {
        st.rendered = false;
        st.failed = false;
        if (st.visible) renderImage(st);
      });
    }
    io.observe(el);
  }

  function trackBg(el, url, bs) {
    if (items.has(el)) return;
    const st = {
      el, kind: "bg", url,
      fit: bs === "cover" ? "cover" : bs === "contain" ? "contain" : "fill",
      visible: false, rendered: false, failed: false, busy: false
    };
    items.set(el, st);
    io.observe(el);
  }

  function enqueue(node) {
    if (!active || !node || node.nodeType !== 1) return;
    stack.push(node);
    if (!pumping) { pumping = true; setTimeout(runSlice, 0); }
  }

  // Walks the page in small time slices so it never freezes the tab.
  // Reads all styles first, then writes classes (avoids layout thrashing).
  function runSlice() {
    if (!active) { stack = []; pumping = false; return; }
    const t0 = performance.now();
    const reads = [];
    const media = [];
    while (stack.length && performance.now() - t0 < 10) {
      const el = stack.pop();
      if (!el.isConnected || seen.has(el)) continue;
      seen.add(el);
      if (el instanceof SVGElement) continue;
      if (SKIP.has(el.tagName) || el.classList.contains("av-ascii")) continue;
      for (const ch of el.children) stack.push(ch);
      if (el.tagName === "IMG" || el.tagName === "VIDEO") { media.push(el); continue; }
      const cs = getComputedStyle(el);
      reads.push([el, cs.backgroundColor, cs.backgroundImage, cs.backgroundSize]);
    }
    for (const [el, bc, bi, bs] of reads) {
      if (isOpaque(bc)) el.classList.add("av-bgc");
      if (bi && bi !== "none") {
        if (bi.includes("gradient")) {
          el.classList.add("av-bgn");
        } else {
          const m = /url\((['"]?)(.*?)\1\)/.exec(bi);
          if (m && (bs === "cover" || bs === "contain" || bs === "100% 100%")) trackBg(el, m[2], bs);
        }
      }
    }
    for (const el of media) track(el);
    if (stack.length) setTimeout(runSlice, 16);
    else pumping = false;
  }

  function onIntersect(entries) {
    for (const e of entries) {
      const st = items.get(e.target);
      if (!st) continue;
      st.visible = e.isIntersecting;
      if (st.visible && st.kind !== "video" && !st.rendered) renderItem(st);
    }
  }

  // Runs a few times a second: re-aligns canvases and cleans up removed elements.
  function tick() {
    for (const [el, st] of items) {
      if (!el.isConnected) {
        if (st.canvas) st.canvas.remove();
        if (io) io.unobserve(el);
        items.delete(el);
        continue;
      }
      if (st.canvas && st.visible && st.kind === "img") place(st);
    }
  }

  function refreshAll() {
    for (const st of items.values()) {
      st.rendered = false;
      st.lastTime = -1;
      st.vkey = "";
      if (st.kind !== "video" && st.visible) renderItem(st);
    }
  }

  /* ---------- on / off ---------- */

  function setMode() {
    document.documentElement.style.setProperty("--av-fg", COLORS[settings.mode] || COLORS.green);
  }

  function enable() {
    if (active) return;
    active = true;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "av-style";
      styleEl.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    setMode();
    document.documentElement.classList.add("av-on");
    io = new IntersectionObserver(onIntersect, { rootMargin: "300px" });
    mo = new MutationObserver((recs) => {
      for (const r of recs) for (const n of r.addedNodes) enqueue(n);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    enqueue(document.body || document.documentElement);
    rafId = requestAnimationFrame(loop);
    timerId = setInterval(tick, 300);
  }

  function disable() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    clearInterval(timerId);
    if (mo) mo.disconnect();
    if (io) io.disconnect();
    for (const st of items.values()) releaseItem(st);
    items = new Map();
    seen = new WeakSet();
    stack = [];
    document.querySelectorAll(".av-bgc, .av-bgn, .av-hidden").forEach((e) => {
      e.classList.remove("av-bgc", "av-bgn", "av-hidden");
    });
    document.querySelectorAll("canvas.av-ascii").forEach((c) => c.remove());
    document.documentElement.classList.remove("av-on");
    document.documentElement.style.removeProperty("--av-fg");
    if (styleEl) { styleEl.remove(); styleEl = null; }
  }

  chrome.storage.onChanged.addListener((changes) => {
    for (const k in changes) settings[k] = changes[k].newValue;
    if ("enabled" in changes) {
      settings.enabled ? enable() : disable();
    } else if (active) {
      setMode();
      refreshAll();
    }
  });

  // Shortcut: Alt+Shift+A toggles on/off
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyA") {
      chrome.storage.sync.set({ enabled: !settings.enabled });
    }
  });

  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    if (settings.enabled) enable();
  });
})();
