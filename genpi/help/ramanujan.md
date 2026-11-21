# Ramanujan's series

```
1/π = (2√2 / 9801) × Σ (4k)! (1103 + 26390k) / ((k!)⁴ × 396⁴ᵏ)
                                        for k = 0, 1, 2, …
```

Add up the terms for k = 0, 1, 2, …, multiply by 2√2 ÷ 9801, and you get 1/π. Turn it upside down and you have π.

The notation, briefly:

- **Σ** means "add up the terms for k = 0, 1, 2, … without end".
- **n!** (n factorial) means 1 × 2 × 3 × … × n, so 4! = 24. By convention, 0! = 1.
- **396⁴ᵏ** means 396 multiplied by itself 4k times.

The first term, k = 0, is simply 1103, so the first estimate is 9801 ÷ (2√2 × 1103) = 3.14159273. That is already correct to six decimal places, from a single term.

## History

**Srinivasa Ramanujan** (1887–1920) grew up in southern India and taught himself mathematics, largely from one old textbook of results without proofs. In 1913, working as a clerk in Madras, he wrote to the Cambridge mathematician **G. H. Hardy**, enclosing pages of astonishing formulas. Hardy said some of them "must be true, because, if they were not true, no one would have had the imagination to invent them", and brought him to Cambridge.

In 1914 Ramanujan published *Modular Equations and Approximations to π*, which listed seventeen series for 1/π. This one is the fastest of them. As with many of his results, he gave no proof.

The series sat mostly unused for seventy years. Then:

- **Bill Gosper** (1985) used it to compute over 17 million digits of π, a record at the time, even though nobody had yet proved the formula was right. The digits agreed with other methods, which was strong evidence.
- **Jonathan and Peter Borwein** (1987) finally proved it.
- **David and Gregory Chudnovsky** (1988) found a series of the same kind that adds about 14 digits per term. Record computations of π today, which have passed 100 trillion digits, use theirs (see *Chudnovsky formula* in this help).

Ramanujan died in 1920, aged 32. Mathematicians are still studying the results in his notebooks.

## Why it works

Proving it needs advanced mathematics (modular forms and elliptic integrals), but the strange numbers are not random. They all come from the number **58**. One sign of it:

```
e^(π√58) = 24,591,257,751.99999982…
396⁴     = 24,591,257,856
```

These differ by almost exactly 104. Coincidences like this, where e raised to π times a square root comes out astonishingly close to a whole number, are what Ramanujan's theory explains. Also, 9801 = 99², and 396 = 4 × 99.

You can see why the series is so fast without any of that. Each term is the one before multiplied by

```
(4k−3)(4k−2)(4k−1)(4k) ÷ (k⁴ × 396⁴)
```

(times a small correction from the 1103 + 26390k part). For large k, the top is about (4k)⁴ = 256 k⁴, so the ratio settles near 256 ÷ 396⁴ = 1 ÷ 99⁴, about 1 ÷ 96,000,000. Every term is about 100 million times smaller than the one before, so every term adds about **8 correct digits**.

## How the program computes it

The numbers inside the terms are enormous. For k = 30, 396⁴ᵏ = 396¹²⁰ has 312 digits, and the computer's numbers top out at about 308 digits. Computing the factorials and the powers of 396 directly would fail after a few dozen terms.

The program never computes them. It keeps the factor (4k)! ÷ ((k!)⁴ × 396⁴ᵏ) for the current term and makes the next one from it, using the ratio above. All the numbers stay small.

## How fast?

The fastest method here, by far. With the program's 16-digit arithmetic:

- 1 term: 3.14159273, correct to 6 decimal places (error 0.00000008)
- 2 terms: 3.141592653589794 (error 0.0000000000000009), at the edge of what the computer can hold
- 3 terms: 3.141592653589793, as close as the computer can get

After that the terms are far too small to change anything, and the estimate stops moving. On the error plot, the line drops straight to the floor.

With more precise arithmetic the pattern continues, about 8 more correct decimal places per term:

- 1 term: 6 decimal places
- 2 terms: 15
- 3 terms: 23
- 4 terms: 31
- 5 terms: 39
- 6 terms: 47
- 8 terms: 63

Some terms give a little more or less than 8, but the average holds forever. This Python program shows it, using the `decimal` module for 50-digit arithmetic:

```
from decimal import Decimal, getcontext
getcontext().prec = 50
total, factor = Decimal(0), Decimal(1)
for k in range(6):
    if k:
        top = (4*k-3) * (4*k-2) * (4*k-1) * (4*k)
        factor = factor * top / pow(Decimal(k) * 396, 4)
    total += factor * (1103 + 26390*k)
    print(k + 1, 9801 / (2 * Decimal(2).sqrt() * total))
```

## Things to watch

- Run 5 terms at the slowest speed. The error drops from about 10⁻⁷ to the bottom of the plot in just two steps.
- Compare it with Leibniz. For the error to drop below one millionth, Leibniz needs about a million terms; Ramanujan needs one.
- The estimate approaches π from **above**: every term is positive, so the sum keeps growing and its reciprocal keeps shrinking toward π.

## Watch

- [A short video about Ramanujan (Facebook)](https://www.facebook.com/reel/1730305302147299)
