#!/usr/bin/env python3
"""Approximate pi by walking dividers around a circle.

With dividers set to a span of 1, step around a circle of radius N,
counting straight steps until the next one would pass the starting point,
then add the straight gap back to the start. Distance walked divided by the
diameter (2N) estimates pi. Each step is a chord, slightly shorter than the
arc it cuts off, so the answer is always a little low; the error shrinks
like 1/N^2. Square roots only: pi is never used.

Usage: genpi-crawl.py N
    N  circle radius, in divider spans (positive integer)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Circumference crawl", sys.argv))
