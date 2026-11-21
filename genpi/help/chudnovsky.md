# Chudnovsky formula

```
          426880 √10005
π = ─────────────────────────────────────────────────
     Σ (6k)! (13591409 + 545140134k) ÷ ((3k)! (k!)³ (−640320³)ᵏ)

                                        for k = 0, 1, 2, …
```

Add up the terms below the line for k = 0, 1, 2, …, then divide 426880 × √10005 by the total. (Σ means "add up the terms", and n! means 1 × 2 × 3 × … × n, with 0! = 1.)

The first term, k = 0, is simply 13591409, so the first estimate is 426880 × √10005 ÷ 13591409 = 3.14159265358973. That is correct to 13 decimal places, from a single term.

This is the formula behind every record computation of π since 2009.

## History

**David** (born 1947) and **Gregory Chudnovsky** (born 1952) are brothers from Kyiv who moved to the United States in the late 1970s. In 1988 they published this formula, a descendant of Ramanujan's series (see *Ramanujan's series* in this help), built on the same theory but with much bigger numbers.

In 1989 they used it to compute more than a billion digits of π, a world record. They then built their own supercomputer from mail-order parts in Gregory's Manhattan apartment. The machine, the brothers and their apartment full of cables were described in Richard Preston's 1992 *New Yorker* article "The Mountains of Pi".

Since 2009, every record has used their formula, most of them through **y-cruncher**, a program by Alexander Yee:

- 2019: 31.4 trillion digits (Emma Haruka Iwao, Google Cloud)
- 2022: 100 trillion digits (Iwao again)
- 2024: over 200 trillion digits

Those runs take months, and most of the time goes into multiplying numbers with trillions of digits. The formula itself needs only about 7 trillion terms for 100 trillion digits.

## Why it works

Like Ramanujan's series, the proof needs advanced mathematics (modular forms). And like Ramanujan's, the strange numbers come from one special number, here **163**:

```
e^(π√163) = 262,537,412,640,768,743.99999999999925…
640320³   = 262,537,412,640,768,000
```

The difference is 743.99999999999925…, which is within a trillionth of the whole number 744. In April 1975 Martin Gardner joked in *Scientific American* that e^(π√163) had been proved to be exactly a whole number. It isn't, but it is astonishingly close.

163 is special: it is the largest of nine numbers (1, 2, 3, 7, 11, 19, 43, 67, 163) that have a particular property in number theory. Series of this family built on larger numbers converge faster, and 163 is the largest of its kind, which is why this series beats Ramanujan's, built on 58.

The other numbers follow from 640320. For example, 640320 = 64 × 10005, which is where √10005 comes from.

## How fast?

Each term is the one before multiplied by

```
(6k−5)(6k−4)(6k−3)(6k−2)(6k−1)(6k) ÷ ((3k−2)(3k−1)(3k) × k³ × (−640320³))
```

(times a small correction from the 13591409 + 545140134k part). For large k that settles near −1728 ÷ 640320³, about −1 ÷ 150,000,000,000,000. So every term is about 150 trillion times smaller than the one before, and adds about **14 correct digits**. That is almost twice Ramanujan's 8.

The minus sign means the terms alternate between adding and subtracting, so the estimates alternate between slightly below π and slightly above it.

With the program's 16-digit arithmetic:

- 1 term: 3.141592653589734 (error 0.00000000000006)
- 2 terms: 3.141592653589793, as close as the computer can get

With more precise arithmetic, the correct decimal places go:

- 1 term: 13 (below π)
- 2 terms: 27 (above)
- 3 terms: 41 (below)
- 4 terms: 55 (above)
- 5 terms: 69 (below)
- 6 terms: 84 (above)
- 7 terms: 98 (below)

The program computes each term's factor from the one before, as it does for Ramanujan's series, so the enormous factorials and powers are never needed. This Python program does the same with 110-digit arithmetic, so you can see the digits beyond 16:

```
from decimal import Decimal, getcontext
from math import prod
getcontext().prec = 110
C3 = pow(640320, 3)
total, factor = Decimal(0), Decimal(1)
for k in range(7):
    if k:
        top = prod(range(6*k-5, 6*k+1))
        bottom = prod(range(3*k-2, 3*k+1)) * pow(k, 3) * -C3
        factor = factor * top / bottom
    total += factor * (13591409 + 545140134*k)
    print(k + 1, 426880 * Decimal(10005).sqrt() / total)
```

## Things to watch

- Run 3 terms at the slowest speed. The error is already 0.00000000000006 after the first term, the smallest first step of any method here, and on the second it hits the floor.
- Compare it with Ramanujan's series. Both reach the floor in a step or two; the difference only shows with more digits than the computer holds: 14 per term against 8.
- Compare it with Leibniz, which needs about 17,000,000,000,000 terms for the accuracy Chudnovsky gets from one.
