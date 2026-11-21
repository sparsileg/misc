#!/usr/bin/env python3
"""See the Riemann Hypothesis: the zeros, the waves they make, and the primes.

Three tabs:

1. Zeros on the line: Hardy's Z(t), which is zeta along the critical line
   turned into a real number, and the zeros it crosses through, drawn in the
   critical strip.
2. Waves build the primes: Riemann's smooth estimate plus one wave per zero.
   Add zeros and the curve snaps onto the exact prime staircase.
3. Size of the error: how far the smooth estimate li(N) drifts from the true
   prime count, against the bound that holds if the hypothesis is true.

Hover over any plot to read off values.

Usage: riemann-gui.py
Uses only the Python standard library; the mathematics is in zetamath.py.
"""

import bisect
import math
import tkinter as tk
from tkinter import ttk

import zetamath as zm

T_MAX = 300.0               # zeros are found up to this height
SIEVE_MAX = 10_000_000      # tab 3 counts primes up to here
WAVE_SAMPLES = 1000         # points across the x range in tab 2
PLAY_MS = 70                # animation step when playing tab 2

C = {
    "bg": "#f4f5f7",
    "panel": "#ffffff",
    "grid": "#e4e7eb",
    "axis": "#9aa1ad",
    "text": "#1f2430",
    "muted": "#5f6775",
    "blue": "#2563eb",
    "orange": "#e8590c",
    "purple": "#7c3aed",
    "grey": "#8a919c",
    "zero": "#dc2626",
    "strip": "#e8eefc",
    "hover": "#1f2430",
}
FONT = ("DejaVu Sans", 10)
SMALL = ("DejaVu Sans", 9)
TITLE = ("DejaVu Sans", 11, "bold")


def fmt_num(v: float) -> str:
    a = abs(v)
    if a >= 1e5:
        return f"{v:,.0f}"
    if a >= 100:
        return f"{v:.1f}"
    if a >= 1:
        return f"{v:.3f}"
    return f"{v:.4f}"


def fmt_tick(v: float, log: bool) -> str:
    if log:
        e = round(math.log10(v))
        return f"10{str(e).translate(str.maketrans('0123456789-', '⁰¹²³⁴⁵⁶⁷⁸⁹⁻'))}"
    if abs(v) >= 10000:
        return f"{v:,.0f}"
    return f"{v:g}"


def nice_ticks(lo: float, hi: float, target: int = 6) -> list[float]:
    span = hi - lo
    if span <= 0:
        return [lo]
    raw = span / target
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    first = math.ceil(lo / step) * step
    ticks, v = [], first
    while v <= hi + step * 1e-9:
        ticks.append(round(v, 12))
        v += step
    return ticks


class Plot(tk.Canvas):
    """A small line-plot widget with axes, legend and a hover readout.

    Series are dicts: name, xs, ys, color, and optionally width, dash,
    kind ("line", "step" or "dots") and readout (False to leave out of hover).
    """

    PAD_L, PAD_R, PAD_T, PAD_B = 64, 16, 30, 40

    def __init__(self, master, title="", xlabel="", ylabel="",
                 xlog=False, ylog=False, height=300, legend=True):
        super().__init__(master, bg=C["panel"], highlightthickness=0, height=height)
        self.title, self.xlabel, self.ylabel = title, xlabel, ylabel
        self.xlog, self.ylog, self.legend = xlog, ylog, legend
        self.series: list[dict] = []
        self.view = (0.0, 1.0, 0.0, 1.0)
        self.message = ""
        self.hover_x = None
        self.bind("<Configure>", lambda e: self.redraw())
        self.bind("<Motion>", self._on_motion)
        self.bind("<Leave>", self._on_leave)

    # coordinate transforms
    def _fx(self, x):
        return math.log10(x) if self.xlog else x

    def _fy(self, y):
        return math.log10(y) if self.ylog else y

    def _box(self):
        w, h = self.winfo_width(), self.winfo_height()
        return self.PAD_L, self.PAD_T, w - self.PAD_R, h - self.PAD_B

    def to_px(self, x, y):
        x0, x1, y0, y1 = self.view
        l, t, r, b = self._box()
        fx0, fx1, fy0, fy1 = self._fx(x0), self._fx(x1), self._fy(y0), self._fy(y1)
        px = l + (self._fx(x) - fx0) / (fx1 - fx0) * (r - l)
        py = b - (self._fy(y) - fy0) / (fy1 - fy0) * (b - t)
        return px, py

    def from_px(self, px):
        x0, x1 = self.view[:2]
        l, _, r, _ = self._box()
        f = self._fx(x0) + (px - l) / (r - l) * (self._fx(x1) - self._fx(x0))
        return 10 ** f if self.xlog else f

    def set_data(self, series, view, message=""):
        self.series, self.view, self.message = series, view, message
        self.redraw()

    def redraw(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        if w < 50 or h < 50:
            return
        l, t, r, b = self._box()
        x0, x1, y0, y1 = self.view
        self.create_text(l, 14, text=self.title, anchor="w", font=TITLE, fill=C["text"])
        # grid and ticks
        for xv in self._ticks(x0, x1, self.xlog):
            px, _ = self.to_px(xv, y0 if not self.ylog else y0)
            self.create_line(px, t, px, b, fill=C["grid"])
            self.create_text(px, b + 4, text=fmt_tick(xv, self.xlog), anchor="n",
                             font=SMALL, fill=C["muted"])
        for yv in self._ticks(y0, y1, self.ylog):
            _, py = self.to_px(x0, yv)
            self.create_line(l, py, r, py, fill=C["grid"])
            self.create_text(l - 6, py, text=fmt_tick(yv, self.ylog), anchor="e",
                             font=SMALL, fill=C["muted"])
        if not self.ylog and y0 < 0 < y1:
            _, py = self.to_px(x0, 0)
            self.create_line(l, py, r, py, fill=C["axis"])
        self.create_rectangle(l, t, r, b, outline=C["axis"])
        self.create_text((l + r) / 2, h - 6, text=self.xlabel, anchor="s",
                         font=SMALL, fill=C["muted"])
        self.create_text(12, (t + b) / 2, text=self.ylabel, angle=90, font=SMALL,
                         fill=C["muted"])
        for s in self.series:
            self._draw_series(s)
        if self.legend:
            self._draw_legend()
        if self.message:
            self.create_text((l + r) / 2, (t + b) / 2, text=self.message, font=FONT,
                             fill=C["muted"])
        self._draw_hover()

    def _ticks(self, lo, hi, log):
        if log:
            return [10.0 ** e for e in range(math.ceil(math.log10(lo) - 1e-9),
                                              math.floor(math.log10(hi) + 1e-9) + 1)]
        return nice_ticks(lo, hi)

    def _clip_y(self, py):
        _, t, _, b = self._box()
        return min(b + 2, max(t - 2, py))

    def _visible_points(self, s):
        """Pixel points for the part of the series inside the x range."""
        x0, x1 = self.view[:2]
        xs, ys = s["xs"], s["ys"]
        i = max(0, bisect.bisect_left(xs, x0) - 1)
        j = min(len(xs), bisect.bisect_right(xs, x1) + 1)
        pts = []
        for x, y in zip(xs[i:j], ys[i:j]):
            if (self.xlog and x <= 0) or (self.ylog and y <= 0):
                continue
            px, py = self.to_px(x, y)
            pts.append((px, self._clip_y(py)))
        return pts

    def _draw_series(self, s):
        color, width, dash = s["color"], s.get("width", 2), s.get("dash")
        kind = s.get("kind", "line")
        pts = self._visible_points(s)
        if not pts:
            return
        l, _, r, _ = self._box()
        if kind == "dots":
            for px, py in pts:
                if l <= px <= r:
                    self.create_oval(px - 3.5, py - 3.5, px + 3.5, py + 3.5,
                                     fill=color, outline="")
            return
        if kind == "step":
            stepped = []
            for k, (px, py) in enumerate(pts):
                if k:
                    stepped.append((px, stepped[-1][1]))
                stepped.append((px, py))
            stepped.append((r, stepped[-1][1]))
            pts = stepped
        pts = [(min(r, max(l, px)), py) for px, py in pts]
        if len(pts) < 2:
            return
        flat = [c for p in pts for c in p]
        self.create_line(*flat, fill=color, width=width, dash=dash)

    def _draw_legend(self):
        _, t, r, _ = self._box()
        x = r - 8
        for s in reversed(self.series):
            if not s.get("name") or s.get("legend") is False:
                continue
            tid = self.create_text(x, 14, text=s["name"], anchor="e", font=SMALL,
                                   fill=C["text"])
            bx = self.bbox(tid)[0]
            self.create_line(bx - 22, 14, bx - 4, 14, fill=s["color"],
                             width=s.get("width", 2), dash=s.get("dash"))
            x = bx - 34

    def _on_motion(self, e):
        l, t, r, b = self._box()
        self.hover_x = self.from_px(e.x) if l <= e.x <= r and t <= e.y <= b else None
        self.redraw()

    def _on_leave(self, e):
        self.hover_x = None
        self.redraw()

    def _value_at(self, s, x):
        xs = s["xs"]
        if not xs or x < xs[0]:
            return None
        if s.get("kind") == "step":
            return s["ys"][bisect.bisect_right(xs, x) - 1]
        i = bisect.bisect_left(xs, x)
        if i >= len(xs):
            return None
        if i > 0 and x - xs[i - 1] < xs[i] - x:
            i -= 1
        return s["ys"][i]

    def _draw_hover(self):
        if self.hover_x is None or not self.series:
            return
        l, t, r, b = self._box()
        x = self.hover_x
        px, _ = self.to_px(x, self.view[2])
        self.create_line(px, t, px, b, fill=C["axis"], dash=(2, 3))
        lines = [f"{self.xlabel.split(',')[0]} = {fmt_num(x)}"]
        for s in self.series:
            if s.get("readout") is False or not s.get("name"):
                continue
            v = self._value_at(s, x)
            if v is not None:
                lines.append(f"{s['name']}: {fmt_num(v)}")
        text = "\n".join(lines)
        anchor = "nw" if px < (l + r) / 2 else "ne"
        tx = px + 8 if anchor == "nw" else px - 8
        tid = self.create_text(tx, t + 8, text=text, anchor=anchor, font=SMALL,
                               fill="white")
        x0, y0, x1, y1 = self.bbox(tid)
        bg = self.create_rectangle(x0 - 5, y0 - 4, x1 + 5, y1 + 4, fill=C["hover"],
                                   outline="")
        self.tag_lower(bg, tid)


class StripView(tk.Canvas):
    """The critical strip 0 < Re(s) < 1, with the zeros found so far."""

    def __init__(self, master):
        super().__init__(master, bg=C["panel"], highlightthickness=0, width=190)
        self.zeros: list[float] = []
        self.tmax = 50.0
        self.bind("<Configure>", lambda e: self.redraw())

    def set_data(self, zeros, tmax):
        self.zeros, self.tmax = zeros, tmax
        self.redraw()

    def redraw(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        if h < 80:
            return
        top, bot = 34, h - 40
        left, right = 30, w - 12
        re_lo, re_hi = -0.5, 1.5

        def px(re):
            return left + (re - re_lo) / (re_hi - re_lo) * (right - left)

        def py(im):
            return bot - im / self.tmax * (bot - top)

        self.create_text(8, 14, text="Where the zeros are", anchor="w", font=TITLE,
                         fill=C["text"])
        self.create_rectangle(px(0), top, px(1), bot, fill=C["strip"], outline="")
        for re in (0, 1):
            self.create_line(px(re), top, px(re), bot, fill=C["axis"])
        self.create_line(px(0.5), top, px(0.5), bot, fill=C["zero"], dash=(4, 3))
        self.create_line(left, bot, right, bot, fill=C["axis"])
        for re in (0, 0.5, 1):
            self.create_text(px(re), bot + 4, text=f"{re:g}", anchor="n", font=SMALL,
                             fill=C["muted"])
        self.create_text((left + right) / 2, h - 6, text="real part of s", anchor="s",
                         font=SMALL, fill=C["muted"])
        for tv in nice_ticks(0, self.tmax, 5):
            self.create_text(left - 4, py(tv), text=f"{tv:g}", anchor="e", font=SMALL,
                             fill=C["muted"])
        r = 3 if len([z for z in self.zeros if z <= self.tmax]) < 60 else 2
        for g in self.zeros:
            if g > self.tmax:
                break
            y = py(g)
            self.create_oval(px(0.5) - r, y - r, px(0.5) + r, y + r, fill=C["zero"],
                             outline="")


class ZerosTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        top = ttk.Frame(self)
        top.pack(fill="x")
        ttk.Label(top, text="Show heights t up to").pack(side="left")
        self.tmax = tk.DoubleVar(value=60)
        ttk.Scale(top, from_=20, to=T_MAX, variable=self.tmax, length=300,
                  command=lambda v: self.update_view()).pack(side="left", padx=8)
        self.info = ttk.Label(top, text="")
        self.info.pack(side="left", padx=8)

        body = ttk.Frame(self)
        body.pack(fill="both", expand=True, pady=(8, 0))
        self.strip = StripView(body)
        self.strip.pack(side="left", fill="y")
        self.plot = Plot(body, title="ζ along the critical line, s = ½ + it",
                         xlabel="t, the height up the line", ylabel="value")
        self.plot.pack(side="left", fill="both", expand=True, padx=(8, 0))
        ttk.Label(self, wraplength=1000, justify="left", font=FONT, text=(
            "Orange is the size |ζ(½ + it)|: it dips to zero again and again. "
            "Blue is Hardy's Z(t), ζ(½ + it) rotated so that it is a real number; "
            "it has the same size, so it hides under orange when positive, and it "
            "changes sign at every dip. Each crossing is a zero of ζ (red dots). On the left, "
            "the same zeros sit in the critical strip: every one found lies on the "
            "line Re(s) = ½, as the Riemann Hypothesis says.")).pack(fill="x", pady=(8, 0))

        self.ts = [i * 0.04 for i in range(int(T_MAX / 0.04) + 1)]
        self.zs = [zm.hardy_z(t) for t in self.ts]
        self.abs_zs = [abs(z) for z in self.zs]

    def update_view(self):
        tmax = self.tmax.get()
        zeros = self.app.zeros
        shown = [g for g in zeros if g <= tmax]
        j = bisect.bisect_right(self.ts, tmax)
        peak = max(self.abs_zs[:j]) * 1.08
        series = [
            {"name": "Z(t)", "xs": self.ts, "ys": self.zs, "color": C["blue"],
             "width": 1.5},
            {"name": "|ζ(½ + it)|", "xs": self.ts, "ys": self.abs_zs,
             "color": C["orange"]},
            {"name": "zeros", "xs": shown, "ys": [0.0] * len(shown), "color": C["zero"],
             "kind": "dots", "readout": False},
        ]
        self.plot.set_data(series, (0, tmax, -peak, peak))
        self.strip.set_data(zeros, tmax)
        self.info.config(text=f"{len(shown)} zeros up to t = {tmax:.0f}, "
                              "all with real part ½")


class WavesTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        self.cache: dict[int, tuple] = {}    # X -> (xs, smooth, cumulative, waves)
        self.pending = None
        self.playing = None

        top = ttk.Frame(self)
        top.pack(fill="x")
        ttk.Label(top, text="Count primes up to").pack(side="left")
        self.xmax = tk.StringVar(value="100")
        box = ttk.Combobox(top, textvariable=self.xmax, values=("30", "100", "200", "500"),
                           width=5, state="readonly")
        box.pack(side="left", padx=(6, 18))
        box.bind("<<ComboboxSelected>>", lambda e: self.load())
        ttk.Label(top, text="Zeros used").pack(side="left")
        self.k = tk.IntVar(value=0)
        self.scale = ttk.Scale(top, from_=0, to=len(app.zeros), length=320,
                               command=self._on_scale)
        self.scale.pack(side="left", padx=8)
        self.k_label = ttk.Label(top, text="0", width=5)
        self.k_label.pack(side="left")
        self.play_btn = ttk.Button(top, text="Play", command=self.toggle_play)
        self.play_btn.pack(side="left", padx=8)

        self.plot = Plot(self, title="Prime count rebuilt from the zeros",
                         xlabel="x", ylabel="number of primes ≤ x", height=360)
        self.plot.pack(fill="both", expand=True, pady=(8, 0))
        self.wave_plot = Plot(self, title="", xlabel="x", ylabel="wave", height=170)
        self.wave_plot.pack(fill="x", pady=(6, 0))
        ttk.Label(self, wraplength=1000, justify="left", font=FONT, text=(
            "Grey is the true prime count π(x). Orange is Riemann's smooth estimate "
            "R(x). Each pair of zeros ½ ± iγ adds one wave (bottom: the latest one), "
            "and blue is the smooth estimate plus all waves so far. Slide or press "
            "Play: with more zeros, blue locks onto the staircase, with a jump at "
            "every prime.")).pack(fill="x", pady=(8, 0))

    def _on_scale(self, v):
        k = round(float(v))
        if k != self.k.get():
            self.k.set(k)
            self.update_view()

    def toggle_play(self):
        if self.playing:
            self.after_cancel(self.playing)
            self.playing = None
            self.play_btn.config(text="Play")
            return
        if self.k.get() >= len(self.app.zeros):
            self.k.set(0)
        self.play_btn.config(text="Pause")
        self._play_step()

    def _play_step(self):
        k = self.k.get() + 1
        if k > len(self.app.zeros):
            self.playing = None
            self.play_btn.config(text="Play")
            return
        self.k.set(k)
        self.scale.set(k)
        self.update_view()
        self.playing = self.after(PLAY_MS if k > 10 else 400, self._play_step)

    def load(self):
        X = int(self.xmax.get())
        if X in self.cache:
            self.update_view()
            return
        if self.pending:
            self.after_cancel(self.pending)
        xs = [2 + (X - 2) * i / (WAVE_SAMPLES - 1) for i in range(WAVE_SAMPLES)]
        smooth = [zm.smooth_part(x) for x in xs]
        state = {"X": X, "xs": xs, "smooth": smooth, "waves": [], "cum": [smooth]}
        self.plot.set_data([], (2, X, 0, 1), "Adding up the waves…")
        self._compute(state)

    def _compute(self, state):
        zeros = self.app.zeros
        n = len(state["waves"])
        if n < len(zeros):
            g = zeros[n]
            wave = [zm.zero_wave(x, g) for x in state["xs"]]
            state["waves"].append(wave)
            state["cum"].append([a + b for a, b in zip(state["cum"][-1], wave)])
            if n % 10 == 0:
                self.plot.set_data([], (2, state["X"], 0, 1),
                                   f"Adding up the waves… {n}/{len(zeros)} zeros")
            self.pending = self.after(1, self._compute, state)
            return
        self.pending = None
        self.cache[state["X"]] = (state["xs"], state["smooth"], state["cum"],
                                  state["waves"])
        if int(self.xmax.get()) == state["X"]:
            self.update_view()

    def update_view(self):
        X = int(self.xmax.get())
        k = self.k.get()
        self.k_label.config(text=str(k))
        if X not in self.cache:
            if not self.pending:
                self.load()
            return
        xs, smooth, cum, waves = self.cache[X]
        primes = [p for p in range(2, X + 1) if self.app.small_flags[p]]
        count = list(range(1, len(primes) + 1))
        top = len(primes) * 1.15 + 1
        series = [
            {"name": "π(x), true count", "xs": [2.0] + [float(p) for p in primes],
             "ys": [0.0] + count, "color": C["grey"], "kind": "step", "width": 3},
            {"name": "R(x), smooth", "xs": xs, "ys": smooth, "color": C["orange"],
             "dash": (5, 3), "width": 1.5},
            {"name": f"R(x) + {k} wave{'s' if k != 1 else ''}", "xs": xs, "ys": cum[k],
             "color": C["blue"]},
        ]
        self.plot.set_data(series, (2, X, -0.5, top))
        if k:
            g = self.app.zeros[k - 1]
            w = waves[k - 1]
            amp = max(max(abs(v) for v in w) * 1.15, 0.05)
            self.wave_plot.title = f"Wave from zero #{k}:  ½ + {g:.4f}i"
            self.wave_plot.set_data([{"name": "wave", "xs": xs, "ys": w,
                                      "color": C["purple"], "width": 1.5}],
                                    (2, X, -amp, amp))
        else:
            self.wave_plot.title = "No waves yet: move the slider or press Play"
            self.wave_plot.set_data([], (2, X, -1, 1))


class ErrorTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        self.loaded = False
        self.plot = Plot(self, title="How far the smooth estimates miss the true count",
                         xlabel="N, on a log scale", ylabel="size of the miss (log scale)",
                         xlog=True, ylog=True, height=440)
        self.plot.pack(fill="both", expand=True)
        ttk.Label(self, wraplength=1000, justify="left", font=FONT, text=(
            "Grey: the miss of the rough estimate N / ln N, which grows almost as fast "
            "as N itself. Blue: the miss of li(N), the estimate the zeros correct. "
            "Orange: √N · ln N / (8π), Schoenfeld's bound, which holds for every "
            "N ≥ 2657 exactly when the Riemann Hypothesis is true. On log scales both "
            "blue and orange climb with slope about ½: the error grows like √N (times a "
            "logarithm), far slower than N."
        )).pack(fill="x", pady=(8, 0))

    def load(self):
        if self.loaded:
            return
        self.loaded = True
        self.plot.set_data([], (100, SIEVE_MAX, 1, 1e6),
                           f"Counting the primes up to {SIEVE_MAX:,}…")
        self.after(50, self._compute)

    def _compute(self):
        flags = zm.prime_sieve(SIEVE_MAX)
        points = 400
        ns = sorted({round(10 ** (2 + 5 * i / (points - 1))) for i in range(points)})
        counts, running, prev = [], 0, 0
        for n in ns:
            running += flags.count(1, prev, n + 1)
            prev = n + 1
            counts.append(running)
        li_err = [zm.li(n) - c for n, c in zip(ns, counts)]
        rough_err = [c - n / math.log(n) for n, c in zip(ns, counts)]
        nsf = [float(n) for n in ns]
        bxs = [x for x in nsf if x >= 2657]      # where Schoenfeld's bound applies
        bound = [math.sqrt(x) * math.log(x) / (8 * math.pi) for x in bxs]
        series = [
            {"name": "π(N) − N/ln N", "xs": nsf, "ys": rough_err, "color": C["grey"]},
            {"name": "li(N) − π(N)", "xs": nsf, "ys": li_err, "color": C["blue"]},
            {"name": "RH bound √N·ln N/(8π)", "xs": bxs, "ys": bound,
             "color": C["orange"], "dash": (5, 3)},
        ]
        self.plot.set_data(series, (100, SIEVE_MAX, 1, 1e6))


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("The Riemann Hypothesis")
        self.configure(bg=C["bg"])
        self.geometry("1100x760")
        self.minsize(820, 600)
        style = ttk.Style(self)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(".", background=C["bg"], foreground=C["text"], font=FONT)
        style.configure("TNotebook.Tab", padding=(14, 6))

        self.zeros = zm.find_zeros(T_MAX)
        self.small_flags = zm.prime_sieve(1000)

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=10, pady=10)
        self.zeros_tab = ZerosTab(nb, self)
        self.waves_tab = WavesTab(nb, self)
        self.error_tab = ErrorTab(nb, self)
        nb.add(self.zeros_tab, text="1  Zeros on the line")
        nb.add(self.waves_tab, text="2  Waves build the primes")
        nb.add(self.error_tab, text="3  Size of the error")
        nb.bind("<<NotebookTabChanged>>", lambda e: self._on_tab(nb))
        self.zeros_tab.update_view()
        self.bind("<Escape>", lambda e: self.destroy())

    def _on_tab(self, nb):
        tab = nb.nametowidget(nb.select())
        if tab is self.waves_tab:
            self.waves_tab.update_view()
        elif tab is self.error_tab:
            self.error_tab.load()


if __name__ == "__main__":
    App().mainloop()
