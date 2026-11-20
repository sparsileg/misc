# Archimedes' polygons

```
π ≈ half the perimeter of a regular polygon inside a circle of radius 1
```

A circle's circumference is π times its diameter. A circle of radius 1 has diameter 2, so its circumference is 2π. A polygon drawn inside the circle has a slightly shorter perimeter, and the more sides it has, the closer it hugs the circle.

## History

**Archimedes** of Syracuse used this method around 250 BC in his *Measurement of a Circle*. He drew polygons both inside and outside the circle, so that π was trapped between them, and doubled the sides four times, from 6 to 96. That gave

```
3 10/71 < π < 3 1/7       (3.1408 < π < 3.1429)
```

The upper bound, 22/7, is still a common school approximation. The method was the standard way to compute π for nearly 2,000 years:

- **Liu Hui** (China, 263 AD) went to 3,072 sides and got 3.1416.
- **Zu Chongzhi** (China, about 480 AD) found 355/113, correct to six decimal places.
- **Ludolph van Ceulen** (Netherlands, about 1600) used polygons with 2⁶² sides to get 35 digits, which were engraved on his tombstone.

This program follows only the inside polygons.

## Why it works

Start with a hexagon. Its six sides are each exactly as long as the radius, so with radius 1 the perimeter is 6 and the estimate is 6 ÷ 2 = 3.

To double the sides, put a new corner on the circle halfway between each pair of old corners. Pythagoras' theorem then gives the new side length s′ from the old one, s:

```
s′² = 2 − √(4 − s²)
```

Only square roots are needed, which Archimedes could work out by hand (laboriously).

- 1 polygon, 6 sides: 3.000000
- 2 polygons, 12 sides: 3.105829
- 3 polygons, 24 sides: 3.132629
- 4 polygons, 48 sides: 3.139350
- 5 polygons, 96 sides: 3.141032 (Archimedes' lower bound)

## A lesson in computer arithmetic

The formula above is correct but works badly on a computer. When the polygon has many sides, s is tiny, √(4 − s²) is extremely close to 2, and subtracting two nearly equal numbers throws away most of the digits. This is called *catastrophic cancellation*. Computed this way, the estimate stops improving at about 13 polygons (error 0.00000001), gets *worse* from about 17, and by 29 polygons it claims π is 0.

The program uses the same formula rearranged so that nothing nearly equal is subtracted:

```
s′ = s ÷ √(2 + √(4 − s²))
```

Algebraically the two forms are identical. Numerically, the second keeps every digit.

## How fast?

Very fast. Each doubling makes the error about **4 times** smaller (the error for n sides is about π³ ÷ 6n²). After 10 polygons, 3,072 sides, the error is about 0.0000005. After about 26 polygons it reaches the limit of the computer's precision and stops changing.

Because the number of sides doubles at each step, the error falls by a fixed factor per step. On the error plot, whose horizontal axis is logarithmic, that appears as a curve plunging ever more steeply.

## Things to watch

- The estimate always stays **below** π: an inscribed polygon is always shorter than the circle.
- Run 30 polygons at the slowest speed and watch each one gain about 0.6 of a digit.
