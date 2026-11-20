"""Pi approximation algorithms shared by genpi-gui.py and the genpi-*.py CLIs.

Each algorithm is a generator function that yields successive estimates of
pi without end: the first value uses 1 element of the series, the second
uses 2, and so on. A value of nan means the estimate is not defined yet
(for example, Buffon's needle before the first crossing).

To add an algorithm, write a generator function and add an Algorithm entry
to ALGORITHMS, with its teaching notes as a Markdown file in help/. The GUI's dropdown picks it up automatically, and a command-line
program for it is just a call to run_cli() (see genpi-leibniz.py).
"""

import math
import random
import sys
from dataclasses import dataclass
from itertools import count, islice
from typing import Callable, Iterator


@dataclass(frozen=True)
class Algorithm:
    name: str                              # shown in the dropdown
    unit: str                              # what one element is called, e.g. "term"
    formula: str                           # one-line description shown in the GUI
    count_help: str                        # what N means, for command-line usage
    estimates: Callable[[], Iterator[float]]
    # Optional shortcut that computes the n-th estimate directly, for
    # algorithms where running through elements 1..n-1 first would be wasteful.
    estimate_at: Callable[[int], float] | None = None
    # Teaching notes for this algorithm: a Markdown file in help/,
    # shown by the GUI's Learn window.
    help_file: str | None = None

    def estimate(self, n: int) -> float:
        """Return the estimate of pi that uses the first n elements (n >= 1)."""
        if self.estimate_at is not None:
            return self.estimate_at(n)
        return next(islice(self.estimates(), n - 1, None))


def leibniz() -> Iterator[float]:
    """pi = 4 * (1 - 1/3 + 1/5 - 1/7 + ...)"""
    total = 0.0
    sign = 1.0
    for k in count():
        total += sign / (2 * k + 1)
        sign = -sign
        yield 4.0 * total


def primes() -> Iterator[int]:
    """Yield the primes 2, 3, 5, 7, ... without end (incremental sieve).

    Memory grows only with the square root of the largest prime reached.
    """
    yield from (2, 3, 5, 7)
    sieve: dict[int, int] = {}       # next composite -> step between its multiples
    base = primes()                  # primes whose multiples we cross off
    next(base)                       # skip 2: we only test odd numbers
    p = next(base)                   # 3
    q = p * p                        # 9: next square to start crossing off
    for c in count(9, 2):
        if c in sieve:
            step = sieve.pop(c)
        elif c < q:
            yield c
            continue
        else:                        # c == q: start crossing off multiples of p
            step = 2 * p
            p = next(base)
            q = p * p
        m = c + step
        while m in sieve:
            m += step
        sieve[m] = step


def euler() -> Iterator[float]:
    """pi = 4 * (3/4 * 5/4 * 7/8 * 11/12 * ...), each prime over its nearest multiple of 4."""
    product = 1.0
    ps = primes()
    next(ps)                         # start at 3
    for p in ps:
        product *= p / (p - 1 if p % 4 == 1 else p + 1)
        yield 4.0 * product


def pascal() -> Iterator[float]:
    """pi = 3 + (2/3) * (1/4 - 1/20 + 1/56 - 1/120 + ...)

    The denominators 4, 20, 56, 120, ... are every other entry on the
    tetrahedral diagonal of Pascal's triangle (1, 4, 10, 20, 35, 56, 84, 120,
    ...), i.e. C(2k+2, 3) for k = 1, 2, 3, ... This is the Nilakantha series
    rewritten in terms of the triangle.
    """
    total = 0.0
    sign = 1.0
    for k in count(1):
        m = 2 * k + 2
        total += sign / (m * (m - 1) * (m - 2) // 6)    # C(2k+2, 3)
        sign = -sign
        yield 3.0 + 2.0 / 3.0 * total


def buffon() -> Iterator[float]:
    """Buffon's needle: pi ~= 2 * drops / crossings.

    Needles as long as the gap between parallel lines are dropped at random.
    Each one crosses a line with probability 2/pi, so the crossing rate gives
    an estimate of pi. The needle's random angle is made by picking a random
    point in a quarter circle (rejecting points outside it), so the
    simulation never uses pi itself. Results differ from run to run.
    """
    rng = random.random
    drops = crosses = 0
    while True:
        # Line spacing = needle length = 1. The needle's centre lands a random
        # distance (0 to 1/2) from the nearest line.
        centre = 0.5 * rng()
        while True:
            u, v = rng(), rng()
            r2 = u * u + v * v
            if 0.0 < r2 <= 1.0:
                break
        sin_angle = v / math.sqrt(r2)        # angle between needle and the lines
        drops += 1
        if centre <= 0.5 * sin_angle:        # half the needle reaches past the line
            crosses += 1
        yield 2.0 * drops / crosses if crosses else math.nan


def archimedes() -> Iterator[float]:
    """Archimedes: half the perimeter of polygons inside a circle of radius 1.

    Start with a hexagon (side 1, so the estimate is 3) and keep doubling the
    number of sides: 6, 12, 24, 48, ... Each doubling cuts the error by about
    4. The new side comes from the old one using square roots only:

        s' = s / sqrt(2 + sqrt(4 - s^2))

    and the half-perimeter grows by the factor 2s'/s, written so that it stays
    accurate (and simply stops changing) once s is tiny.
    """
    side = 1.0
    half_perimeter = 3.0             # hexagon: 6 sides of length 1, divided by 2
    while True:
        yield half_perimeter
        root = math.sqrt(2.0 + math.sqrt(4.0 - side * side))
        half_perimeter *= 2.0 / root
        side /= root


def crawl_circle(r: int) -> float:
    """Walk dividers of span 1 around a circle of radius r; return the estimate.

    Step around the circle from the starting point, each step a straight
    chord of length 1, until the next step would pass the start. The
    distance walked is the number of steps plus the straight gap back to the
    start; dividing by the diameter 2r estimates pi. Chords are shorter than
    the arcs they cut off, so the estimate is always a little low, by about
    1/(24 r^2) of pi.

    Each step is a rotation whose cosine and sine come from square roots,
    so pi is never used. A circle of radius r takes about 6r steps.
    """
    cos_a = 1.0 - 1.0 / (2.0 * r * r)              # chord of length 1 on radius r
    sin_a = math.sqrt(1.0 - 1.0 / (4.0 * r * r)) / r
    x, y = float(r), 0.0
    steps = 0
    while True:
        nx = x * cos_a - y * sin_a
        ny = x * sin_a + y * cos_a
        if y < 0.0 <= ny:                          # next step would pass the start
            break
        x, y = nx, ny
        steps += 1
    gap = math.hypot(x - r, y)
    return (steps + gap) / (2.0 * r)


def crawl() -> Iterator[float]:
    """Crawl around circles of radius 1, 2, 3, ... (see crawl_circle)."""
    for r in count(1):
        yield crawl_circle(r)


ALGORITHMS: list[Algorithm] = [
    Algorithm(
        name="Leibniz series",
        unit="term",
        formula="π = 4 · (1 − 1/3 + 1/5 − 1/7 + …)",
        count_help="number of terms",
        estimates=leibniz,
        help_file="leibniz.md",
    ),
    Algorithm(
        name="Euler prime product",
        unit="prime",
        formula="π = 4 · (3/4 · 5/4 · 7/8 · 11/12 · 13/12 · …)   each prime over its nearest multiple of 4",
        count_help="number of primes from 3",
        estimates=euler,
        help_file="euler.md",
    ),
    Algorithm(
        name="Pascal's triangle",
        unit="term",
        formula="π = 3 + (2/3) · (1/4 − 1/20 + 1/56 − 1/120 + …)   "
                "every other number on the triangle's tetrahedral diagonal",
        count_help="number of terms after the 3",
        estimates=pascal,
        help_file="pascal.md",
    ),
    Algorithm(
        name="Buffon's needle",
        unit="drop",
        formula="π ≈ 2 × drops ÷ crossings   random needles, as long as the line spacing, "
                "dropped on ruled lines",
        count_help="number of needles to drop",
        estimates=buffon,
        help_file="buffon.md",
    ),
    Algorithm(
        name="Archimedes' polygons",
        unit="polygon",
        formula="π ≈ half the perimeter of a polygon inside a circle of radius 1   "
                "6, 12, 24, 48, … sides, doubling each time",
        count_help="number of polygons: 6, 12, 24, ... sides",
        estimates=archimedes,
        help_file="archimedes.md",
    ),
    Algorithm(
        name="Circumference crawl",
        unit="circle",
        formula="π ≈ distance walked ÷ diameter   dividers of span 1 stepped around "
                "circles of radius 1, 2, 3, …",
        count_help="circle radius, in divider spans",
        estimates=crawl,
        estimate_at=crawl_circle,
        help_file="crawl.md",
    ),
]


def get(name: str) -> Algorithm:
    """Look up an algorithm by its name in ALGORITHMS."""
    for algo in ALGORITHMS:
        if algo.name == name:
            return algo
    raise KeyError(name)


def run_cli(name: str, argv: list[str]) -> int:
    """Command-line front end: `prog N` prints the estimate using N elements.

    Returns the process exit status (0 on success, 2 on a usage error).
    """
    algo = get(name)
    if len(argv) != 2:
        print(f"usage: {argv[0]} N   (N = {algo.count_help}, positive integer)", file=sys.stderr)
        return 2
    try:
        n = int(argv[1])
    except ValueError:
        print(f"error: N must be an integer, got {argv[1]!r}", file=sys.stderr)
        return 2
    if n < 1:
        print("error: N must be at least 1", file=sys.stderr)
        return 2

    approx = algo.estimate(n)
    label = algo.unit + "s:"
    print(f"{label:<{max(8, len(label) + 1)}}{n}")
    if approx != approx:
        print("pi ~=   not defined yet (try a larger N)")
        return 0
    print(f"pi ~=   {approx:.15f}")
    print(f"error:  {abs(approx - math.pi):.3e}")
    return 0
