// Pi approximation algorithms for the browser version.
//
// A line-for-line port of pialgos.py. Each algorithm is a generator that
// yields successive estimates of pi without end: the first value uses 1
// element, the second uses 2, and so on. NaN means "not defined yet".
//
// The arithmetic is written to match the Python version bit for bit
// (tests/check_web.py checks this), so keep the two files in step.

export function* leibniz() {
  // pi = 4 * (1 - 1/3 + 1/5 - 1/7 + ...)
  let total = 0.0;
  let sign = 1.0;
  for (let k = 0; ; k++) {
    total += sign / (2 * k + 1);
    sign = -sign;
    yield 4.0 * total;
  }
}

export function* primes() {
  // 2, 3, 5, 7, ... without end (incremental sieve, as in pialgos.py).
  yield 2; yield 3; yield 5; yield 7;
  const sieve = new Map();          // next composite -> step between its multiples
  const base = primes();            // primes whose multiples we cross off
  base.next();                      // skip 2: we only test odd numbers
  let p = base.next().value;        // 3
  let q = p * p;                    // 9: next square to start crossing off
  for (let c = 9; ; c += 2) {
    let step = sieve.get(c);
    if (step !== undefined) {
      sieve.delete(c);
    } else if (c < q) {
      yield c;
      continue;
    } else {                        // c == q: start crossing off multiples of p
      step = 2 * p;
      p = base.next().value;
      q = p * p;
    }
    let m = c + step;
    while (sieve.has(m)) m += step;
    sieve.set(m, step);
  }
}

export function* euler() {
  // pi = 4 * (3/4 * 5/4 * 7/8 * 11/12 * ...), each prime over its nearest multiple of 4.
  let product = 1.0;
  const ps = primes();
  ps.next();                        // start at 3
  for (const p of ps) {
    product *= p / (p % 4 === 1 ? p - 1 : p + 1);
    yield 4.0 * product;
  }
}

function tetrahedral(m) {
  // C(m, 3) as the nearest double, like Python's exact integer converted to float.
  if (m < 200000) return m * (m - 1) * (m - 2) / 6;    // exact below 2^53
  return Number(BigInt(m) * BigInt(m - 1) * BigInt(m - 2) / 6n);
}

export function* pascal() {
  // pi = 3 + (2/3) * (1/4 - 1/20 + 1/56 - 1/120 + ...), denominators C(2k+2, 3).
  let total = 0.0;
  let sign = 1.0;
  for (let k = 1; ; k++) {
    total += sign / tetrahedral(2 * k + 2);
    sign = -sign;
    yield 3.0 + 2.0 / 3.0 * total;
  }
}

export function* buffon(rng = Math.random) {
  // Buffon's needle: pi ~= 2 * drops / crossings. Needle length = line spacing = 1.
  // The angle comes from a random point in a quarter circle, so pi is never used.
  let drops = 0;
  let crosses = 0;
  for (;;) {
    const centre = 0.5 * rng();      // distance from the needle's centre to the nearest line
    let u, v, r2;
    do {
      u = rng();
      v = rng();
      r2 = u * u + v * v;
    } while (!(0.0 < r2 && r2 <= 1.0));
    const sinAngle = v / Math.sqrt(r2);
    drops += 1;
    if (centre <= 0.5 * sinAngle) crosses += 1;
    yield crosses ? 2.0 * drops / crosses : NaN;
  }
}

export function* archimedes() {
  // Half the perimeter of polygons inside a circle of radius 1: 6, 12, 24, ... sides.
  // s' = s / sqrt(2 + sqrt(4 - s^2)) avoids subtracting nearly equal numbers.
  let side = 1.0;
  let halfPerimeter = 3.0;
  for (;;) {
    yield halfPerimeter;
    const root = Math.sqrt(2.0 + Math.sqrt(4.0 - side * side));
    halfPerimeter *= 2.0 / root;
    side /= root;
  }
}

export function crawlCircle(r) {
  // Walk dividers of span 1 around a circle of radius r; return distance / diameter.
  const cosA = 1.0 - 1.0 / (2.0 * r * r);           // chord of length 1 on radius r
  const sinA = Math.sqrt(1.0 - 1.0 / (4.0 * r * r)) / r;
  let x = r;
  let y = 0.0;
  let steps = 0;
  for (;;) {
    const nx = x * cosA - y * sinA;
    const ny = x * sinA + y * cosA;
    if (y < 0.0 && 0.0 <= ny) break;                // next step would pass the start
    x = nx;
    y = ny;
    steps += 1;
  }
  const dx = x - r;
  const gap = Math.sqrt(dx * dx + y * y);
  return (steps + gap) / (2.0 * r);
}

export function* crawl() {
  for (let r = 1; ; r++) yield crawlCircle(r);
}

export function* ramanujan() {
  // Ramanujan (1914): 1/pi = (2 sqrt 2 / 9801) * sum of (4k)! (1103 + 26390k) / ((k!)^4 396^(4k)).
  // Each term's factorial part is made from the previous one, as in pialgos.py.
  const scale = 9801.0 / (2.0 * Math.sqrt(2.0));
  let factor = 1.0;
  let total = 1103.0;
  let k = 0.0;
  for (;;) {
    yield scale / total;
    k += 1.0;
    factor *= (4.0 * k - 3.0) * (4.0 * k - 2.0) * (4.0 * k - 1.0) * (4.0 * k) /
              (k * k * k * k * 24591257856.0);      // 396^4
    total += factor * (1103.0 + 26390.0 * k);
  }
}

export function* chudnovsky() {
  // Chudnovsky (1988): pi = 426880 sqrt(10005) / sum of
  // (6k)! (13591409 + 545140134k) / ((3k)! (k!)^3 (-640320^3)^k), as in pialgos.py.
  const scale = 426880.0 * Math.sqrt(10005.0);
  let factor = 1.0;
  let total = 13591409.0;
  let k = 0.0;
  for (;;) {
    yield scale / total;
    k += 1.0;
    factor *= (6.0 * k - 5.0) * (6.0 * k - 4.0) * (6.0 * k - 3.0) *
              (6.0 * k - 2.0) * (6.0 * k - 1.0) * (6.0 * k) /
              ((3.0 * k - 2.0) * (3.0 * k - 1.0) * (3.0 * k) * k * k * k *
               -262537412640768000.0);               // -(640320^3)
    total += factor * (13591409.0 + 545140134.0 * k);
  }
}

export const ALGORITHMS = [
  {
    name: "Leibniz series",
    unit: "term",
    formula: "π = 4 · (1 − 1/3 + 1/5 − 1/7 + …)",
    estimates: leibniz,
    helpFile: "leibniz.md",
  },
  {
    name: "Euler prime product",
    unit: "prime",
    formula: "π = 4 · (3/4 · 5/4 · 7/8 · 11/12 · 13/12 · …)   each prime over its nearest multiple of 4",
    estimates: euler,
    helpFile: "euler.md",
  },
  {
    name: "Pascal's triangle",
    unit: "term",
    formula: "π = 3 + (2/3) · (1/4 − 1/20 + 1/56 − 1/120 + …)   " +
             "every other number on the triangle's tetrahedral diagonal",
    estimates: pascal,
    helpFile: "pascal.md",
  },
  {
    name: "Buffon's needle",
    unit: "drop",
    formula: "π ≈ 2 × drops ÷ crossings   random needles, as long as the line spacing, " +
             "dropped on ruled lines",
    estimates: buffon,
    helpFile: "buffon.md",
  },
  {
    name: "Archimedes' polygons",
    unit: "polygon",
    formula: "π ≈ half the perimeter of a polygon inside a circle of radius 1   " +
             "6, 12, 24, 48, … sides, doubling each time",
    estimates: archimedes,
    helpFile: "archimedes.md",
  },
  {
    name: "Circumference crawl",
    unit: "circle",
    formula: "π ≈ distance walked ÷ diameter   dividers of span 1 stepped around " +
             "circles of radius 1, 2, 3, …",
    estimates: crawl,
    helpFile: "crawl.md",
  },
  {
    name: "Ramanujan's series",
    unit: "term",
    formula: "1/π = (2√2/9801) · Σ (4k)! (1103 + 26390k) / ((k!)⁴ · 396⁴ᵏ)   " +
             "k = 0, 1, 2, …   about 8 more correct digits per term",
    estimates: ramanujan,
    helpFile: "ramanujan.md",
  },
  {
    name: "Chudnovsky formula",
    unit: "term",
    formula: "π = 426880√10005 ÷ Σ (6k)! (13591409 + 545140134k) / ((3k)! (k!)³ · (−640320³)ᵏ)   " +
             "about 14 more correct digits per term",
    estimates: chudnovsky,
    helpFile: "chudnovsky.md",
  },
];
