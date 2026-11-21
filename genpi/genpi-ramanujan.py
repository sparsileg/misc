#!/usr/bin/env python3
"""Approximate pi with Ramanujan's 1914 series.

    1/pi = (2*sqrt(2)/9801) * sum over k = 0, 1, 2, ... of
           (4k)! (1103 + 26390 k) / ((k!)^4 396^(4k))

Each term adds about 8 correct digits, so in ordinary 16-digit arithmetic
the estimate reaches full precision with 2 terms.

Usage: genpi-ramanujan.py N
    N  number of terms (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Ramanujan's series", sys.argv))
