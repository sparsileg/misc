# Pascal's triangle

```
π = 3 + (2/3) × (1/4 − 1/20 + 1/56 − 1/120 + 1/220 − …)
```

Start at 3, then add and subtract reciprocals of numbers taken from Pascal's triangle.

## Where the numbers come from

In Pascal's triangle each number is the sum of the two above it:

```
              1
            1   1
          1   2   1
        1   3   3   1
      1   4   6   4   1
    1   5  10  10   5   1
  1   6  15  20  15   6   1
1   7  21  35  35  21   7   1
```

Read the triangle along its diagonals:

- the edge: 1, 1, 1, 1, …
- the counting numbers: 1, 2, 3, 4, 5, …
- the triangular numbers: 1, 3, 6, 10, 15, … (dots arranged in a triangle)
- the **tetrahedral numbers**: 1, 4, 10, 20, 35, 56, 84, 120, 165, 220, … (balls stacked in a triangular pyramid)

The denominators 4, 20, 56, 120, 220, … are every other tetrahedral number. In the triangle's own notation they are C(4,3), C(6,3), C(8,3), …: the number of ways to choose 3 things from 4, from 6, from 8, and so on.

## History

This is the **Nilakantha series**, written down by Nilakantha Somayaji of the Kerala school in India around 1500, usually in the form

```
π = 3 + 4/(2×3×4) − 4/(4×5×6) + 4/(6×7×8) − …
```

Since 2×3×4 = 6 × 4 and 4×5×6 = 6 × 20, the two forms are the same series. Seeing it in Pascal's triangle is a modern rediscovery that became popular online.

## Why it works

Use the Nilakantha form, where each term is ± 4 ÷ (a × (a+1) × (a+2)) with a = 2, 4, 6, …. Each term splits into simpler fractions:

```
4 ÷ (a × (a+1) × (a+2)) = 2 × (1/a − 2/(a+1) + 1/(a+2))
```

(Put the right side over a common denominator to check.) Split every term this way, keeping its + or − sign, and two things happen inside the brackets:

- The pieces 1/a and 1/(a+2) cancel in pairs from one term to the next, a *telescoping* sum, leaving only 1/2.
- The pieces 2/(a+1) are twice the Leibniz series without its first term: 2 × (1/3 − 1/5 + 1/7 − …) = 2 × (1 − π/4).

Put together, the series adds up to 2 × (1/2 − 2 + π/2) = π − 3. So 3 plus the series is π.

## How fast?

Much faster than Leibniz. After N terms the error is about 1 ÷ (4N³), so ten times more terms gives about **three** more correct digits. That is a straight line with slope −3 on the error plot, three times as steep as Leibniz.

- 10 terms: error about 0.0002
- 100 terms: error about 0.0000002
- around 100,000 terms: error down to the computer's limit of about 10⁻¹⁶

The reason is that the terms shrink like 1/N³ instead of 1/N. Both series are alternating, and an alternating series is only ever off by about half its next term.

## Things to watch

- The estimate zig-zags around π like Leibniz, but the swings collapse very quickly.
- At the bottom right of the error plot, the line hits the floor of the computer's precision and stops improving. The top plot then shows tiny steps: neighbouring numbers the computer can actually store.

> Try this: run Leibniz and then Pascal to 10,000 elements and compare where their error lines end.
