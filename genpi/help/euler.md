# Euler prime product

```
π = 4 × (3/4 × 5/4 × 7/8 × 11/12 × 13/12 × 17/16 × 19/20 × …)
```

Take the primes from 3 onward. Divide each one by the multiple of 4 nearest to it, multiply all the fractions together, and multiply by 4.

- If a prime is 1 more than a multiple of 4 (5, 13, 17, 29, …), its fraction is p ÷ (p − 1), a little **more** than 1.
- If a prime is 1 less than a multiple of 4 (3, 7, 11, 19, …), its fraction is p ÷ (p + 1), a little **less** than 1.

## History

Leonhard **Euler** found this in 1737, in the same work where he showed that the sum of the reciprocals of the primes grows without limit. It was one of the first times anyone connected the primes, which seem to have nothing to do with circles, to π.

## Why it works

It is the Leibniz series in disguise. Write the Leibniz series with a sign for every odd number n: + when n is 1 more than a multiple of 4, − when it is 1 less.

```
π/4 = 1 − 1/3 + 1/5 − 1/7 + 1/9 − 1/11 + …
```

The signs have a useful property: the sign of a product is the product of the signs. (3 is −, 5 is +, so 15 is −; 3 × 3 = 9 is +.)

Now look at one prime's factor written as a series. For p = 3:

```
3/4 = 1 ÷ (1 + 1/3) = 1 − 1/3 + 1/9 − 1/27 + …
```

and for p = 5:

```
5/4 = 1 ÷ (1 − 1/5) = 1 + 1/5 + 1/25 + 1/125 + …
```

Multiply the series for every prime together. Each term of the result is a choice of one power from each prime, so each odd number appears **exactly once**: that is unique factorisation, the fact that every number breaks into primes in only one way. The signs come out right too, because of the property above. The product of all the factors is the whole Leibniz series, π/4.

The same idea, using every prime and no signs, is Euler's famous product for the zeta function, which underlies much of modern number theory.

## How fast?

Slowly and irregularly. After a million primes the error is still about 0.00002. Worse, using more primes does not always help: 78,497 primes give an error of about 0.000007, but 1,000,000 primes give 0.00002.

The wobble comes from the race between the two kinds of prime. Every "1 more" prime pushes the product up and every "1 less" prime pulls it down, and the two kinds take turns being ahead in a way that has no simple pattern. Their uneven race has been studied since 1853, when Pafnuty **Chebyshev** noticed that primes 1 less than a multiple of 4 usually hold a slight lead. It is known as Chebyshev's bias.

There is a further subtlety: the product only works if the primes are taken **in order**. Shuffle them and the product can be made to settle on a different number. Mathematicians call this *conditional convergence*.

## Things to watch

- Unlike the other series, the error plot is jagged, with deep spikes where the estimate happens to cross π.
- The top plot drifts in slow waves rather than zig-zagging.
- At the slowest speed, the first estimates are 3, 3.75, 3.28, 3.01: the "more" and "less" primes taking turns.

> Try this: run 100,000 primes at full speed with Auto-zoom on, then turn Auto-zoom off to see how wild the early part was.
