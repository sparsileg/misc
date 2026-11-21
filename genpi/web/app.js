// Watch pi approximation algorithms converge: the browser version of genpi-gui.py.

import { ALGORITHMS } from "./pialgos.js";
import { fmtCount, fmtE, fmtF, fmtRate, fmtShort } from "./format.js";
import { HelpPanel } from "./helpview.js";

const BINS = 1000;                    // horizontal resolution of the stored plot history
const WORK_BUDGET = 10;               // milliseconds of computation allowed per frame
const MAX_FRAME_GAP = 0.25;           // seconds; longer gaps (hidden tab) don't pile up work
const RATE_MIN = 1, RATE_MAX = 1_000_000;   // dial range, elements per second
const MARKER_LIMIT = 150;             // draw a dot for each point when there are this few
const PI = Math.PI;
const PI_TEXT = fmtF(PI, 15);

const C = {
  panel: "#ffffff",
  grid: "#e4e7eb",
  axis: "#9aa1ad",
  text: "#1f2430",
  muted: "#5f6775",
  estimate: "#2563eb",
  pi: "#e8590c",
  error: "#7c3aed",
  track: "#dde1e6",
  knob: "#2b303b",
};
const SANS = getComputedStyle(document.documentElement).getPropertyValue("--sans");
const SMALL = `12px ${SANS}`;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- canvases
// Canvases are sized in CSS pixels and drawn at the screen's pixel density.
function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// Text placed like Tk's anchors: "w", "e", "n", "ne", "center".
function text(ctx, x, y, s, anchor, color, font = SMALL) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = anchor.includes("e") ? "right" : anchor.includes("w") ? "left" : "center";
  ctx.textBaseline = anchor.startsWith("n") ? "top" : "middle";
  ctx.fillText(s, x, y);
}

function line(ctx, x1, y1, x2, y2, color, width = 1, dash = []) {
  ctx.beginPath();
  ctx.setLineDash(dash);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function dot(ctx, x, y, r, fill, outline = null, width = 0) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

// -------------------------------------------------------------------- dial
// A rotary knob on a logarithmic scale. Drag it, scroll over it, or focus it
// and use the arrow keys.
class Dial {
  static SWEEP = 270;       // degrees of travel
  static START = 225;       // angle of the minimum position (degrees CCW from 3 o'clock)
  static NOTCHES = 60;      // wheel/arrow steps across the full range

  constructor(canvas, vmin, vmax, value, onChange) {
    this.canvas = canvas;
    this.lo = Math.log10(vmin);
    this.hi = Math.log10(vmax);
    this.onChange = onChange;
    this.frac = (Math.log10(value) - this.lo) / (this.hi - this.lo);

    canvas.addEventListener("pointerdown", (e) => {
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      this.drag(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) this.drag(e);
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.nudge(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (d) {
        e.preventDefault();
        this.nudge(d);
      }
    });
    canvas.addEventListener("focus", () => this.draw());
    canvas.addEventListener("blur", () => this.draw());
    this.draw();
  }

  get value() {
    return 10 ** (this.lo + this.frac * (this.hi - this.lo));
  }

  setFrac(f) {
    f = Math.min(1, Math.max(0, f));
    if (f !== this.frac) {
      this.frac = f;
      this.draw();
      this.onChange(this.value);
    }
  }

  nudge(notches) {
    this.canvas.focus();
    this.setFrac(Math.round(this.frac * Dial.NOTCHES + notches) / Dial.NOTCHES);
  }

  drag(e) {
    const box = this.canvas.getBoundingClientRect();
    const c = box.width / 2;
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const angle = Math.atan2(c - y, x - c) * 180 / Math.PI;
    let f = (((Dial.START - angle) % 360) + 360) % 360 / Dial.SWEEP;
    if (f > 1) f = f < (1 + 360 / Dial.SWEEP) / 2 ? 1 : 0;   // dead zone: snap to nearer end
    this.setFrac(f);
  }

  point(angleDeg, radius, c) {
    const a = angleDeg * Math.PI / 180;
    return [c + radius * Math.cos(a), c - radius * Math.sin(a)];
  }

  draw() {
    const { ctx, w } = prepare(this.canvas);
    const c = w / 2;
    const r = c - 16;
    const rad = (deg) => -deg * Math.PI / 180;          // math angle -> canvas angle
    const focused = document.activeElement === this.canvas;
    const { START, SWEEP } = Dial;

    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(c, c, r, rad(START - SWEEP), rad(START), true);
    ctx.strokeStyle = C.track;
    ctx.stroke();
    if (this.frac > 0) {
      ctx.beginPath();
      ctx.arc(c, c, r, rad(START), rad(START - SWEEP * this.frac), false);
      ctx.strokeStyle = C.estimate;
      ctx.stroke();
    }
    const decades = Math.round(this.hi - this.lo);
    for (let d = 0; d <= decades; d++) {
      const ang = START - SWEEP * d / decades;
      line(ctx, ...this.point(ang, r + 7, c), ...this.point(ang, r + 13, c), C.axis);
    }
    const kr = r - 16;
    dot(ctx, c, c, kr, C.knob, focused ? C.estimate : C.knob, 2);
    const ang = START - SWEEP * this.frac;
    ctx.lineCap = "round";
    line(ctx, ...this.point(ang, kr * 0.25, c), ...this.point(ang, kr - 6, c), "#ffffff", 4);
    ctx.lineCap = "butt";
    text(ctx, ...this.point(START + 22, r - 2, c), "slow", "center", C.muted);
    text(ctx, ...this.point(START - SWEEP - 22, r - 2, c), "fast", "center", C.muted);

    this.canvas.setAttribute("aria-valuenow", Math.round(this.value));
    this.canvas.setAttribute("aria-valuetext", `${fmtRate(this.value)} per second`);
  }
}

// --------------------------------------------------------------------- app
class PiApp {
  constructor() {
    this.algo = ALGORITHMS[0];
    this.rate = 20;
    this.state = "idle";              // idle | running | paused | done
    this.frameId = null;

    this.algoBox = $("algo");
    for (const a of ALGORITHMS) this.algoBox.add(new Option(a.name, a.name));
    this.algoBox.addEventListener("change", () => this.onAlgo());

    this.nEntry = $("n");
    this.nEntry.addEventListener("input", () => {
      const digits = this.nEntry.value.replace(/\D/g, "").slice(0, 10);
      if (digits !== this.nEntry.value) this.nEntry.value = digits;
    });
    this.nEntry.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.start();
    });

    $("start").addEventListener("click", () => this.start());
    $("pause").addEventListener("click", () => this.togglePause());
    $("reset").addEventListener("click", () => this.reset());
    $("learn").addEventListener("click", () => this.openHelp());
    $("zoom").addEventListener("change", () => this.redraw());
    $("pi-ref").textContent = PI_TEXT;

    this.dial = new Dial($("dial"), RATE_MIN, RATE_MAX, this.rate, (r) => {
      this.rate = r;
      this.syncControls();
    });

    const topics = [["Reading the plots", "overview.md"],
                    ...ALGORITHMS.map((a) => [a.name, a.helpFile])];
    this.help = new HelpPanel($("help"), topics, () => $("learn").focus());

    document.addEventListener("keydown", (e) => {
      if (e.key === "F1" || (e.key === "?" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        this.openHelp();
      } else if (e.key === "Escape") {
        this.togglePause();
      }
    });

    this.estCanvas = $("est-plot");
    this.errCanvas = $("err-plot");
    const resized = new ResizeObserver(() => {
      this.redraw();
      this.dial.draw();
    });
    for (const el of [this.estCanvas, this.errCanvas, $("dial")]) resized.observe(el);

    this.clearRun(1000);
    this.syncControls();
    this.redraw();
  }

  // ---------------------------------------------------------------- state
  clearRun(nTotal) {
    this.N = nTotal;
    this.n = 0;
    this.value = null;
    this.gen = null;
    this.carry = 0;
    this.chunk = 1;                   // elements between clock checks (adapts)
    this.estLo = new Float64Array(BINS).fill(NaN);   // per-bin min/max of the estimate
    this.estHi = new Float64Array(BINS).fill(NaN);
    this.errLo = new Float64Array(BINS).fill(NaN);   // per-bin min/max of log10(error)
    this.errHi = new Float64Array(BINS).fill(NaN);
    this.lastEstBin = -1;
    this.lastErrBin = -1;
  }

  syncControls() {
    const active = this.state === "running" || this.state === "paused";
    this.algoBox.disabled = active;
    this.nEntry.disabled = active;
    const start = $("start"), pause = $("pause");
    start.disabled = active;
    start.textContent = this.state === "idle" ? "Start" : "Restart";
    pause.disabled = !active;
    pause.textContent = this.state === "paused" ? "Resume" : "Pause";
    const unit = this.algo.unit;
    $("n-label").textContent = unit[0].toUpperCase() + unit.slice(1) + "s";
    $("formula").textContent = this.algo.formula;
    $("rate").textContent = `${fmtRate(this.rate)} ${unit}s / second`;
  }

  onAlgo() {
    this.algo = ALGORITHMS.find((a) => a.name === this.algoBox.value);
    this.syncControls();
    this.redraw();
    if (this.help.isOpen) this.help.show(this.helpIndex());
  }

  helpIndex() {
    return 1 + ALGORITHMS.indexOf(this.algo);
  }

  openHelp() {
    this.help.open(this.helpIndex());
  }

  start() {
    if (this.state === "running" || this.state === "paused") return;
    const text = this.nEntry.value;
    if (!text || Number(text) < 1) {
      $("status").textContent = "Enter a whole number of at least 1.";
      this.nEntry.focus();
      return;
    }
    $("status").textContent = "";
    this.clearRun(Number(text));
    this.gen = this.algo.estimates();
    this.carry = 1;                   // show the first element right away
    this.state = "running";
    this.lastTime = performance.now();
    this.syncControls();
    this.tick(this.lastTime);
  }

  togglePause() {
    if (this.state === "running") {
      this.state = "paused";
      this.cancelTick();
    } else if (this.state === "paused") {
      this.state = "running";
      this.lastTime = performance.now();
      this.tick(this.lastTime);
    }
    this.syncControls();
  }

  reset() {
    this.cancelTick();
    this.state = "idle";
    $("status").textContent = "";
    this.clearRun(this.N);
    this.syncControls();
    this.redraw();
  }

  cancelTick() {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  // ----------------------------------------------------------- simulation
  tick(now) {
    this.frameId = null;
    if (this.state !== "running") return;
    this.carry += this.rate * Math.min(MAX_FRAME_GAP, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const steps = Math.floor(this.carry);
    if (steps) {
      const done = this.advance(steps);
      // Drop any backlog the CPU could not keep up with, so the speed dial
      // stays responsive instead of "catching up" later.
      this.carry = done < steps ? 0 : this.carry - steps;
    }
    this.redraw();
    if (this.n >= this.N) {
      this.state = "done";
      this.syncControls();
    } else {
      this.frameId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  advance(steps) {
    steps = Math.min(steps, this.N - this.n);
    const deadline = performance.now() + WORK_BUDGET;
    const { gen, N, estLo, estHi, errLo, errHi } = this;
    const lin = N > 1 ? (BINS - 1) / (N - 1) : 0;
    const logk = N > 1 ? (BINS - 1) / Math.log(N) : 0;
    let n = this.n, v = this.value;
    let done = 0;
    // Elements differ hugely in cost (a Leibniz term vs. a whole circle
    // crawl), so the chunk between clock checks adapts to stay on budget.
    let size = this.chunk;
    while (done < steps) {
      const chunk = Math.min(steps - done, size);
      const t0 = performance.now();
      for (let i = 0; i < chunk; i++) {
        v = gen.next().value;
        n += 1;
        if (v !== v) continue;                  // estimate not defined yet (NaN)
        let b = Math.floor((n - 1) * lin);
        let lo = estLo[b];
        if (lo !== lo) estLo[b] = estHi[b] = v;  // empty bin (NaN)
        else if (v < lo) estLo[b] = v;
        else if (v > estHi[b]) estHi[b] = v;
        const err = Math.abs(v - PI);
        const le = err > 0 ? Math.log10(err) : -17;
        b = Math.floor(Math.log(n) * logk);
        lo = errLo[b];
        if (lo !== lo) errLo[b] = errHi[b] = le;
        else if (le < lo) errLo[b] = le;
        else if (le > errHi[b]) errHi[b] = le;
      }
      done += chunk;
      const now = performance.now();
      if (now - t0 < 1) size = Math.min(size * 2, 4096);
      else if (now - t0 > 3) size = Math.max(Math.floor(size / 2), 1);
      if (now > deadline) break;
    }
    this.chunk = size;
    this.n = n;
    this.value = v;
    this.lastEstBin = Math.floor((n - 1) * lin);
    this.lastErrBin = Math.floor(Math.log(n) * logk);
    return done;
  }

  // -------------------------------------------------------------- drawing
  redraw() {
    this.drawReadout();
    this.drawEstimate();
    this.drawError();
  }

  drawReadout() {
    const unit = this.algo.unit + "s";
    $("count").textContent = `${fmtCount(this.n)} of ${fmtCount(this.N)} ${unit}`;
    const v = this.value;
    if (v === null || v !== v) {
      $("est-good").textContent = "";
      $("est-bad").textContent = v === null ? "–" : "not defined yet";
      $("err").textContent = "error   –";
      $("digits").textContent = "correct –";
      return;
    }
    const s = fmtF(v, 15);
    let match = 0;
    while (match < s.length && s[match] === PI_TEXT[match]) match++;
    $("est-good").textContent = s.slice(0, match);
    $("est-bad").textContent = s.slice(match);
    $("err").textContent = `error   ${fmtE(Math.abs(v - PI), 3)}`;
    const decimals = Math.max(0, match - 2);
    $("digits").textContent = `correct ${decimals} decimal place${decimals !== 1 ? "s" : ""}`;
  }

  static frame(w, h) {
    return { L: 78, R: w - 18, T: 30, B: h - 30 };
  }

  // Per-bin min/max values -> a polyline (an envelope where bins hold many points).
  static binsToPoints(lo, hi, last, xmap, ymap) {
    const pts = [];
    let filled = 0;
    for (let b = 0; b <= last; b++) {
      const a = lo[b], z = hi[b];
      if (a !== a) continue;          // empty bin
      filled++;
      const x = xmap(b);
      pts.push([x, ymap(a)]);
      if (z !== a) pts.push([x, ymap(z)]);
    }
    return { pts, filled };
  }

  static drawSeries(ctx, pts, filled, color) {
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const p of pts.slice(1)) ctx.lineTo(...p);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    if (filled <= MARKER_LIMIT) for (const [x, y] of pts) dot(ctx, x, y, 2.5, color);
  }

  plotTitles(ctx, L, R, title) {
    const titleFont = `bold 13px ${SANS}`;
    text(ctx, L, 14, title, "w", C.text, titleFont);
    const titleW = ctx.measureText(title).width;
    const note = `x: ${this.algo.unit}s used`;
    ctx.font = SMALL;
    if (L + titleW + 16 + ctx.measureText(note).width <= R) text(ctx, R, 14, note, "e", C.muted);
  }

  drawEstimate() {
    const { ctx, w, h } = prepare(this.estCanvas);
    const { L, R, T, B } = PiApp.frame(w, h);
    if (R - L < 50 || B - T < 40) return;
    this.plotTitles(ctx, L, R, "Estimate vs. π");

    const last = this.lastEstBin;
    let half = 0;
    let seen = false;
    if (last >= 0) {
      const first = $("zoom").checked ? Math.floor(last / 4) : 0;
      for (let b = first; b <= last; b++) {
        if (this.estLo[b] === this.estLo[b]) {
          seen = true;
          half = Math.max(half, Math.abs(this.estLo[b] - PI), Math.abs(this.estHi[b] - PI));
        }
      }
    }
    // Estimates that equal pi exactly still get the finest scale, not +-1.
    half = seen ? Math.max(half * 1.15, 1e-14) : 1;
    const mid = (T + B) / 2;
    const ymap = (v) => Math.min(B, Math.max(T, mid - (v - PI) / half * (B - T) / 2));

    for (const [frac, label] of [[1, `+ ${fmtE(half, 2)}`], [0.5, null], [0, "π"],
                                 [-0.5, null], [-1, `− ${fmtE(half, 2)}`]]) {
      const y = mid - frac * (B - T) / 2;
      if (frac === 0) {
        line(ctx, L, y, R, y, C.pi, 2, [6, 4]);
        text(ctx, L - 8, y, "π", "e", C.pi, `bold 15px ${SANS}`);
      } else {
        line(ctx, L, y, R, y, C.grid);
        if (label) text(ctx, L - 8, y, label, "e", C.muted);
      }
    }
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(L, T, R - L, B - T);
    const span = R - L;
    const xmap = (b) => L + b / (BINS - 1) * span;

    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const x = L + frac * span;
      const v = 1 + frac * (this.N - 1);         // element 1 is at the left edge
      const n = Math.floor(v + 0.5);
      if (this.N > 20 || Math.abs(v - n) < 1e-9) {   // small N: only ticks that land on an element
        line(ctx, x, B, x, B + 4, C.axis);
        text(ctx, x, B + 6, fmtShort(n), frac === 1 ? "ne" : "n", C.muted);
      }
    }

    if (last < 0) {
      text(ctx, (L + R) / 2, mid - 20, "Press Start", "center", C.muted, `16px ${SANS}`);
      return;
    }
    const { pts, filled } = PiApp.binsToPoints(this.estLo, this.estHi, last, xmap, ymap);
    PiApp.drawSeries(ctx, pts, filled, C.estimate);
    if (this.value !== this.value) return;
    dot(ctx, xmap(last), ymap(this.value), 5, C.panel, C.estimate, 2.5);
  }

  drawError() {
    const { ctx, w, h } = prepare(this.errCanvas);
    const { L, R, T, B } = PiApp.frame(w, h);
    if (R - L < 50 || B - T < 40) return;
    this.plotTitles(ctx, L, R, "Error  |estimate − π|  (log scales)");

    const last = this.lastErrBin;
    let loD = 0, hiD = 1;
    if (last >= 0) {
      let min = Infinity, max = -Infinity;
      for (let b = 0; b <= last; b++) {
        for (const v of [this.errLo[b], this.errHi[b]]) {
          if (v === v) {
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
        }
      }
      if (min <= max) {
        loD = Math.floor(min);
        hiD = Math.ceil(max);
      }
      if (hiD - loD < 2) {
        loD -= 1;
        hiD += 1;
      }
    }
    const ymap = (le) => B - (le - loD) / (hiD - loD) * (B - T);

    const step = Math.max(1, Math.ceil((hiD - loD) / 8));
    for (let d = loD; d <= hiD; d++) {
      const y = ymap(d);
      line(ctx, L, y, R, y, C.grid);
      if ((d - loD) % step === 0) text(ctx, L - 8, y, `1e${d}`, "e", C.muted);
    }
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(L, T, R - L, B - T);
    const span = R - L;
    const N = this.N;
    const logN = N > 1 ? Math.log10(N) : 1;
    const xmap = (b) => L + b / (BINS - 1) * span;

    const decades = N > 1 ? Math.floor(logN) : 0;
    const xstep = Math.max(1, Math.ceil(decades / 10));
    // Labels that would touch the previous one are skipped (narrow screens).
    ctx.font = SMALL;
    let lastRight = -Infinity;
    const label = (x, s, anchor) => {
      const w = ctx.measureText(s).width;
      const left = anchor === "ne" ? x - w : x - w / 2;
      if (left < lastRight + 6) return;
      text(ctx, x, B + 6, s, anchor, C.muted);
      lastRight = left + w;
    };
    for (let d = 0; d <= decades; d += xstep) {
      const x = L + d / logN * span;
      line(ctx, x, B, x, B + 4, C.axis);
      label(x, fmtShort(10 ** d), x > R - 1 ? "ne" : "n");
    }
    if (N > 1 && logN - decades > 0.3) label(R, fmtShort(N), "ne");

    if (last < 0) return;
    const { pts, filled } = PiApp.binsToPoints(this.errLo, this.errHi, last, xmap, ymap);
    PiApp.drawSeries(ctx, pts, filled, C.error);
    if (this.value !== this.value) return;
    const err = Math.abs(this.value - PI);
    dot(ctx, xmap(last), ymap(err > 0 ? Math.log10(err) : -17), 5, C.panel, C.error, 2.5);
  }
}

window.piApp = new PiApp();
