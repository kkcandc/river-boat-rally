import * as THREE from "three";
import { FOG_COLOR, HALF, SUN, waveGlsl } from "./config";
import type { RiverPath } from "./path";

const WAVE_FN = /* glsl */ `
void ocean(vec2 p, float t, out float h, out float ddx, out float ddz) {
  h = 0.0;
  ddx = 0.0;
  ddz = 0.0;
  ${waveGlsl()}
}
`;

export class RiverWater {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly mirror: THREE.PerspectiveCamera;
  private readonly textureMatrix = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly mirrorPos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private planeY = 0.0;

  constructor(path: RiverPath) {
    const geo = buildRiverGeometry(path);
    this.target = new THREE.WebGLRenderTarget(512, 256, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.mirror = new THREE.PerspectiveCamera(60, 1, 0.4, 600);
    this.material = new THREE.ShaderMaterial({
      transparent: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: SUN.clone() },
        uFogColor: { value: FOG_COLOR.clone() },
        uWake: { value: new THREE.Texture() },
        uWakeOrigin: { value: new THREE.Vector2() },
        uWakeInv: { value: new THREE.Vector2(1, 1) },
        uReflect: { value: this.target.texture },
        uReflectMatrix: { value: this.textureMatrix },
      },
      vertexShader: /* glsl */ `
        ${WAVE_FN}
        uniform float uTime;
        uniform sampler2D uWake;
        uniform vec2 uWakeOrigin;
        uniform vec2 uWakeInv;
        attribute vec2 flow;
        varying vec3 vWorld;
        varying float vBank;
        varying float vAlong;
        varying vec2 vWakeUv;
        varying vec2 vFlow;
        void main() {
          vec3 p3 = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 p = p3.xz;
          float h, ddx, ddz;
          ocean(p, uTime, h, ddx, ddz);
          vec2 wuv = (p - uWakeOrigin) * uWakeInv;
          float wake = texture2D(uWake, wuv).r;
          p3.y += h + wake * 0.16;
          vWorld = p3;
          vBank = uv.x;
          vAlong = uv.y;
          vWakeUv = wuv;
          vFlow = flow;
          gl_Position = projectionMatrix * viewMatrix * vec4(p3, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${WAVE_FN}
        uniform float uTime;
        uniform vec3 uSun;
        uniform vec3 uFogColor;
        uniform sampler2D uWake;
        uniform vec2 uWakeInv;
        uniform sampler2D uReflect;
        uniform mat4 uReflectMatrix;
        varying vec3 vWorld;
        varying float vBank;
        varying float vAlong;
        varying vec2 vWakeUv;
        varying vec2 vFlow;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        vec3 skyColor(vec3 dir) {
          float h = dir.y;
          vec3 zenith = vec3(0.05, 0.08, 0.20);
          vec3 mid = vec3(0.18, 0.30, 0.55);
          vec3 horizon = vec3(0.80, 0.70, 0.73);
          vec3 sunHaze = vec3(0.98, 0.58, 0.38);
          float sunSide = pow(max(dot(normalize(dir.xz + vec2(1e-4)), normalize(uSun.xz)), 0.0), 1.6);
          horizon = mix(horizon, sunHaze, sunSide);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
          col = mix(col, zenith, smoothstep(0.2, 0.85, h));
          float sun = pow(max(dot(dir, uSun), 0.0), 280.0);
          col += vec3(1.0, 0.84, 0.6) * sun;
          return col;
        }

        void main() {
          vec2 p = vWorld.xz;
          float h, ddx, ddz;
          ocean(p, uTime, h, ddx, ddz);
          float rip = cos(p.x * 0.74 + p.y * 0.51 + uTime * 2.15);
          ddx += rip * 0.74 * 0.028;
          ddz += rip * 0.51 * 0.028;
          float rip2 = cos(-p.x * 1.15 + p.y * 0.92 - uTime * 1.7);
          ddx += rip2 * -1.15 * 0.016;
          ddz += rip2 * 0.92 * 0.016;

          float wC = texture2D(uWake, vWakeUv).r;
          float wR = texture2D(uWake, vWakeUv + vec2(uWakeInv.x * 2.2, 0.0)).r;
          float wU = texture2D(uWake, vWakeUv + vec2(0.0, uWakeInv.y * 2.2)).r;
          ddx += (wR - wC) * 2.4;
          ddz += (wU - wC) * 2.4;

          vec3 n = normalize(vec3(-ddx, 1.0, -ddz));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float ndv = max(dot(n, viewDir), 0.0);
          float fres = pow(1.0 - ndv, 4.0);

          float shore = smoothstep(0.48, 0.98, abs(vBank));
          vec3 deep = vec3(0.015, 0.075, 0.14);
          vec3 shallow = vec3(0.05, 0.42, 0.48);
          float caustic = pow(0.5 + 0.5 * sin(p.x * 1.6 + uTime * 1.2) * sin(p.y * 1.25 - uTime), 3.0);
          shallow += vec3(0.04, 0.08, 0.06) * caustic;
          vec3 waterCol = mix(deep, shallow, shore * 0.85 + caustic * 0.08);
          float ndl = max(dot(n, uSun), 0.0);
          waterCol *= 0.42 + 0.7 * ndl;

          vec4 rp = uReflectMatrix * vec4(vWorld, 1.0);
          vec2 ruv = rp.xy / max(rp.w, 1e-4);
          float border = smoothstep(0.0, 0.12, ruv.x) * smoothstep(0.0, 0.12, ruv.y);
          border *= smoothstep(0.0, 0.12, 1.0 - ruv.x) * smoothstep(0.0, 0.12, 1.0 - ruv.y);
          ruv += n.xz * (0.028 + shore * 0.02);
          vec3 reflTex = texture2D(uReflect, ruv).rgb;
          vec3 refl = mix(skyColor(reflect(-viewDir, n)), reflTex, border);

          vec3 col = mix(waterCol, refl, mix(0.14, 0.86, fres));

          vec3 halfDir = normalize(uSun + viewDir);
          float spec = pow(max(dot(n, halfDir), 0.0), 160.0);
          float glint = pow(max(dot(n, halfDir), 0.0), 520.0);
          col += vec3(1.0, 0.9, 0.72) * (spec * 0.62 + glint * 0.85);

          float flowLen = length(vFlow);
          vec2 flow = flowLen > 0.001 ? vFlow / flowLen : vec2(0.0, 1.0);
          float streakPhase = dot(p, flow) * 0.62 - uTime * 2.4;
          float streak = pow(0.5 + 0.5 * sin(streakPhase), 10.0);
          float mid = 1.0 - smoothstep(0.15, 0.85, abs(vBank));
          col += vec3(0.62, 0.88, 0.95) * streak * mid * 0.16;

          float lap = 0.7 + 0.3 * sin(vAlong * 0.28 - uTime * 1.5 + hash(floor(p * 0.35)) * 6.28);
          float shoreFoam = shore * lap;
          float crest = smoothstep(0.05, 0.16, h);
          float wakeFoam = smoothstep(0.015, 0.2, wC);
          float foam = max(shoreFoam, max(crest * 0.55, wakeFoam));
          float grain = hash(p * 0.55 + uTime * 0.15);
          foam *= 0.82 + grain * 0.28;
          foam = smoothstep(0.12, 0.48, foam);
          vec3 foamCol = mix(vec3(0.72, 0.86, 0.9), vec3(0.96, 0.99, 1.0), foam);
          col = mix(col, foamCol, clamp(foam, 0.0, 0.92));

          float dist = length(cameraPosition - vWorld);
          float fogAmt = 1.0 - exp(-dist * 0.0072);
          col = mix(col, uFogColor, fogAmt);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;
  }

  setWake(texture: THREE.Texture, origin: THREE.Vector2, inv: THREE.Vector2): void {
    this.material.uniforms.uWake.value = texture;
    (this.material.uniforms.uWakeOrigin.value as THREE.Vector2).copy(origin);
    (this.material.uniforms.uWakeInv.value as THREE.Vector2).copy(inv);
  }

  resize(width: number, height: number): void {
    const w = Math.max(16, Math.floor(width * 0.42));
    const h = Math.max(16, Math.floor(height * 0.42));
    this.target.setSize(w, h);
  }

  update(time: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.material.uniforms.uTime.value = time;
    this.renderReflection(renderer, scene, camera);
  }

  private renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const planeY = this.planeY;
    camera.getWorldPosition(this.mirrorPos);
    camera.getWorldDirection(this.dir);
    this.look.copy(this.mirrorPos).add(this.dir);
    this.mirrorPos.y = planeY * 2 - this.mirrorPos.y;
    this.look.y = planeY * 2 - this.look.y;
    this.mirror.position.copy(this.mirrorPos);
    this.mirror.up.set(camera.up.x, -camera.up.y, camera.up.z);
    this.mirror.lookAt(this.look);
    this.mirror.fov = camera.fov;
    this.mirror.aspect = camera.aspect;
    this.mirror.near = camera.near;
    this.mirror.far = camera.far;
    this.mirror.updateProjectionMatrix();
    this.mirror.updateMatrixWorld();

    this.plane.set(new THREE.Vector3(0, 1, 0), -planeY);
    this.plane.applyMatrix4(this.mirror.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const proj = this.mirror.projectionMatrix;
    this.q.set(
      (Math.sign(this.clip.x) + proj.elements[8]) / proj.elements[0],
      (Math.sign(this.clip.y) + proj.elements[9]) / proj.elements[5],
      -1,
      (1 + proj.elements[10]) / proj.elements[14],
    );
    const scale = 2 / this.clip.dot(this.q);
    this.clip.multiplyScalar(scale);
    proj.elements[2] = this.clip.x;
    proj.elements[6] = this.clip.y;
    proj.elements[10] = this.clip.z - 1;
    proj.elements[14] = this.clip.w;

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(this.mirror.projectionMatrix);
    this.textureMatrix.multiply(this.mirror.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    const prevShadow = renderer.shadowMap.autoUpdate;
    this.mesh.visible = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.mirror);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    renderer.shadowMap.autoUpdate = prevShadow;
    this.mesh.visible = true;
  }
}

function buildRiverGeometry(path: RiverPath): THREE.BufferGeometry {
  const ALONG = 400;
  const ACROSS = 24;
  const positions: number[] = [];
  const uvs: number[] = [];
  const flows: number[] = [];
  const indices: number[] = [];
  const frame = {
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
  for (let i = 0; i <= ALONG; i++) {
    const d = (i / ALONG) * path.length;
    path.frameAt(d, frame);
    for (let j = 0; j <= ACROSS; j++) {
      const bank = (j / ACROSS) * 2 - 1;
      const lat = bank * (HALF + 1.25);
      positions.push(frame.point.x + frame.right.x * lat, 0, frame.point.z + frame.right.z * lat);
      uvs.push(bank, d);
      flows.push(frame.tangent.x, frame.tangent.z);
    }
  }
  const stride = ACROSS + 1;
  for (let i = 0; i < ALONG; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, d, b, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("flow", new THREE.Float32BufferAttribute(flows, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
