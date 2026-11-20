# Buffon's needle

```
π ≈ 2 × drops ÷ crossings
```

Rule a floor with parallel lines one needle-length apart. Drop needles on it at random and count how many land across a line. About 2 out of every π drops cross, so twice the number of drops divided by the number of crossings estimates π.

## History

Georges-Louis Leclerc, **Comte de Buffon**, posed the question in 1733 and published the answer in 1777. It is one of the oldest problems in *geometric probability*, and the ancestor of the **Monte Carlo method**: using randomness to compute things that are not random at all. Monte Carlo methods now run simulations of everything from nuclear physics to finance.

In 1901 the Italian mathematician Mario **Lazzarini** reported dropping 3,408 needles and getting 3.1415929, correct to six decimal places. That is far better than chance allows for so few drops. It is exactly the famous fraction 355/113, and it is widely believed he stopped at the moment the count gave that fraction.

## Why it works: the noodle argument

There is a beautiful argument that needs no calculus, published by Joseph-Émile **Barbier** in 1860.

1. Bend the needle into any shape (a "noodle"). The *average* number of crossings depends only on its length, not its shape: each small piece of it crosses as often on average as any other piece of the same length, wherever it sits and whichever way it points.
2. So the average is proportional to length: crossings = k × length, for some number k.
3. Now take a noodle bent into a circle whose diameter equals the line spacing. However it lands, it touches the lines exactly **twice**. Its length is π × spacing, so k × π × spacing = 2.
4. A straight needle one spacing long therefore crosses 2 ÷ π times on average. It can never cross more than once, so this average is also the *chance* that it crosses.

## How the program drops a needle

For each needle it picks:

- how far the needle's centre lands from the nearest line: anywhere from 0 to half the spacing
- the angle between the needle and the lines

The needle crosses if half its length, tilted at that angle, reaches the line.

Picking a random angle normally uses π, which would be cheating. Instead, the program picks a random point in a square, throws it away if it lies outside the quarter circle in the corner, and takes the needle's angle from the point. Every direction is equally likely and π is never used.

## How fast?

Very slowly, and never reliably. The estimate is random, so every run is different. The typical error after N drops is about 2.4 ÷ √N:

- 10,000 drops: typically off by about 0.02
- 1,000,000 drops: typically off by about 0.002

One more correct digit needs **a hundred times** more drops. To get within one millionth of π you would need, on average, about 5 million million drops. This square-root law is the price of almost every Monte Carlo method.

Until the first needle crosses a line, 2 × drops ÷ crossings would divide by zero, so the estimate shows "not defined yet".

## Things to watch

- The top plot looks like a random walk that slowly settles, not a smooth curve.
- The error plot trends down with a slope of about −½, but with deep spikes where the estimate passes through π by luck.
- The first few estimates jump between simple fractions such as 2, 4 and 3.33, because they are ratios of small whole numbers.

> Try this: run 1,000,000 drops three times. How many correct decimal places did each run get?
