# The Riemann Hypothesis, graphically

A small program that shows what the Riemann Hypothesis says and why it
matters for the primes, in three tabs:

1. **Zeros on the line.** |ζ(½ + it)| dips to zero again and again.
   Hardy's Z(t) shows the same values as a signed curve. Every zero found
   (138 of them, up to height 300) is drawn in the critical strip, and
   all of them sit on the line Re(s) = ½.
2. **Waves build the primes.** Riemann's smooth estimate R(x), plus one
   wave per pair of zeros. Slide in more zeros, or press Play, and the
   curve locks onto the true prime staircase π(x).
3. **Size of the error.** How far li(N) and N / ln N miss the true prime
   count up to 10 million, on log scales, next to the bound
   √N · ln N / (8π) that holds when the hypothesis is true.

Hover over any plot to read off values.

## Running it

You need Python 3.10 or newer, with Tk. Nothing else needs installing.

```
python3 riemann-gui.py
```

If Python says there is no module named `tkinter`, install it (on Debian or
Ubuntu: `sudo apt install python3-tk`).

## How the numbers are computed

Everything is in `zetamath.py`, written with the standard library only:

- ζ(s) by Euler–Maclaurin summation, and Riemann–Siegel θ(t) from a
  Stirling series for log Γ
- zeros found as sign changes of Z(t), then refined
- li and Ei by power series and continued fraction; R(x) as
  Σ μ(n)/n · li(x^(1/n))
- each zero's wave as −2 Re R(x^ρ), so that
  π(x) = R(x) − 1/ln x + arctan(π / ln x)/π + Σ waves

`tests/check_math.py` checks these against published values: ζ(2),
ζ(−1), ζ(½), li(10⁶), π(10⁶), the first ten zeros, N(100) = 29, and the
explicit formula landing on the true prime count. It also checks that no
zero below 300 was missed, by comparing the count with θ(t)/π + 1.

```
python3 tests/check_math.py
```
