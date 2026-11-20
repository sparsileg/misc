#!/usr/bin/env python3
"""Approximate pi using Pascal's triangle.

    pi = 3 + (2/3) * (1/4 - 1/20 + 1/56 - 1/120 + ...)

The denominators are every other number on the triangle's tetrahedral
diagonal (1, 4, 10, 20, 35, 56, 84, 120, ...), which is C(2k+2, 3).
This is the Nilakantha series written in terms of Pascal's triangle.

Usage: genpi-pascal.py N
    N  number of terms to add after the 3 (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Pascal's triangle", sys.argv))
