"""The mathematics behind riemann-gui.py, using only the Python standard library.

- zeta(s): the Riemann zeta function for complex s, by Euler-Maclaurin summation
- theta(t), hardy_z(t): the Riemann-Siegel functions; Z(t) is real, |Z(t)| equals
  |zeta(1/2 + it)|, and Z changes sign exactly where zeta has a zero on the line
- find_zeros(tmax): the zeros 1/2 + i*gamma with 0 < gamma <= tmax
- li(x), riemann_r(x): the smooth prime-count estimates
- zero_wave(x, gamma): how much one pair of zeros adds to Riemann's prime count
- prime_sieve(n): exact prime counts to compare against
"""

import cmath
import math
from fractions import Fraction

EULER_GAMMA = 0.5772156649015329


def _bernoulli(count: int) -> list[float]:
    """B_2, B_4, ..., B_(2*count), by the Akiyama-Tanigawa algorithm."""
    n_max = 2 * count
    out, a = [], [Fraction(0)] * (n_max + 1)
    for m in range(n_max + 1):
        a[m] = Fraction(1, m + 1)
        for j in range(m, 0, -1):
            a[j - 1] = j * (a[j - 1] - a[j])
        if m >= 2 and m % 2 == 0:
            out.append(float(a[0]))
    return out


B2K = _bernoulli(12)                  # B_2 .. B_24
_FACT = [math.factorial(k) for k in range(30)]
EM_TERMS = 12                         # Euler-Maclaurin correction terms


def zeta(s: complex, n_terms: int = 0) -> complex:
    """Riemann zeta function for any complex s except the pole s = 1.

    Uses the functional equation for Re(s) < 0, and Euler-Maclaurin summation
    otherwise. Accurate to about 1e-10 for |Im(s)| up to a few thousand.
    `n_terms` overrides how many terms are summed directly (for testing).
    """
    s = complex(s)
    if s == 1:
        raise ZeroDivisionError("zeta has a pole at s = 1")
    if s.real < 0:
        # zeta(s) = 2^s pi^(s-1) sin(pi s/2) Gamma(1-s) zeta(1-s)
        return (2 ** s * cmath.pi ** (s - 1) * cmath.sin(cmath.pi * s / 2)
                * cmath.exp(lngamma(1 - s)) * zeta(1 - s))
    n_terms = n_terms or 10 + int(abs(s.imag) / 2)
    total = sum(k ** -s for k in range(1, n_terms))
    big_n = float(n_terms)
    total += big_n ** (1 - s) / (s - 1) + 0.5 * big_n ** -s
    rising = s                        # s (s+1) ... (s+2k-2)
    power = big_n ** (-s - 1)         # N^(-s-2k+1)
    for k in range(1, EM_TERMS + 1):
        total += B2K[k - 1] / _FACT[2 * k] * rising * power
        rising *= (s + 2 * k - 1) * (s + 2 * k)
        power /= big_n * big_n
    return total


def lngamma(z: complex) -> complex:
    """log Gamma(z) for Re(z) > 0, on the branch that is continuous in z."""
    z = complex(z)
    shift = 0j
    while abs(z) < 15 or z.real < 8:
        shift += cmath.log(z)
        z += 1
    series = sum(B2K[k - 1] / (2 * k * (2 * k - 1) * z ** (2 * k - 1)) for k in range(1, 9))
    return (z - 0.5) * cmath.log(z) - z + 0.5 * math.log(2 * math.pi) + series - shift


def theta(t: float) -> float:
    """Riemann-Siegel theta: arg Gamma(1/4 + it/2) - (t/2) ln pi, continuous in t."""
    return lngamma(complex(0.25, t / 2)).imag - t / 2 * math.log(math.pi)


def hardy_z(t: float) -> float:
    """Hardy's Z(t) = e^(i theta(t)) zeta(1/2 + it): real, and |Z(t)| = |zeta(1/2 + it)|."""
    return (cmath.exp(1j * theta(t)) * zeta(complex(0.5, t))).real


def zero_count_estimate(t: float) -> float:
    """theta(t)/pi + 1: the number of zeros up to height t, give or take S(t)."""
    return theta(t) / math.pi + 1


def find_zeros(tmax: float, progress=None) -> list[float]:
    """Heights gamma of the zeros 1/2 + i*gamma with 0 < gamma <= tmax.

    Scans Z(t) for sign changes on a grid much finer than the average gap
    between zeros, then refines each one. `progress(fraction)` is called now
    and then if given.
    """
    zeros: list[float] = []
    t, z_prev = 1.0, hardy_z(1.0)
    while t < tmax:
        mean_gap = 2 * math.pi / math.log(max(t, 20) / (2 * math.pi))
        step = min(0.2, mean_gap / 12, tmax - t)
        t_next = t + step
        z_next = hardy_z(t_next)
        if (z_prev < 0) != (z_next < 0):
            zeros.append(_refine(t, t_next, z_prev, z_next))
        t, z_prev = t_next, z_next
        if progress and len(zeros) % 5 == 0:
            progress(t / tmax)
    return zeros


def _refine(a: float, b: float, fa: float, fb: float) -> float:
    """A root of Z between a and b (opposite signs), by the Illinois method."""
    side = 0
    for _ in range(100):
        c = (a * fb - b * fa) / (fb - fa)
        fc = hardy_z(c)
        if abs(b - a) < 1e-12 or fc == 0:
            return c
        if (fc < 0) == (fb < 0):
            b, fb = c, fc
            if side == -1:
                fa /= 2
            side = -1
        else:
            a, fa = c, fc
            if side == 1:
                fb /= 2
            side = 1
    return (a + b) / 2


# --- Prime counting ---------------------------------------------------------

def ei(w: complex) -> complex:
    """Exponential integral Ei(w), with the branch cut along the negative real axis."""
    w = complex(w)
    if abs(w) < 10 or w.real >= abs(w.imag):
        # Power series: fine here because the terms do not cancel badly.
        total, term = 0j, 1 + 0j
        for k in range(1, 400):
            term *= w / k
            total += term / k
            if abs(term) < 1e-17 * max(1.0, abs(total)):
                break
        return EULER_GAMMA + cmath.log(w) + total
    # Ei(w) = -E1(-w) + i*pi*sign(Im w); E1 by its continued fraction (Lentz).
    z = -w
    tiny = 1e-300
    f = c = z + 1
    d = 0j
    for k in range(1, 2000):
        an = -(k * k)
        bn = z + 2 * k + 1
        d = bn + an * d
        d = 1 / (d if d != 0 else tiny)
        c = bn + an / c
        if c == 0:
            c = tiny
        delta = c * d
        f *= delta
        if abs(delta - 1) < 1e-15:
            break
    e1 = cmath.exp(-z) / f
    sign = 1 if w.imag > 0 else (-1 if w.imag < 0 else 0)
    return -e1 + 1j * math.pi * sign


def li(x: float) -> float:
    """Logarithmic integral li(x) = integral of dt/ln t from 0 to x (x > 1)."""
    return ei(math.log(x)).real


def mobius_upto(n: int) -> list[int]:
    """The Mobius function mu(k) for 0 <= k <= n (mu(0) is unused)."""
    mu = [1] * (n + 1)
    flags = prime_sieve(n)
    for p in range(2, n + 1):
        if flags[p]:
            for m in range(p, n + 1, p):
                mu[m] = -mu[m]
            for m in range(p * p, n + 1, p * p):
                mu[m] = 0
    return mu




def _r_terms(x: float) -> int:
    """How many terms of Riemann's R series to use: keep x^(1/n) >= 2."""
    return max(1, int(math.log2(x)))


def riemann_r(x: float) -> float:
    """Riemann's R(x) = sum over n of mu(n)/n * li(x^(1/n)): the smooth prime count."""
    lnx = math.log(x)
    return sum(_MU[n] / n * ei(lnx / n).real for n in range(1, _r_terms(x) + 1) if _MU[n])


def smooth_part(x: float) -> float:
    """R(x) plus the small terms from the trivial zeros and the constant."""
    lnx = math.log(x)
    return riemann_r(x) - 1 / lnx + math.atan(math.pi / lnx) / math.pi


def zero_wave(x: float, gamma: float) -> float:
    """What the zero pair 1/2 +- i*gamma adds to the prime count at x.

    This is -(R(x^rho) + R(x^conj(rho))) = -2 Re R(x^rho), so that
    pi(x) = smooth_part(x) + sum of zero_wave(x, gamma) over all zeros.
    """
    rho_lnx = complex(0.5, gamma) * math.log(x)
    return -2 * sum(_MU[n] / n * ei(rho_lnx / n).real
                    for n in range(1, _r_terms(x) + 1) if _MU[n])


def prime_sieve(n: int) -> bytearray:
    """flags[k] == 1 exactly when k is prime, for 0 <= k <= n."""
    flags = bytearray([1]) * (n + 1)
    flags[0:2] = b"\x00\x00"
    for p in range(2, math.isqrt(n) + 1):
        if flags[p]:
            flags[p * p::p] = bytes(len(range(p * p, n + 1, p)))
    return flags


_MU = mobius_upto(64)
