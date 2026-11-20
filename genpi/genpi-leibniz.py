#!/usr/bin/env python3
"""Approximate pi using the Leibniz series.

    pi = 4 * (1 - 1/3 + 1/5 - 1/7 + ...)

Usage: genpi-leibniz.py N
    N  number of terms of the series to sum (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Leibniz series", sys.argv))
