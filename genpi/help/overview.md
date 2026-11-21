# Reading the plots

Every algorithm here builds up an estimate of π one **element** at a time: a term of a series, a prime, a needle drop, a polygon or a circle. The more elements, the closer the estimate should get. How *fast* it gets closer, and *how* it gets there, is what makes each method interesting.

## The two plots

**Estimate vs. π** (top) shows each estimate against the dashed π line. The horizontal axis is the number of elements used. With *Auto-zoom* on, the vertical scale keeps narrowing to the most recent three quarters of the run, so you can still see the movement once the estimate is very close. Turn Auto-zoom off to see the whole journey at one scale.

When there are too many elements to draw one by one, each column of pixels shows the lowest and highest estimate inside it. That is why fast-swinging series look like a solid band.

**Error** (bottom) shows how far each estimate is from π, |estimate − π|, with *both* axes on logarithmic scales: each gridline is ten times bigger or smaller than the next. On these scales a method whose error follows a power law, error ≈ C ÷ Nᵏ, draws a **straight line with slope −k**. Reading the slope tells you the method's speed:

- slope −1 (Leibniz): ten times more terms, one more correct digit
- slope −2 (circumference crawl): ten times more, two more digits
- slope −3 (Pascal's triangle): ten times more, three more digits
- slope −½ on average (Buffon's needle): a *hundred* times more drops for one more digit
- a curve that bends ever more steeply downward (Archimedes): each step multiplies the accuracy, which is faster than any power law
- a straight drop to the floor (Ramanujan's series, Chudnovsky formula): each term adds about 8 or 14 digits, so 2 terms use up all the computer's precision

## The readout

The estimate is printed with its correct digits in **green** and the rest in **red**, above the true value of π for comparison. *Correct decimal places* counts the green digits after the "3.".

Correct digits and size of error are not quite the same thing. An estimate of 3.1415999 is wrong in the 5th decimal place even though its error is only 0.0000072. The error plot is the more honest measure.

## The floor at about 10⁻¹⁶

The computer stores numbers with about 16 significant digits. Once an estimate gets within about 0.0000000000000004 of π, it cannot get any closer: the error line flattens out or jitters at the bottom of the plot. This is a limit of the arithmetic, not of the method. Pascal's triangle, Archimedes' polygons, Ramanujan's series and the Chudnovsky formula all reach it.

## How many elements for an error below one millionth?

- Leibniz series: about 1,000,000 terms
- Euler prime product: no simple rule; it wanders. Ten million primes still leave an error of about 0.000006.
- Pascal's triangle: about 62 terms
- Buffon's needle: about 5,600,000,000,000 drops, on average
- Archimedes' polygons: 10 polygons (the last has 3,072 sides)
- Circumference crawl: a circle of radius about 362
- Ramanujan's series: 1 term
- Chudnovsky formula: 1 term (its first estimate is already within 0.00000000000006)

Speed per element is not the whole story: a crawl around a circle of radius 362 takes about 2,300 steps, while a Leibniz term is a single division.

## Things to try

- Set the dial to its slowest and run any method with 30 elements. Watch each new estimate arrive.
- Run Leibniz, then Pascal, to 10,000 and compare the slopes of the error lines.
- Run Buffon's needle several times with the same settings. Every run is different.
- Turn Auto-zoom off and on during a run of the Euler product.

Press **F1** at any time to open this help at the algorithm that is currently selected.
