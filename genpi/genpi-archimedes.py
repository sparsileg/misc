#!/usr/bin/env python3
"""Approximate pi with Archimedes' polygons.

Fit a regular polygon inside a circle of radius 1 and take half its
perimeter. Start with a hexagon (estimate 3) and double the number of
sides each time: 6, 12, 24, 48, ... Each doubling makes the error about
4 times smaller, and the new side length needs only square roots:

    s' = s / sqrt(2 + sqrt(4 - s^2))

Usage: genpi-archimedes.py N
    N  number of polygons (N = 1 is the hexagon, N = 5 has 96 sides)

The algorithm itself lives in pialgos.py, shared with genpi-gui.py.
"""

import sys

import pialgos

if __name__ == "__main__":
    sys.exit(pialgos.run_cli("Archimedes' polygons", sys.argv))
