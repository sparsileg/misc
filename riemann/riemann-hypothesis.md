# The Riemann Hypothesis, simply

## 1. The question

A prime number can only be divided evenly by 1 and itself: 2, 3, 5, 7, 11,
13, 17, … Up close they look random. The gaps between them jump around (2 to
3 is a gap of 1, 23 to 29 is a gap of 6) and nobody can predict exactly where
the next one will be.

Zoom out, though, and they thin out at a very steady rate:

- Near 100, about 1 in 5 numbers is prime.
- Near a million, about 1 in 14.
- Near a billion, about 1 in 21.

The rate follows a simple rule: near a number N, about 1 in ln(N) numbers is
prime. ln is the natural logarithm. You don't need its definition, only this:
it grows by about 2.3 every time N gets ten times bigger. That's why the
"1 in …" number above creeps up slowly.

Add up those chances from 2 to N and you get a **smooth estimate** of how many
primes there are up to N. It's remarkably good:

| Up to N    | Actual primes | Smooth estimate | Miss |
|------------|---------------|-----------------|------|
| 10,000     | 1,229         | 1,246           | 17   |
| 1,000,000  | 78,498        | 78,628          | 130  |
| 10,000,000 | 664,579       | 664,918         | 339  |

The Riemann Hypothesis is about the last column. **How big can the miss
get?** Does it stay small compared with N forever, or does it sometimes
blow up?

## 2. A function built from the primes

In 1859 Bernhard Riemann studied the *zeta function*. It's an infinite sum
over every whole number. Here is one example:

> 1 + 1/2² + 1/3² + 1/4² + 1/5² + … ≈ 1.645

In the 1700s, Euler had found that the same number comes out of a product
that uses **only the primes**:

> 1/(1 − 1/2²) × 1/(1 − 1/3²) × 1/(1 − 1/5²) × 1/(1 − 1/7²) × … ≈ 1.645

Multiply the first few factors and you get 1.333, then 1.500, 1.563, 1.595,
1.608, creeping up to 1.645. The two agree because every whole number is
built from primes in exactly one way. For example, 12 = 2 × 2 × 3, and no
other primes multiply to 12. Expanding the product produces every whole
number exactly once.

So zeta can be built entirely out of the primes, and anything we learn about
zeta tells us something about the primes.

The little 2 in the powers can be swapped for other numbers, and each choice
gives a different total. Riemann's step was to let that input be any point on
a flat plane, not just an ordinary number. A point on the plane has a
**left–right position** and a **height**. (Mathematicians call these points
*complex numbers*.) He then asked: at which points does zeta come out to
exactly zero? Those points are the **zeros**.

Apart from some easy, well-understood ones, all the zeros lie in a narrow
vertical band between left–right positions 0 and 1. There are infinitely
many of them, going up the band forever.

## 3. Each zero makes a wave

Go back to the miss: the true count minus the smooth estimate. Plot it and
you get a jagged line that wanders up and down. Sometimes there are a few
more primes than the estimate predicts, sometimes a few fewer.

Riemann proved that this jagged line is *exactly* the sum of smooth
up-and-down curves, one for each zero. Each curve is a **wave**. It swings
above zero (count a bit higher here), then below (a bit lower there), over
and over.

It works like sound. A chord sounds complicated but is just a few pure tones
added together. Here the complicated sound is the pattern of the primes, and
the pure tones are the waves from the zeros.

- **One wave on its own** is gentle and smooth. It doesn't look anything like
  the primes.
- **Many waves added together** reinforce each other in some places and
  cancel in others. Together they form a sharp step exactly at each prime and
  flat stretches in between.

A zero's position on the plane sets the shape of its wave:

- **Its height sets how fast the wave wiggles.** Zeros higher up make
  faster-wiggling waves, like higher notes.
- **Its left–right position sets how big the swings grow** as N gets larger.
  This is the part that matters for the miss.

## 4. How big the waves get

A zero at left–right position β makes a wave whose swings grow roughly like
N^β (N raised to the power β):

| Zero's left–right position | Swings grow like | Scale near a million | Near 10¹² |
|----------------------------|------------------|----------------------|-----------|
| ½                          | √N               | about 1,000          | about 1,000,000 |
| 0.75                       | N^0.75           | about 32,000         | about 1,000,000,000 |

These are rough scales (the real miss at a million is only 130). What matters
is how fast they grow. A wave from a zero at ½ grows much more slowly than
one from a zero further right.

Can a zero sit to the left of ½ and make an even smaller wave? No. The zeros
come in mirror-image pairs: a zero at 0.3 always has a partner at 0.7, at the
same height. Of each pair, the one further right sets the size, and that one
is always at ½ or more. So **½ is the smallest possible**, and it happens only
when both zeros of a pair sit exactly at ½.

## 5. The hypothesis

**The Riemann Hypothesis: every one of these zeros sits exactly at
left–right position ½.**

If it's true, every wave stays as small as it can. The primes never stray
from the smooth estimate by much more than about √N.

A comparison makes this concrete. Flip a fair coin a million times and count
heads minus tails. You won't get exactly zero; you'll typically be off by
about 1,000, which is √(1,000,000). That's the natural amount of wobble in
something random. The Riemann Hypothesis says the primes wobble around their
estimate no more than fair coin flips would: as predictable as anything that
looks random can be.

If even one zero is off the line, its wave eventually outgrows all the
others. Far enough out, the primes would bunch up and thin out much more
than coin flips would.

## 6. Why checking isn't enough

More than 12 trillion zeros have been computed, and every one is at ½. That
still isn't a proof, because there are infinitely many zeros, and patterns
in the primes can hold for an astonishingly long time and then break.

The table in section 1 shows an example. The smooth estimate is always a
little *too high*, at every N anyone has ever checked. Yet in 1914 Littlewood
proved that it eventually becomes too low, and the first place this happens
is thought to be near 10³¹⁶. That's a number with more than 300 digits, far
beyond anything a computer can count to.

## 7. Where it stands

- It's still unproven, more than 165 years after Riemann proposed it.
- It's one of the Clay Millennium Prize Problems, with a $1 million prize.
- Many published theorems begin "Assuming the Riemann Hypothesis…". A proof
  would confirm all of them at once.
- A proof would *not* break internet encryption. That security depends on
  how hard it is to split big numbers into their primes, which is a
  different problem.

## 8. See it

Run `python3 riemann-gui.py` in this folder:

- **Tab 1** shows the zeros lined up at ½.
- **Tab 2** adds their waves one at a time until they rebuild the exact
  prime count.
- **Tab 3** shows the miss growing like √N, below the limit the hypothesis
  sets.
