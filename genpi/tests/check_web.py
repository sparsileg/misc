#!/usr/bin/env python3
"""Check that the browser version computes exactly what the Python version does.

Runs web/pialgos.js and web/format.js under Node (needs `node` on the PATH)
and compares them with pialgos.py and genpi-gui.py's formatting:

- every estimate from the deterministic algorithms, bit for bit
- the readout and axis-label text built from those numbers
- Buffon's needle (random, so statistically): both versions' averages
  are close to pi and their run-to-run spreads agree

Usage: tests/check_web.py
"""

import importlib.util
import json
import math
import random
import statistics
import subprocess
import sys
import tempfile
import time
from array import array
from itertools import islice
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import pialgos  # noqa: E402

SEQUENCES = {             # algorithm -> how many estimates to compare
    "leibniz": 2_000_000,
    "euler": 300_000,
    "pascal": 1_000_000,  # past m = 200,000, where the JS switches to BigInt
    "archimedes": 60,
    "crawl": 1_000,       # radii 1..1000 (about 3 million divider steps)
    "ramanujan": 60,      # the terms underflow to 0 long before 60
    "chudnovsky": 60,
}
CRAWL_AT = [2_000, 5_000, 12_345, 50_000, 100_000]
BUFFON_RUNS, BUFFON_DROPS = 400, 20_000


def load_gui():
    spec = importlib.util.spec_from_file_location("gui", ROOT / "genpi-gui.py")
    gui = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gui)
    return gui


def compare(name, py, js) -> bool:
    if len(py) != len(js):
        print(f"FAIL {name}: {len(py)} Python values, {len(js)} JavaScript values")
        return False
    for i, (a, b) in enumerate(zip(py, js)):
        if not (a == b or (a != a and b != b)):
            print(f"FAIL {name}: first difference at element {i + 1}: "
                  f"Python {a!r}, JavaScript {b!r}")
            return False
    print(f"ok   {name}: {len(py):,} values identical")
    return True


def main() -> int:
    gui = load_gui()
    t0 = time.perf_counter()
    py = {name: list(islice(getattr(pialgos, name)(), n)) for name, n in SEQUENCES.items()}
    py["crawl_at"] = [pialgos.crawl_circle(r) for r in CRAWL_AT]
    py_buffon = []
    for _ in range(BUFFON_RUNS):
        py_buffon.append(next(islice(pialgos.buffon(), BUFFON_DROPS - 1, None)))
    print(f"(Python reference computed in {time.perf_counter() - t0:.1f} s)")

    # Formatting inputs: a spread of real estimates and errors, plus edge cases.
    rnd = random.Random(1)
    estimates = [v for seq in py.values() for v in seq[::997] if v == v]
    estimates += [math.pi, 3.0, 3.1415926535897936, 3.141592653589793 - 2e-16,
                  3 + 1 / 65536, 3 + 3 / 65536, 2.5, 0.0]
    errors = [abs(v - math.pi) for v in estimates if v != math.pi]
    errors += [1.0, 0.5, 9.9995e-5, 9.99949e-5, 1e-16, 4.440892098500626e-16, 123.456,
               1.0625, 1.00625, 0.0001234375, 9.9995, 0.0]
    shorts = sorted({max(1, round(f * n)) for n in
                     [1, 2, 7, 10, 999, 1000, 1001, 9999, 25_000, 999_999, 1_000_000,
                      3_500_000, 123_456_789, 999_999_999, 1_000_000_000, 9_999_999_999]
                     for f in (0, 0.25, 0.5, 0.75, 1)} | {10 ** d for d in range(11)})
    counts = [0, 1, 999, 1000, 1234567, 9_999_999_999] + [rnd.randrange(10 ** 10) for _ in range(200)]
    rates = [10 ** (k / 60 * 6) for k in range(61)] + [rnd.uniform(1, 1e6) for _ in range(500)]
    rates += [1.25, 2.25, 12.5, 13.5, 1234.5, 9.95, 9.999]

    request = {
        "sequences": SEQUENCES,
        "crawl_at": CRAWL_AT,
        "buffon": {"runs": BUFFON_RUNS, "drops": BUFFON_DROPS},
        "formats": {"fixed15": estimates, "e3": errors, "e2": errors, "short": shorts,
                    "count": counts, "rate": rates},
    }
    with tempfile.TemporaryDirectory() as tmp:
        request["outdir"] = tmp
        t0 = time.perf_counter()
        subprocess.run(["node", "--no-warnings", str(ROOT / "tests" / "web_values.mjs")],
                       input=json.dumps(request), text=True, check=True)
        print(f"(JavaScript values computed in {time.perf_counter() - t0:.1f} s)")

        def read(name):
            a = array("d")
            a.frombytes((Path(tmp) / f"{name}.f64").read_bytes())
            return a.tolist()

        ok = all([compare(name, py[name], read(name)) for name in [*SEQUENCES, "crawl_at"]])
        js_fmt = json.loads((Path(tmp) / "formats.json").read_text())
        js_buffon = read("buffon")

    py_fmt = {
        "fixed15": [f"{v:.15f}" for v in estimates],
        "e3": [f"{v:.3e}" for v in errors],
        "e2": [f"{v:.2e}" for v in errors],
        "short": [gui.fmt_short(n) for n in shorts],
        "count": [gui.fmt_count(n) for n in counts],
        "rate": [gui.fmt_rate(r) for r in rates],
    }
    for key, values in py_fmt.items():
        bad = [(a, b) for a, b in zip(values, js_fmt[key]) if a != b]
        if bad or len(values) != len(js_fmt[key]):
            ok = False
            print(f"FAIL format {key}: {len(bad)} differ, e.g. Python {bad[0][0]!r} "
                  f"vs JavaScript {bad[0][1]!r}" if bad else f"FAIL format {key}: length")
        else:
            print(f"ok   format {key}: {len(values):,} strings identical")

    # Buffon's needle: each run's estimate has spread about 2.37 / sqrt(drops).
    expected_sd = 2.37 / math.sqrt(BUFFON_DROPS)
    for label, ends in (("Python", py_buffon), ("JavaScript", js_buffon)):
        mean, sd = statistics.fmean(ends), statistics.stdev(ends)
        mean_ok = abs(mean - math.pi) < 4 * sd / math.sqrt(len(ends))
        sd_ok = 0.85 < sd / expected_sd < 1.15
        ok &= mean_ok and sd_ok
        print(f"{'ok  ' if mean_ok and sd_ok else 'FAIL'} buffon {label}: {len(ends)} runs of "
              f"{BUFFON_DROPS:,} drops, mean {mean:.5f}, spread {sd:.5f} "
              f"(expected about {expected_sd:.5f})")

    print("ALL OK" if ok else "SOME CHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
