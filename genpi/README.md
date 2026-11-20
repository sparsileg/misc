# Pi Approximations

Watch six ways of approximating π converge, one element at a time, and
learn how each one works.

- Leibniz series
- Euler prime product
- Pascal's triangle (the Nilakantha series)
- Buffon's needle
- Archimedes' polygons
- Circumference crawl

## Running it

You need Python 3.10 or newer. Nothing else needs installing: the program
uses only what comes with Python.

```
python3 genpi-gui.py
```

On Windows, use `python genpi-gui.py`. Some Linux systems ship Tk, the
toolkit the window is built with, separately; if Python says there is no
module named `tkinter`, install it (on Debian or Ubuntu:
`sudo apt install python3-tk`).

Press **Learn…** (or F1) in the program for the story and the mathematics
behind each method.

## Command-line programs

Each method also has a command-line program that prints one estimate:

```
python3 genpi-leibniz.py 1000000
python3 genpi-pascal.py 100
python3 genpi-archimedes.py 10
```

The number is how many elements to use: terms, primes, needle drops,
polygons, or (for `genpi-crawl.py`) the circle's radius.
