#!/usr/bin/env python3
"""Approximate pi with Buffon's needle (a random simulation).

Drop needles at random onto a floor ruled with parallel lines, where the
needle length equals the line spacing. A needle crosses a line with
probability 2/pi, so

    pi ~= 2 * drops / crossings

Results differ from run to run, and the error shrinks only like 1/sqrt(N).

Usage: genpi-buffon.py N
    N  number of needles to drop (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Buffon's needle", sys.argv))
