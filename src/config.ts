import * as THREE from "three";

/** Playable half-width of the river, in world units. */
export const HALF = 7.7;

export const LAPS = 3;

export const SUN = new THREE.Vector3(-0.78, 0.36, 0.52).normalize();

export const FOG_COLOR = new THREE.Color("#d2c4c6");

export const WAVES = [
  { dx: 0.075, dz: 0.042, speed: 1.05, amp: 0.16 },
  { dx: -0.052, dz: 0.086, speed: 1.42, amp: 0.095 },
  { dx: 0.112, dz: -0.038, speed: 1.9, amp: 0.048 },
  { dx: 0.17, dz: 0.125, speed: 2.55, amp: 0.022 },
] as const;

export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of WAVES) h += Math.sin(x * w.dx + z * w.dz + t * w.speed) * w.amp;
  return h;
}

/** GLSL body. `p` is vec2 world xz, `t` is time. Writes h, ddx, ddz. */
export function waveGlsl(): string {
  return WAVES.map((w, i) => {
    const phase = `p.x * ${w.dx} + p.y * ${w.dz} + t * ${w.speed}`;
    return `
      float c${i} = cos(${phase});
      h += sin(${phase}) * ${w.amp};
      ddx += c${i} * ${w.amp * w.dx};
      ddz += c${i} * ${w.amp * w.dz};`;
  }).join("\n");
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wrapDelta(a: number, b: number, len: number): number {
  let d = a - b;
  d = ((d % len) + len) % len;
  if (d > len / 2) d -= len;
  return d;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function formatTime(t: number): string {
  const clamped = Math.max(0, t);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export function ordinal(n: number): string {
  if (n === 1) return "st";
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return "th";
}
