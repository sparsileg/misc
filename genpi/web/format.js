// Number formatting that matches the Python version's f-strings exactly.
//
// JavaScript's toFixed/toExponential round exact halfway cases up, Python
// rounds them to even (2.625 -> "2.63" vs "2.62"), so rounding is done here
// on the double's exact decimal value instead.

// The exact value of a finite double x >= 0, as an integer over 10^scale.
function exact(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  let e = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  if (e === 0) e = 1; else m |= 1n << 52n;
  e -= 1075;                                  // x = m * 2^e
  if (e >= 0) return { int: m << BigInt(e), scale: 0 };
  return { int: m * 5n ** BigInt(-e), scale: -e };   // m / 2^k = m * 5^k / 10^k
}

// x rounded half-to-even to `places` decimal places, as an integer over 10^places.
function roundTo(x, places) {
  const { int, scale } = exact(x);
  const shift = scale - places;
  if (shift <= 0) return int * 10n ** BigInt(-shift);
  const unit = 10n ** BigInt(shift);
  let q = int / unit;
  const r = int % unit;
  if (2n * r > unit || (2n * r === unit && q % 2n === 1n)) q += 1n;
  return q;
}

function placeDot(digits, places) {
  if (places <= 0) return digits;
  digits = digits.padStart(places + 1, "0");
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

// Python's f"{x:.{places}f}"
export function fmtF(x, places) {
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  return sign + placeDot(roundTo(Math.abs(x), places).toString(), places);
}

// Mantissa digits and exponent of x rounded to `digits` + 1 significant digits.
function significant(x, digits) {
  if (x === 0) return { mant: "0".repeat(digits + 1), exp: 0 };
  let exp = Math.floor(Math.log10(x));
  for (;;) {
    const q = roundTo(x, digits - exp).toString();
    if (q.length === digits + 2) exp += 1;       // rounded up to the next power of 10
    else if (q.length === digits) exp -= 1;      // log10 overestimated
    else return { mant: q, exp };
  }
}

// Python's f"{x:.{digits}e}", e.g. 1.234e-05.
export function fmtE(x, digits) {
  const sign = x < 0 ? "-" : "";
  const { mant, exp } = significant(Math.abs(x), digits);
  const m = digits > 0 ? `${mant[0]}.${mant.slice(1)}` : mant;
  return `${sign}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

// Python's f"{x:.3g}" for x >= 0.
export function fmtG3(x) {
  const { exp } = significant(x, 2);
  if (exp < -4 || exp >= 3) {
    const [mant, e] = fmtE(x, 2).split("e");
    return `${stripZeros(mant)}e${e}`;
  }
  return stripZeros(fmtF(x, 2 - exp));
}

function stripZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

// 12,345
export function fmtCount(n) {
  return n.toLocaleString("en-US");
}

// Compact axis label: 950, 1.2k, 25k, 3.5M, 10B.
export function fmtShort(n) {
  for (const [size, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "k"]]) {
    if (n >= size) return fmtG3(n / size) + suffix;
  }
  return fmtG3(n);
}

// Speed shown under the dial (Python's round() also rounds halves to even).
export function fmtRate(r) {
  if (r < 10) return fmtF(r, 1);
  return fmtCount(Number(roundTo(r, 0)));
}
