import * as THREE from "three";
import { waveHeight } from "./config";
import { historyAt, type Boat } from "./boats";
import type { Hazard } from "./course";

export class WakeField {
  readonly texture: THREE.CanvasTexture;
  readonly origin = new THREE.Vector2();
  readonly inv = new THREE.Vector2();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly brush: HTMLCanvasElement;
  private readonly width: number;
  private readonly height: number;
  private readonly sizeX: number;
  private readonly sizeZ: number;

  constructor(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.width = 512;
    this.height = 512;
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("wake canvas");
    this.ctx = ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width, this.height);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.origin.set(bounds.minX, bounds.minZ);
    this.sizeX = bounds.maxX - bounds.minX;
    this.sizeZ = bounds.maxZ - bounds.minZ;
    this.inv.set(1 / this.sizeX, 1 / this.sizeZ);

    this.brush = document.createElement("canvas");
    this.brush.width = 64;
    this.brush.height = 64;
    const b = this.brush.getContext("2d");
    if (!b) throw new Error("brush");
    const g = b.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    b.fillStyle = g;
    b.fillRect(0, 0, 64, 64);
  }

  update(dt: number, boats: Boat[], hazards: Hazard[]): void {
    const ctx = this.ctx;
    const keep = Math.exp(-0.28 * dt);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1 - keep;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    for (const boat of boats) {
      const speed = Math.max(0, boat.speed);
      const strength = Math.min(1, 0.35 + speed / 28);
      const sternX = boat.pos.x - boat.forward.x * 1.25;
      const sternZ = boat.pos.z - boat.forward.z * 1.25;
      this.stamp(sternX, sternZ, 9 + speed * 0.18, 0.7 * strength);
      const side = 0.7 + speed * 0.03;
      this.stamp(sternX + boat.right.x * side, sternZ + boat.right.z * side, 7, 0.45 * strength);
      this.stamp(sternX - boat.right.x * side, sternZ - boat.right.z * side, 7, 0.45 * strength);
      const count = boat.histCount;
      const step = count > 24 ? 2 : 1;
      for (let age = 0; age < count; age += step) {
        const sample = historyAt(boat, age);
        if (!sample) continue;
        const spread = 0.35 + age * 0.16;
        const alpha = 0.42 * strength * (1 - age / Math.max(1, count));
        this.stamp(sample.x + sample.rx * spread, sample.z + sample.rz * spread, 6.5, alpha);
        this.stamp(sample.x - sample.rx * spread, sample.z - sample.rz * spread, 6.5, alpha);
        if (age % 4 === 0) this.stamp(sample.x, sample.z, 5, alpha * 0.8);
      }
      if (boat.boostTime > 0) this.stamp(sternX, sternZ, 16, 0.75);
    }
    for (const hazard of hazards) {
      this.stamp(hazard.mesh.position.x, hazard.mesh.position.z, 10 + hazard.radius * 4, 0.22);
    }
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  private stamp(x: number, z: number, radius: number, alpha: number): void {
    const px = ((x - this.origin.x) / this.sizeX) * this.width;
    const py = (1 - (z - this.origin.y) / this.sizeZ) * this.height;
    const pr = (radius / this.sizeX) * this.width;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.brush, px - pr, py - pr, pr * 2, pr * 2);
  }
}

export class WakeRibbon {
  readonly mesh: THREE.Mesh;
  private readonly positions: THREE.BufferAttribute;
  private readonly fades: THREE.BufferAttribute;
  private readonly strength: { value: number };

  constructor() {
    const SEG = 36;
    const positions = new Float32Array(SEG * 2 * 3);
    const uvs = new Float32Array(SEG * 2 * 2);
    const fades = new Float32Array(SEG * 2);
    const indices: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const k = i / (SEG - 1);
      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = k;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = k;
      if (i < SEG - 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("aFade", new THREE.BufferAttribute(fades, 1));
    geo.setIndex(indices);
    this.positions = geo.getAttribute("position") as THREE.BufferAttribute;
    this.fades = geo.getAttribute("aFade") as THREE.BufferAttribute;
    this.strength = { value: 1 };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uStrength: this.strength },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        varying vec2 vUv;
        void main() {
          vFade = aFade;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        varying float vFade;
        varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          float core = smoothstep(0.5, 0.12, abs(vUv.x - 0.5));
          float streak = 0.6 + 0.4 * sin(vUv.y * 46.0 - uTime * 8.0 + vUv.x * 10.0);
          float a = vFade * edge * streak * uStrength;
          vec3 col = mix(vec3(0.72, 0.92, 1.0), vec3(1.0), core);
          gl_FragColor = vec4(col, a * 0.92);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  update(boat: Boat, time: number): void {
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = time;
    const SEG = 36;
    const count = boat.histCount;
    if (count < 2 || boat.speed < 1) {
      this.strength.value = 0;
      return;
    }
    this.strength.value = Math.min(1, boat.speed / 18) * (boat.boostTime > 0 ? 1.25 : 1);
    const arr = this.positions.array as Float32Array;
    const fade = this.fades.array as Float32Array;
    for (let i = 0; i < SEG; i++) {
      const k = i / (SEG - 1);
      const ageIndex = Math.min(count - 1, Math.floor((1 - k) * (count - 1)));
      const sample = historyAt(boat, ageIndex);
      if (!sample) continue;
      const width = 0.45 + (1 - k) * 3.6;
      const y = waveHeight(sample.x, sample.z, time) + 0.22;
      const lx = sample.x - sample.rx * width;
      const lz = sample.z - sample.rz * width;
      const rx = sample.x + sample.rx * width;
      const rz = sample.z + sample.rz * width;
      const o = i * 6;
      arr[o] = lx;
      arr[o + 1] = y;
      arr[o + 2] = lz;
      arr[o + 3] = rx;
      arr[o + 4] = y;
      arr[o + 5] = rz;
      const f = Math.pow(Math.max(k, 0.001), 0.35);
      fade[i * 2] = f;
      fade[i * 2 + 1] = f;
    }
    this.positions.needsUpdate = true;
    this.fades.needsUpdate = true;
  }
}
