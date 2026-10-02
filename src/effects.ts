import * as THREE from "three";
import { waveHeight } from "./config";

const COUNT = 700;

export class Spray {
  readonly points: THREE.Points;
  private readonly life: Float32Array;
  private readonly vel: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private cursor = 0;

  constructor() {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    this.life = new Float32Array(COUNT);
    this.vel = new Float32Array(COUNT * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    this.pos = geo.getAttribute("position") as THREE.BufferAttribute;
    this.lifeAttr = geo.getAttribute("aLife") as THREE.BufferAttribute;
    this.colorAttr = geo.getAttribute("aColor") as THREE.BufferAttribute;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute vec3 aColor;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vLife = aLife;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (16.0 + aLife * 26.0) * (240.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying vec3 vColor;
        void main() {
          if (vLife <= 0.01) discard;
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.05, d) * vLife;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a * 0.72);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  burst(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    n: number,
    spread: number,
    color: THREE.Color,
    life = 0.55,
  ): void {
    for (let i = 0; i < n; i++) this.spawn(
      x + (Math.random() - 0.5) * spread,
      y + Math.random() * spread * 0.4,
      z + (Math.random() - 0.5) * spread,
      vx + (Math.random() - 0.5) * spread * 2,
      vy + Math.random() * 2.2,
      vz + (Math.random() - 0.5) * spread * 2,
      life * (0.6 + Math.random() * 0.6),
      color,
    );
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % COUNT;
    const p = this.pos.array as Float32Array;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    const c = this.colorAttr.array as Float32Array;
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }

  update(dt: number, time: number): void {
    const p = this.pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 6.5 * dt;
      p[i * 3] += this.vel[i * 3] * dt;
      p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const surface = waveHeight(p[i * 3], p[i * 3 + 2], time);
      if (p[i * 3 + 1] < surface) this.life[i] = 0;
    }
    this.pos.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
