# Leibniz series

```
π = 4 × (1 − 1/3 + 1/5 − 1/7 + 1/9 − …)
```

Add and subtract the reciprocals of the odd numbers, forever, and multiply by 4.

## History

The series was found by **Madhava of Sangamagrama**, in Kerala, India, around 1400, more than 250 years before European mathematicians found it again. James **Gregory** in Scotland had the more general form in 1671, and Gottfried Wilhelm **Leibniz** published it in 1682. It is also called the Madhava–Leibniz series.

## Why it works

Start with a fact about dividing: for any t between −1 and 1,

```
1 ÷ (1 + t²) = 1 − t² + t⁴ − t⁶ + …
```

(Multiply the right side by 1 + t² and everything cancels except the 1.)

The area under the curve 1 ÷ (1 + t²) from 0 to x is the angle whose tangent is x, written arctan x. Finding the area term by term gives Gregory's series:

```
arctan x = x − x³/3 + x⁵/5 − x⁷/7 + …
```

An angle of 45° has tangent 1, and 45° is a quarter of 180°, which is π/4 in radians. Put x = 1 and the powers all become 1:

```
π/4 = 1 − 1/3 + 1/5 − 1/7 + …
```

## A worked start

- 1 term: 4 × 1 = 4
- 2 terms: 4 × (1 − 1/3) = 2.667
- 3 terms: 4 × (1 − 1/3 + 1/5) = 3.467
- 4 terms: 4 × (1 − 1/3 + 1/5 − 1/7) = 2.895

Each new term overshoots π in the opposite direction, but by less each time.

## How fast?

Slowly. After N terms the error is about 1 ÷ N, so each extra correct digit costs ten times as many terms. On the error plot that is a straight line with slope −1.

In an alternating series like this one, whose terms keep shrinking toward zero, the true value always lies between two consecutive estimates. That is the zig-zag around π in the top plot.

## A surprise in the digits

With 1,000,000 terms the program prints

```
3.141591653589774   estimate
3.141592653589793   π
```

Only one digit near the front is wrong, and many digits after it are correct again. The error is almost exactly 1 ÷ N = 0.000001, so the estimate is π with 1 knocked off the 6th decimal place. The brothers Jonathan and Peter **Borwein** explained this pattern in detail in the 1980s.

The readout shows 5 correct decimal places, because it stops counting at the first wrong digit. This is a good example of how "correct digits" can understate an estimate.

> Try this: run 1,000,000 terms at full speed and compare the red digits with π. Then try 500,000.

## Things to watch

- At the slowest speed, the first few estimates swing wildly: 4, 2.67, 3.47, 2.90.
- With Auto-zoom on, the swings shrink but never stop.
- The error line is one of the straightest you will see.
