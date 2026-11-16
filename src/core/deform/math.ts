export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Row-major 3x3: element (row r, column c) lives at index 3 * r + c. */
export const identity3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[3 * r + k]! * b[3 * k + c]!;
      o[3 * r + c] = s;
    }
  }
  return o;
}

export function transpose(a: Mat3): Mat3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function det(a: Mat3): number {
  return (
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6])
  );
}

/** Inverse of a 3 by 3 matrix, or null when it is singular. */
export function inverse(a: Mat3): Mat3 | null {
  const d = det(a);
  if (Math.abs(d) < 1e-12) return null;
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
  const k = 1 / d;
  return [
    (a11 * a22 - a12 * a21) * k,
    (a02 * a21 - a01 * a22) * k,
    (a01 * a12 - a02 * a11) * k,
    (a12 * a20 - a10 * a22) * k,
    (a00 * a22 - a02 * a20) * k,
    (a02 * a10 - a00 * a12) * k,
    (a10 * a21 - a11 * a20) * k,
    (a01 * a20 - a00 * a21) * k,
    (a00 * a11 - a01 * a10) * k,
  ];
}

export function apply(a: Mat3, v: Vec3): Vec3 {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

export function outer(a: Vec3, b: Vec3): Mat3 {
  return [
    a[0] * b[0], a[0] * b[1], a[0] * b[2],
    a[1] * b[0], a[1] * b[1], a[1] * b[2],
    a[2] * b[0], a[2] * b[1], a[2] * b[2],
  ];
}

export function addMat(a: Mat3, b: Mat3): Mat3 {
  return a.map((v, i) => v + b[i]!) as Mat3;
}

export function scaleMat(a: Mat3, s: number): Mat3 {
  return a.map((v) => v * s) as Mat3;
}

export function rotationAxisAngle(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Sigma' = J Sigma J^T for a full 3x3 covariance. */
export function transportCovariance(j: Mat3, sigma: Mat3): Mat3 {
  return mul(mul(j, sigma), transpose(j));
}

/** Singular values of a 3x3 matrix, descending, from the eigenvalues of J^T J. */
export function singularValues(a: Mat3): Vec3 {
  const m = mul(transpose(a), a);
  const p1 = m[1] * m[1] + m[2] * m[2] + m[5] * m[5];
  const q = (m[0] + m[4] + m[8]) / 3;
  const p2 = (m[0] - q) ** 2 + (m[4] - q) ** 2 + (m[8] - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  let e: Vec3;
  if (p < 1e-300) {
    e = [q, q, q];
  } else {
    const b = scaleMat(addMat(m, scaleMat(identity3(), -q)), 1 / p);
    const r = Math.min(1, Math.max(-1, det(b) / 2));
    const phi = Math.acos(r) / 3;
    const e1 = q + 2 * p * Math.cos(phi);
    const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
    e = [e1, 3 * q - e1 - e3, e3];
  }
  return [Math.sqrt(Math.max(0, e[0])), Math.sqrt(Math.max(0, e[1])), Math.sqrt(Math.max(0, e[2]))];
}
