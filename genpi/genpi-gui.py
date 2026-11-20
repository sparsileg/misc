#!/usr/bin/env python3
"""Watch pi approximation algorithms converge.

Pick an algorithm and the number of elements to use, set the speed with the
dial, and press Start. The top plot shows the estimate against pi; the bottom
plot shows the size of the error on log scales.

Usage: genpi-gui.py
Algorithms live in pialgos.py.
"""

import math
import time
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

import helpview
import pialgos

BINS = 1000                 # horizontal resolution of the stored plot history
FRAME_MS = 16               # animation tick (~60 frames per second)
WORK_BUDGET = 0.010         # seconds of computation allowed per tick
RATE_MIN, RATE_MAX = 1, 1_000_000   # dial range, elements per second
MARKER_LIMIT = 150          # draw a dot for each point when there are this few
PI_TEXT = f"{math.pi:.15f}"

C = {
    "bg": "#f4f5f7",
    "panel": "#ffffff",
    "grid": "#e4e7eb",
    "axis": "#9aa1ad",
    "text": "#1f2430",
    "muted": "#5f6775",
    "estimate": "#2563eb",
    "pi": "#e8590c",
    "error": "#7c3aed",
    "good": "#15803d",
    "bad": "#c2410c",
    "track": "#dde1e6",
    "knob": "#2b303b",
}

MONO = ("DejaVu Sans Mono", 13)
MONO_BIG = ("DejaVu Sans Mono", 17, "bold")
SMALL = ("DejaVu Sans", 9)


def fmt_count(n: int) -> str:
    return f"{n:,}"


def fmt_short(n: float) -> str:
    """Compact axis label: 950, 1.2k, 25k, 3.5M, 10B."""
    for size, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if n >= size:
            return f"{n / size:.3g}{suffix}"
    return f"{n:.3g}"


def fmt_rate(r: float) -> str:
    if r < 10:
        return f"{r:.1f}"
    return f"{round(r):,}"


class Dial(tk.Canvas):
    """A rotary knob on a logarithmic scale.

    Drag it, scroll over it, or focus it and use the arrow keys.
    """

    SWEEP = 270.0       # degrees of travel
    START = 225.0       # angle of the minimum position (degrees CCW from 3 o'clock)
    NOTCHES = 60        # wheel/arrow steps across the full range

    def __init__(self, master, vmin, vmax, value, command=None, size=170, bg=C["bg"]):
        super().__init__(master, width=size, height=size, bg=bg,
                         highlightthickness=0, takefocus=1, cursor="hand2")
        self.size = size
        self.lo, self.hi = math.log10(vmin), math.log10(vmax)
        self.command = command
        self.frac = (math.log10(value) - self.lo) / (self.hi - self.lo)
        self.bind("<Button-1>", self._on_drag)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<MouseWheel>", lambda e: self.nudge(1 if e.delta > 0 else -1))
        self.bind("<Button-4>", lambda e: self.nudge(1))
        self.bind("<Button-5>", lambda e: self.nudge(-1))
        for key, d in (("<Right>", 1), ("<Up>", 1), ("<Left>", -1), ("<Down>", -1)):
            self.bind(key, lambda e, d=d: self.nudge(d))
        self.bind("<FocusIn>", lambda e: self._draw())
        self.bind("<FocusOut>", lambda e: self._draw())
        self._draw()

    @property
    def value(self) -> float:
        return 10 ** (self.lo + self.frac * (self.hi - self.lo))

    def set_frac(self, f: float) -> None:
        f = min(1.0, max(0.0, f))
        if f != self.frac:
            self.frac = f
            self._draw()
            if self.command:
                self.command(self.value)

    def nudge(self, notches: int) -> None:
        self.focus_set()
        self.set_frac(round(self.frac * self.NOTCHES + notches) / self.NOTCHES)

    def _on_drag(self, e) -> None:
        self.focus_set()
        c = self.size / 2
        angle = math.degrees(math.atan2(c - e.y, e.x - c))
        f = ((self.START - angle) % 360) / self.SWEEP
        if f > 1:   # in the dead zone at the bottom: snap to the nearer end
            f = 1.0 if f < (1 + 360 / self.SWEEP) / 2 else 0.0
        self.set_frac(f)

    def _point(self, angle_deg: float, radius: float) -> tuple[float, float]:
        c = self.size / 2
        a = math.radians(angle_deg)
        return c + radius * math.cos(a), c - radius * math.sin(a)

    def _draw(self) -> None:
        self.delete("all")
        c = self.size / 2
        r = c - 16
        focused = self.focus_get() is self
        box = (c - r, c - r, c + r, c + r)
        self.create_arc(*box, start=self.START - self.SWEEP, extent=self.SWEEP,
                        style="arc", width=8, outline=C["track"])
        if self.frac > 0:
            self.create_arc(*box, start=self.START, extent=-self.SWEEP * self.frac,
                            style="arc", width=8, outline=C["estimate"])
        decades = round(self.hi - self.lo)
        for d in range(decades + 1):
            ang = self.START - self.SWEEP * d / decades
            self.create_line(*self._point(ang, r + 7), *self._point(ang, r + 13),
                             fill=C["axis"], width=1)
        kr = r - 16
        self.create_oval(c - kr, c - kr, c + kr, c + kr, fill=C["knob"],
                         outline=C["estimate"] if focused else C["knob"], width=2)
        ang = self.START - self.SWEEP * self.frac
        self.create_line(*self._point(ang, kr * 0.25), *self._point(ang, kr - 6),
                         fill="#ffffff", width=4, capstyle="round")
        self.create_text(*self._point(self.START + 22, r - 2), text="slow",
                         fill=C["muted"], font=SMALL)
        self.create_text(*self._point(self.START - self.SWEEP - 22, r - 2), text="fast",
                         fill=C["muted"], font=SMALL)


class PiApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.algos = {a.name: a for a in pialgos.ALGORITHMS}
        self.algo = pialgos.ALGORITHMS[0]
        self.rate = 20.0
        self.state = "idle"           # idle | running | paused | done
        self.after_id = None
        self._build()
        self._clear_run(1000)
        self._sync_controls()
        self._redraw()

    # ---------------------------------------------------------------- layout
    def _build(self) -> None:
        root = self.root
        root.title("Pi Approximations")
        root.configure(bg=C["bg"])
        root.minsize(900, 620)

        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure(".", background=C["bg"], foreground=C["text"])
        style.configure("TLabel", background=C["bg"], foreground=C["text"])
        style.configure("Muted.TLabel", foreground=C["muted"])
        style.configure("TCheckbutton", background=C["bg"])
        style.configure("TButton", padding=(12, 4))

        top = ttk.Frame(root, padding=(14, 12, 14, 4))
        top.pack(fill="x")

        ttk.Label(top, text="Algorithm").grid(row=0, column=0, sticky="w")
        self.algo_var = tk.StringVar(value=self.algo.name)
        self.algo_box = ttk.Combobox(top, textvariable=self.algo_var, state="readonly",
                                     values=list(self.algos), width=24)
        self.algo_box.grid(row=0, column=1, padx=(6, 18))
        self.algo_box.bind("<<ComboboxSelected>>", self._on_algo)

        self.n_label = ttk.Label(top, text="Terms", width=7)   # fixed: "Terms"/"Primes"
        self.n_label.grid(row=0, column=2, sticky="w")
        self.n_var = tk.StringVar(value="1000")
        vcmd = (root.register(lambda s: s == "" or (s.isdigit() and len(s) <= 10)), "%P")
        self.n_entry = ttk.Entry(top, textvariable=self.n_var, width=12,
                                 validate="key", validatecommand=vcmd)
        self.n_entry.grid(row=0, column=3, padx=(6, 18))
        self.n_entry.bind("<Return>", lambda e: self.start())

        self.start_btn = ttk.Button(top, text="Start", command=self.start)
        self.start_btn.grid(row=0, column=4)
        self.pause_btn = ttk.Button(top, text="Pause", command=self.toggle_pause)
        self.pause_btn.grid(row=0, column=5, padx=6)
        self.reset_btn = ttk.Button(top, text="Reset", command=self.reset)
        self.reset_btn.grid(row=0, column=6)
        self.learn_btn = ttk.Button(top, text="Learn…", command=self.open_help)
        self.learn_btn.grid(row=0, column=7, padx=(6, 0))

        self.formula = ttk.Label(top, style="Muted.TLabel")
        self.formula.grid(row=1, column=0, columnspan=8, sticky="w", pady=(8, 0))
        self.status = ttk.Label(top, foreground=C["bad"])
        self.status.grid(row=0, column=8, padx=(14, 0), sticky="w")

        body = ttk.Frame(root, padding=(14, 6, 14, 14))
        body.pack(fill="both", expand=True)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        # The side panel has a fixed width so that changing readout text
        # (counts, digits, error) never resizes it and shifts the plots.
        side_w = max(
            270,
            tkfont.Font(font=MONO_BIG).measure(PI_TEXT),
            tkfont.Font(font=MONO).measure("correct 15 decimal places"),
        ) + 12
        side = ttk.Frame(body, width=side_w)
        side.grid(row=0, column=0, sticky="ns", padx=(0, 14))
        side.pack_propagate(False)

        ttk.Label(side, text="Speed").pack(anchor="w")
        self.dial = Dial(side, RATE_MIN, RATE_MAX, self.rate, command=self._on_rate)
        self.dial.pack(pady=(4, 0))
        self.rate_label = ttk.Label(side, font=("DejaVu Sans", 11))
        self.rate_label.pack()
        ttk.Label(side, text="drag, scroll, or use arrow keys", style="Muted.TLabel",
                  font=SMALL).pack(pady=(0, 18))

        self.count_label = ttk.Label(side, font=("DejaVu Sans", 11), wraplength=side_w)
        self.count_label.pack(anchor="w", pady=(0, 10))

        ttk.Label(side, text="Estimate", style="Muted.TLabel").pack(anchor="w")
        est = ttk.Frame(side)
        est.pack(anchor="w")
        self.est_good = tk.Label(est, font=MONO_BIG, fg=C["good"], bg=C["bg"], padx=0, bd=0)
        self.est_good.pack(side="left")
        self.est_bad = tk.Label(est, font=MONO_BIG, fg=C["bad"], bg=C["bg"], padx=0, bd=0)
        self.est_bad.pack(side="left")
        tk.Label(side, text=PI_TEXT, font=MONO_BIG, fg=C["axis"], bg=C["bg"],
                 padx=0, bd=0).pack(anchor="w")
        ttk.Label(side, text="π (reference)", style="Muted.TLabel",
                  font=SMALL).pack(anchor="w", pady=(0, 12))

        self.err_label = ttk.Label(side, font=MONO)
        self.err_label.pack(anchor="w")
        self.digits_label = ttk.Label(side, font=MONO)
        self.digits_label.pack(anchor="w")

        self.zoom_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(side, text="Auto-zoom estimate plot", variable=self.zoom_var,
                        command=self._redraw).pack(anchor="w", pady=(18, 0))

        plots = ttk.Frame(body)
        plots.grid(row=0, column=1, sticky="nsew")
        plots.columnconfigure(0, weight=1)
        plots.rowconfigure(0, weight=1)
        plots.rowconfigure(1, weight=1)
        self.est_canvas = tk.Canvas(plots, bg=C["panel"], highlightthickness=1,
                                    highlightbackground=C["grid"])
        self.est_canvas.grid(row=0, column=0, sticky="nsew", pady=(0, 10))
        self.err_canvas = tk.Canvas(plots, bg=C["panel"], highlightthickness=1,
                                    highlightbackground=C["grid"])
        self.err_canvas.grid(row=1, column=0, sticky="nsew")
        for cv in (self.est_canvas, self.err_canvas):
            cv.bind("<Configure>", lambda e: self._redraw())

        root.bind("<Escape>", lambda e: self.toggle_pause())
        root.bind("<F1>", lambda e: self.open_help())
        self.help_win = None

    # ----------------------------------------------------------------- state
    def _clear_run(self, n_total: int) -> None:
        self.N = n_total
        self.n = 0
        self.value = None
        self.gen = None
        self.carry = 0.0
        self.chunk = 1                       # elements between clock checks (adapts)
        self.est_lo = [math.nan] * BINS     # per-bin min/max of the estimate
        self.est_hi = [math.nan] * BINS
        self.err_lo = [math.nan] * BINS     # per-bin min/max of log10(error)
        self.err_hi = [math.nan] * BINS
        self.last_est_bin = -1
        self.last_err_bin = -1

    def _sync_controls(self) -> None:
        active = self.state in ("running", "paused")
        self.algo_box.configure(state="disabled" if active else "readonly")
        self.n_entry.configure(state="disabled" if active else "normal")
        self.start_btn.configure(state="disabled" if active else "normal",
                                 text="Start" if self.state == "idle" else "Restart")
        self.pause_btn.configure(state="normal" if active else "disabled",
                                 text="Resume" if self.state == "paused" else "Pause")
        unit = self.algo.unit
        self.n_label.configure(text=unit.capitalize() + "s")
        self.formula.configure(text=self.algo.formula)
        self.rate_label.configure(text=f"{fmt_rate(self.rate)} {unit}s / second")

    def _on_algo(self, _event=None) -> None:
        self.algo = self.algos[self.algo_var.get()]
        self.algo_box.selection_clear()
        self._sync_controls()
        if self._help_open():
            self.help_win.show(self._help_index())

    # ------------------------------------------------------------------ help
    def _help_topics(self) -> list[tuple[str, str]]:
        topics = [("Reading the plots", "overview.md")]
        for a in pialgos.ALGORITHMS:
            topics.append((a.name, a.help_file or ""))
        return topics

    def _help_index(self) -> int:
        return 1 + pialgos.ALGORITHMS.index(self.algo)

    def _help_open(self) -> bool:
        return self.help_win is not None and self.help_win.winfo_exists()

    def open_help(self) -> None:
        """Open (or raise) the Learn window at the selected algorithm."""
        if not self._help_open():
            self.help_win = helpview.HelpWindow(self.root, self._help_topics())
        self.help_win.show(self._help_index())
        self.help_win.deiconify()
        self.help_win.lift()
        self.help_win.focus_set()

    def _on_rate(self, rate: float) -> None:
        self.rate = rate
        self._sync_controls()

    def start(self) -> None:
        if self.state in ("running", "paused"):
            return
        text = self.n_var.get()
        if not text or int(text) < 1:
            self.status.configure(text="Enter a whole number of at least 1.")
            self.n_entry.focus_set()
            return
        self.status.configure(text="")
        self._clear_run(int(text))
        self.gen = self.algo.estimates()
        self.carry = 1.0                     # show the first element right away
        self.state = "running"
        self.last_time = time.perf_counter()
        self._sync_controls()
        self._tick()

    def toggle_pause(self) -> None:
        if self.state == "running":
            self.state = "paused"
            self._cancel_tick()
        elif self.state == "paused":
            self.state = "running"
            self.last_time = time.perf_counter()
            self._tick()
        self._sync_controls()

    def reset(self) -> None:
        self._cancel_tick()
        self.state = "idle"
        self.status.configure(text="")
        self._clear_run(self.N)
        self._sync_controls()
        self._redraw()

    def _cancel_tick(self) -> None:
        if self.after_id is not None:
            self.root.after_cancel(self.after_id)
            self.after_id = None

    # ------------------------------------------------------------ simulation
    def _tick(self) -> None:
        self.after_id = None
        if self.state != "running":
            return
        now = time.perf_counter()
        self.carry += self.rate * (now - self.last_time)
        self.last_time = now
        steps = int(self.carry)
        if steps:
            done = self._advance(steps)
            # Drop any backlog the CPU could not keep up with, so the speed
            # dial stays responsive instead of "catching up" later.
            self.carry = 0.0 if done < steps else self.carry - steps
        self._redraw()
        if self.n >= self.N:
            self.state = "done"
            self._sync_controls()
        else:
            self.after_id = self.root.after(FRAME_MS, self._tick)

    def _advance(self, steps: int) -> int:
        steps = min(steps, self.N - self.n)
        deadline = time.perf_counter() + WORK_BUDGET
        gen, n, N, pi = self.gen, self.n, self.N, math.pi
        est_lo, est_hi, err_lo, err_hi = self.est_lo, self.est_hi, self.err_lo, self.err_hi
        lin = (BINS - 1) / (N - 1) if N > 1 else 0.0
        logk = (BINS - 1) / math.log(N) if N > 1 else 0.0
        log, log10 = math.log, math.log10
        v = self.value
        done = 0
        # Elements differ hugely in cost (a Leibniz term vs. a whole circle
        # crawl), so the chunk between clock checks adapts to stay on budget.
        size = self.chunk
        while done < steps:
            chunk = min(steps - done, size)
            t0 = time.perf_counter()
            for _ in range(chunk):
                v = next(gen)
                n += 1
                if v != v:                      # estimate not defined yet (nan)
                    continue
                b = int((n - 1) * lin)
                lo = est_lo[b]
                if lo != lo:                    # empty bin (nan)
                    est_lo[b] = est_hi[b] = v
                elif v < lo:
                    est_lo[b] = v
                elif v > est_hi[b]:
                    est_hi[b] = v
                err = abs(v - pi)
                le = log10(err) if err > 0 else -17.0
                b = int(log(n) * logk)
                lo = err_lo[b]
                if lo != lo:
                    err_lo[b] = err_hi[b] = le
                elif le < lo:
                    err_lo[b] = le
                elif le > err_hi[b]:
                    err_hi[b] = le
            done += chunk
            now = time.perf_counter()
            if now - t0 < 0.001:
                size = min(size * 2, 4096)
            elif now - t0 > 0.003:
                size = max(size // 2, 1)
            if now > deadline:
                break
        self.chunk = size
        self.n, self.value = n, v
        self.last_est_bin = int((n - 1) * lin)
        self.last_err_bin = int(log(n) * logk)
        return done

    # --------------------------------------------------------------- drawing
    def _redraw(self) -> None:
        self._draw_readout()
        self._draw_estimate()
        self._draw_error()

    def _draw_readout(self) -> None:
        unit = self.algo.unit + "s"
        self.count_label.configure(text=f"{fmt_count(self.n)} of {fmt_count(self.N)} {unit}")
        if self.value is None or self.value != self.value:
            self.est_good.configure(text="")
            self.est_bad.configure(text="–" if self.value is None else "not defined yet")
            self.err_label.configure(text="error   –")
            self.digits_label.configure(text="correct –")
            return
        text = f"{self.value:.15f}"
        match = 0
        for a, b in zip(text, PI_TEXT):
            if a != b:
                break
            match += 1
        self.est_good.configure(text=text[:match])
        self.est_bad.configure(text=text[match:])
        err = abs(self.value - math.pi)
        self.err_label.configure(text=f"error   {err:.3e}")
        decimals = max(0, match - 2)
        self.digits_label.configure(
            text=f"correct {decimals} decimal place{'s' if decimals != 1 else ''}")

    @staticmethod
    def _frame(cv: tk.Canvas):
        w, h = cv.winfo_width(), cv.winfo_height()
        left, right, top, bottom = 78, w - 18, 30, h - 30
        return w, h, left, right, top, bottom

    def _bins_to_points(self, lo, hi, last, xmap, ymap):
        """Turn per-bin min/max values into a polyline (an envelope where bins hold many points)."""
        pts = []
        filled = 0
        for b in range(last + 1):
            a, z = lo[b], hi[b]
            if a != a:            # empty bin
                continue
            filled += 1
            x = xmap(b)
            pts.append((x, ymap(a)))
            if z != a:
                pts.append((x, ymap(z)))
        return pts, filled

    def _draw_estimate(self) -> None:
        cv = self.est_canvas
        cv.delete("all")
        w, h, L, R, T, B = self._frame(cv)
        if R - L < 50 or B - T < 40:
            return
        cv.create_text(L, 14, text="Estimate vs. π", anchor="w", fill=C["text"],
                       font=("DejaVu Sans", 10, "bold"))
        cv.create_text(R, 14, text=f"x: {self.algo.unit}s used", anchor="e",
                       fill=C["muted"], font=SMALL)

        last = self.last_est_bin
        pi = math.pi
        half = 0.0
        if last >= 0:
            first = last // 4 if self.zoom_var.get() else 0
            for b in range(first, last + 1):
                if self.est_lo[b] == self.est_lo[b]:
                    half = max(half, abs(self.est_lo[b] - pi), abs(self.est_hi[b] - pi))
        half = max(half * 1.15, 1e-14) if half else 1.0
        mid = (T + B) / 2

        def ymap(v):
            return min(B, max(T, mid - (v - pi) / half * (B - T) / 2))

        # grid and y labels
        for frac, label in ((1, f"π + {half:.2e}"), (0.5, None), (0, "π"),
                            (-0.5, None), (-1, f"π − {half:.2e}")):
            y = mid - frac * (B - T) / 2
            if frac == 0:
                cv.create_line(L, y, R, y, fill=C["pi"], width=2, dash=(6, 4))
                cv.create_text(L - 8, y, text="π", anchor="e", fill=C["pi"],
                               font=("DejaVu Sans", 11, "bold"))
            else:
                cv.create_line(L, y, R, y, fill=C["grid"])
                if label:
                    cv.create_text(L - 8, y, text=label.split(" ", 1)[1], anchor="e",
                                   fill=C["muted"], font=SMALL)
        cv.create_rectangle(L, T, R, B, outline=C["axis"])
        span = R - L

        def xmap(b):
            return L + b / (BINS - 1) * span

        N = self.N
        for frac in (0, 0.25, 0.5, 0.75, 1):
            x = L + frac * span
            n = max(1, round(frac * N))
            cv.create_line(x, B, x, B + 4, fill=C["axis"])
            cv.create_text(x, B + 6, text=fmt_short(n), fill=C["muted"], font=SMALL,
                           anchor="ne" if frac == 1 else "n")

        if last < 0:
            cv.create_text((L + R) / 2, mid - 20, text="Press Start", fill=C["muted"],
                           font=("DejaVu Sans", 12))
            return
        pts, filled = self._bins_to_points(self.est_lo, self.est_hi, last, xmap, ymap)
        if len(pts) >= 2:
            cv.create_line(*[c for p in pts for c in p], fill=C["estimate"], width=1.5)
        if filled <= MARKER_LIMIT:
            for x, y in pts:
                cv.create_oval(x - 2.5, y - 2.5, x + 2.5, y + 2.5, fill=C["estimate"],
                               outline="")
        if self.value != self.value:
            return
        x, y = xmap(last), ymap(self.value)
        cv.create_oval(x - 5, y - 5, x + 5, y + 5, fill=C["panel"],
                       outline=C["estimate"], width=2.5)

    def _draw_error(self) -> None:
        cv = self.err_canvas
        cv.delete("all")
        w, h, L, R, T, B = self._frame(cv)
        if R - L < 50 or B - T < 40:
            return
        cv.create_text(L, 14, text="Error  |estimate − π|  (log scales)", anchor="w",
                       fill=C["text"], font=("DejaVu Sans", 10, "bold"))
        cv.create_text(R, 14, text=f"x: {self.algo.unit}s used", anchor="e",
                       fill=C["muted"], font=SMALL)

        last = self.last_err_bin
        lo_d, hi_d = 0, 1
        if last >= 0:
            vals = [v for b in range(last + 1) for v in (self.err_lo[b], self.err_hi[b])
                    if v == v]
            if vals:
                lo_d, hi_d = math.floor(min(vals)), math.ceil(max(vals))
            if hi_d - lo_d < 2:
                lo_d -= 1
                hi_d += 1

        def ymap(le):
            return B - (le - lo_d) / (hi_d - lo_d) * (B - T)

        step = max(1, math.ceil((hi_d - lo_d) / 8))
        for d in range(lo_d, hi_d + 1):
            y = ymap(d)
            cv.create_line(L, y, R, y, fill=C["grid"])
            if (d - lo_d) % step == 0:
                cv.create_text(L - 8, y, text=f"1e{d}", anchor="e", fill=C["muted"],
                               font=SMALL)
        cv.create_rectangle(L, T, R, B, outline=C["axis"])
        span = R - L
        N = self.N
        logN = math.log10(N) if N > 1 else 1.0

        def xmap(b):
            return L + b / (BINS - 1) * span

        decades = math.floor(logN) if N > 1 else 0
        xstep = max(1, math.ceil(decades / 10))
        for d in range(0, decades + 1, xstep):
            x = L + d / logN * span
            cv.create_line(x, B, x, B + 4, fill=C["axis"])
            cv.create_text(x, B + 6, text=fmt_short(10 ** d), fill=C["muted"], font=SMALL,
                           anchor="ne" if x > R - 1 else "n")
        if N > 1 and logN - decades > 0.3:
            cv.create_text(R, B + 6, text=fmt_short(N), fill=C["muted"], font=SMALL,
                           anchor="ne")

        if last < 0:
            return
        pts, filled = self._bins_to_points(self.err_lo, self.err_hi, last, xmap, ymap)
        if len(pts) >= 2:
            cv.create_line(*[c for p in pts for c in p], fill=C["error"], width=1.5)
        if filled <= MARKER_LIMIT:
            for x, y in pts:
                cv.create_oval(x - 2.5, y - 2.5, x + 2.5, y + 2.5, fill=C["error"],
                               outline="")
        if self.value != self.value:
            return
        err = abs(self.value - math.pi)
        le = math.log10(err) if err > 0 else -17.0
        x, y = xmap(last), ymap(le)
        cv.create_oval(x - 5, y - 5, x + 5, y + 5, fill=C["panel"],
                       outline=C["error"], width=2.5)


def main() -> None:
    root = tk.Tk()
    PiApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
