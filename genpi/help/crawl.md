# Circumference crawl

```
π ≈ distance walked ÷ diameter
```

Set a pair of dividers to a span of 1 and walk them around a circle, one straight step at a time, until the next step would pass the starting point. Add the short straight gap back to the start. The total distance divided by the diameter estimates π.

In the GUI, element number r is a whole crawl around a circle of radius r: radius 1, then radius 2, then radius 3, and so on, always with the same stride.

## Is a bigger circle better?

Only because the stride stays the same. π is a ratio, so scaling everything up, circle and stride together, gives exactly the same answer. What matters is how short each step is **compared with** the circle. With a fixed stride, a bigger circle means more steps, each one a smaller slice of the curve, and so a closer fit.

## Why it is always a little low

Each step is a straight **chord**, and a chord is always shorter than the curved arc it cuts off. For a step of length 1 on a circle of radius r, the arc is about 1 + 1/(24r²). Every step falls short by the same small fraction, so the estimate falls short by about π ÷ (24r²).

- radius 1: the dividers trace a hexagon exactly, giving 3
- radius 10: 3.14029 (error about 0.0013)
- radius 100: 3.1415796 (error about 0.000013)
- radius 1,000: 3.141592523 (error about 0.00000013)

Ten times bigger, a hundred times closer: a slope of −2 on the error plot.

## How the program walks without knowing π

Each step turns the dividers through the same angle around the centre. The law of cosines gives that angle's cosine directly from the stride and the radius:

```
cos(angle) = 1 − 1 ÷ (2r²)
```

and its sine follows from Pythagoras. Rotating the current point by that angle is then just multiplication and addition. No π, no trigonometry tables: only the circle, the stride and square roots.

## Relation to Archimedes

The crawl is Archimedes' polygon method seen differently. Archimedes chooses the number of sides and computes their length; the crawl chooses the length and counts the sides. Its path is an inscribed polygon whose last side is a short leftover.

## Why the GUI takes longer here

A circle of radius r takes about 6r steps, and the GUI walks every circle from radius 1 up to N, about 3N² steps in all. That is fine up to a few thousand, but N = 100,000 would mean about 30,000,000,000 steps. The command-line program `genpi-crawl.py`, part of the Python version, walks only the one circle you ask for, so it is fast even for large radii.

## The coastline paradox

This is exactly how a surveyor measures a coastline: walk dividers along it and count the steps. For a smooth curve such as a circle, shorter strides settle on a definite length. In the 1950s Lewis Fry **Richardson** noticed that for real coastlines they do not: the measured length keeps growing as the stride shrinks, because there is always finer wiggling to follow. Benoît **Mandelbrot** made this famous in 1967 as "How long is the coast of Britain?", one of the founding ideas of **fractals**.

> Try this: run 2,000 circles at full speed. The error line is straight, steeper than Leibniz but less steep than Pascal.
