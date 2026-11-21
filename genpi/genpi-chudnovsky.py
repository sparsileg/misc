#!/usr/bin/env python3
"""Approximate pi with the Chudnovsky formula.

    pi = 426880 * sqrt(10005) / sum over k = 0, 1, 2, ... of
         (6k)! (13591409 + 545140134 k) / ((3k)! (k!)^3 (-640320^3)^k)

Each term adds about 14 correct digits, so in ordinary 16-digit arithmetic
the estimate reaches full precision with 2 terms.

Usage: genpi-chudnovsky.py N
    N  number of terms (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Chudnovsky formula", sys.argv))
