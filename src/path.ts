import * as THREE from "three";

export interface Frame {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Closed river centerline. Samples stay far enough apart that a ~16-wide channel never crosses itself. */
export function riverPoint(t: number): THREE.Vector3 {
  const radius = 92 + Math.sin(t * 2) * 20 + Math.sin(t * 3 + 0.8) * 9;
  const x = Math.cos(t) * radius * 1.36 + Math.cos(t * 2) * 12;
  const z = Math.sin(t) * radius + Math.sin(t * 3) * 7;
  return new THREE.Vector3(x, 0, z);
}

export class RiverPath {
  readonly samples: THREE.Vector3[];
  readonly tangents: THREE.Vector3[];
  readonly cumulative: Float64Array;
  readonly length: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(sampleCount = 720) {
    this.samples = [];
    for (let i = 0; i < sampleCount; i++) {
      this.samples.push(riverPoint((i / sampleCount) * Math.PI * 2));
    }
    const n = sampleCount;
    this.tangents = [];
    this.cumulative = new Float64Array(n);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const prev = this.samples[(i - 1 + n) % n];
      const next = this.samples[(i + 1) % n];
      const tangent = new THREE.Vector3().subVectors(next, prev);
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
      else tangent.normalize();
      this.tangents.push(tangent);
      const p = this.samples[i];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    let length = 0;
    for (let i = 1; i < n; i++) {
      length += this.samples[i].distanceTo(this.samples[i - 1]);
      this.cumulative[i] = length;
    }
    length += this.samples[0].distanceTo(this.samples[n - 1]);
    this.length = length;
    const pad = 28;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }

  frameAt(distance: number, out: Frame): void {
    const len = this.length;
    const n = this.samples.length;
    let d = distance % len;
    if (d < 0) d += len;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.cumulative[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const j = (i + 1) % n;
    const start = this.cumulative[i];
    const end = j === 0 ? len : this.cumulative[j];
    const t = end > start ? (d - start) / (end - start) : 0;
    out.point.lerpVectors(this.samples[i], this.samples[j], t);
    out.tangent.lerpVectors(this.tangents[i], this.tangents[j], t);
    if (out.tangent.lengthSq() < 1e-8) out.tangent.copy(this.tangents[i]);
    else out.tangent.normalize();
    out.right.crossVectors(UP, out.tangent);
    if (out.right.lengthSq() < 1e-8) out.right.set(1, 0, 0);
    else out.right.normalize();
  }
}
