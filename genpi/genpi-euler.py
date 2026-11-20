#!/usr/bin/env python3
"""Approximate pi using Euler's product formula over the primes from 3 onward.

    pi = 4 * (3/4 * 5/4 * 7/8 * 11/12 * 13/12 * 17/16 * ...)

Each prime p is divided by the multiple of 4 nearest to it
(p - 1 if p = 1 mod 4, p + 1 if p = 3 mod 4). Factors are taken in
prime order, since the product converges only conditionally.

Usage: genpi-euler.py N
    N  number of primes to use, starting with 3 (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Euler prime product", sys.argv))
