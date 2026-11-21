#!/usr/bin/env python3
"""Check zetamath.py against values known from the literature.

Usage: tests/check_math.py   (exits non-zero on the first failure)
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import zetamath as zm  # noqa: E402

# First zeros, from Odlyzko's tables.
KNOWN_ZEROS = [14.134725141735, 21.022039638772, 25.010857580146,
               30.424876125860, 32.935061587739, 37.586178158826,
               40.918719012147, 43.327073280915, 48.005150881167,
               49.773832477672]

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    print(f"{'ok  ' if ok else 'FAIL'} {name}{'  ' + detail if detail else ''}")
    failures += not ok


def close(a, b, tol):
    return abs(a - b) <= tol


check("zeta(2) = pi^2/6", close(zm.zeta(2), math.pi ** 2 / 6, 1e-13))
check("zeta(-1) = -1/12", close(zm.zeta(-1), -1 / 12, 1e-13))
check("zeta(1/2) = -1.4603545088", close(zm.zeta(0.5), -1.4603545088095868, 1e-12))
check("zeta(1/2 + 1000i) = 0.356334 + 0.931998i",
      close(zm.zeta(complex(0.5, 1000)), complex(0.356334, 0.931998), 1e-6))
# The same value summed a different way must agree far more closely.
for t in (14.1, 100.0, 300.0, 1000.0):
    s = complex(0.5, t)
    check(f"zeta(1/2 + {t:g}i) independent of truncation",
          close(zm.zeta(s), zm.zeta(s, n_terms=3 * (10 + int(t / 2))), 1e-10))
check("li(10^6) = 78627.549159", close(zm.li(1e6), 78627.549159462, 1e-6))
check("R(10^6) close to 78527.399", close(zm.riemann_r(1e6), 78527.3994, 0.1))

zeros = zm.find_zeros(300)
check("first ten zeros", all(close(a, b, 1e-9) for a, b in zip(zeros, KNOWN_ZEROS)))
check("N(100) = 29", sum(g <= 100 for g in zeros) == 29)
# No zero missed or doubled: between consecutive zeros, the count must agree
# with theta(t)/pi + 1 to within |S(t)| < 1.
worst = max(abs(k + 1 - zm.zero_count_estimate((a + b) / 2))
            for k, (a, b) in enumerate(zip(zeros, zeros[1:])))
check("zero count agrees with theta(t)/pi + 1", worst < 1, f"(worst gap {worst:.2f})")

flags = zm.prime_sieve(100)
for x in (10.5, 29.5, 50.5, 96.5):
    exact = sum(flags[: int(x) + 1])
    approx = zm.smooth_part(x) + sum(zm.zero_wave(x, g) for g in zeros)
    check(f"explicit formula at x = {x}", abs(approx - exact) < 0.25,
          f"({approx:.3f} vs {exact})")

flags = zm.prime_sieve(10 ** 6)
check("pi(10^6) = 78498", sum(flags) == 78498)

sys.exit(1 if failures else 0)
