import * as THREE from "three";
import { FOG_COLOR, HALF, SUN, mulberry32 } from "./config";
import type { Frame } from "./path";
import { RiverPath } from "./path";

export interface Pad {
  dist: number;
  lateral: number;
  mesh: THREE.Group;
}

export interface Hazard {
  dist: number;
  lateral: number;
  radius: number;
  mesh: THREE.Group;
}

export interface Gate {
  dist: number;
  mesh: THREE.Group;
  mat: THREE.MeshStandardMaterial;
}

export interface Course {
  path: RiverPath;
  pads: Pad[];
  hazards: Hazard[];
  gates: Gate[];
}

const scratch: Frame = {
  point: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
};

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("glow canvas");
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.35, "rgba(255,220,160,0.35)");
  grd.addColorStop(1, "rgba(255,180,80,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bannerTexture(caption: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("banner canvas");
  g.fillStyle = "#121820";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#ff6a45";
  for (let x = -48; x < 512; x += 56) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 28, 0);
    g.lineTo(x + 56, 64);
    g.lineTo(x + 28, 128);
    g.lineTo(x, 128);
    g.lineTo(x + 28, 64);
    g.closePath();
    g.fill();
  }
  g.fillStyle = "rgba(10,14,22,0.72)";
  g.fillRect(150, 28, 212, 72);
  g.fillStyle = "#fff8f2";
  g.font = "700 42px Outfit, Trebuchet MS, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(caption, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("cloud canvas");
  g.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = `rgba(255,248,244,${0.12 + (i % 3) * 0.05})`;
    g.beginPath();
    g.ellipse(40 + i * 28, 64 + (i % 2) * 6, 36, 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCourse(scene: THREE.Scene): Course {
  const path = new RiverPath();
  const rand = mulberry32(0x51a7);
  const glow = glowTexture();

  scene.background = new THREE.Color("#1a2744");
  scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.0068);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 20), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -2;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xb7c6e4, 0x243028, 0.72);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd0a4, 2.8);
  sun.position.copy(SUN).multiplyScalar(80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 110;
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  scene.userData.sun = sun;

  addGround(scene);
  addBanks(scene, path);
  addTrees(scene, path, rand);
  addRocks(scene, path, rand);
  addReeds(scene, path, rand);
  addClouds(scene, cloudTexture());
  addLanterns(scene, path, glow);
  addMountains(scene, rand);
  addDock(scene, path);

  const gates = addGates(scene, path);
  const pads = addPads(scene, path, glow);
  const hazards = addHazards(scene, path);

  return { path, pads, hazards, gates };
}

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      sunDir: { value: SUN.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vWorld - cameraPosition);
        float h = dir.y;
        vec3 zenith = vec3(0.05, 0.08, 0.20);
        vec3 mid = vec3(0.18, 0.30, 0.55);
        vec3 horizon = vec3(0.80, 0.70, 0.73);
        vec3 sunHaze = vec3(0.98, 0.58, 0.38);
        float sunSide = pow(max(dot(normalize(dir.xz), normalize(sunDir.xz)), 0.0), 1.6);
        horizon = mix(horizon, sunHaze, sunSide * smoothstep(0.15, -0.02, h));
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
        col = mix(col, zenith, smoothstep(0.18, 0.85, h));
        col = mix(vec3(0.08, 0.09, 0.12), col, smoothstep(-0.25, 0.02, h));
        float sun = pow(max(dot(dir, sunDir), 0.0), 420.0);
        float glow = pow(max(dot(dir, sunDir), 0.0), 7.0);
        col += vec3(1.0, 0.86, 0.62) * sun * 1.6;
        col += vec3(1.0, 0.52, 0.28) * glow * 0.42;
        float star = step(0.9965, hash(floor(dir.xy * 220.0))) * smoothstep(0.25, 0.7, h);
        col += star * 0.55;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function addGround(scene: THREE.Scene): void {
  const geo = new THREE.CircleGeometry(420, 80);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i);
    const r = Math.hypot(x, z);
    let y = -0.45;
    if (r < 52) y = 1.35 * (1 - r / 52) + 0.15;
    pos.setZ(i, y);
    const hill = r < 52 ? 0.15 : 0;
    col.setHSL(0.28 + hill, 0.32, 0.18 + (r < 52 ? 0.06 : 0) + Math.sin(x * 0.02) * 0.02);
    if (r > 180) col.lerp(new THREE.Color("#6d7c88"), Math.min(1, (r - 180) / 140));
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
  );
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addBanks(scene: THREE.Scene, path: RiverPath): void {
  const stride = 2;
  const n = path.samples.length;
  const rings = Math.floor(n / stride);
  const across = 5;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const sand = new THREE.Color("#d9c3a2");
  const grass = new THREE.Color("#2f6a3c");
  const deep = new THREE.Color("#1c3d28");
  const col = new THREE.Color();

  const pushSide = (side: number, base: number) => {
    for (let i = 0; i <= rings; i++) {
      const idx = (i * stride) % n;
      path.frameAt(path.cumulative[idx], scratch);
      const along = path.cumulative[idx];
      const wobble = Math.sin(along * 0.045 + side) * 0.55 + Math.sin(along * 0.11) * 0.28;
      for (let j = 0; j < across; j++) {
        const t = j / (across - 1);
        const lat = side * (HALF + 0.35 + t * 20);
        const y = 0.16 + t * t * 2.5 + Math.max(0, wobble) * t;
        const x = scratch.point.x + scratch.right.x * lat;
        const z = scratch.point.z + scratch.right.z * lat;
        positions.push(x, y, z);
        col.copy(sand).lerp(grass, Math.min(1, t * 1.4));
        if (t > 0.55) col.lerp(deep, (t - 0.55) / 0.45);
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < across - 1; j++) {
        const a = base + i * across + j;
        const b = a + 1;
        const c = a + across;
        const d = c + 1;
        if (side > 0) indices.push(a, d, b, a, c, d);
        else indices.push(a, b, d, a, d, c);
      }
    }
  };

  pushSide(1, 0);
  const vertsPerSide = (rings + 1) * across;
  pushSide(-1, vertsPerSide);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  scene.add(mesh);
}

function addTrees(scene: THREE.Scene, path: RiverPath, rand: () => number): void {
  const count = 240;
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.16, 1.15, 5);
  trunkGeo.translate(0, 0.55, 0);
  const crownGeo = new THREE.IcosahedronGeometry(0.72, 0);
  crownGeo.scale(1.05, 0.78, 1.05);
  crownGeo.translate(0, 1.45, 0);
  const crown2 = new THREE.IcosahedronGeometry(0.5, 0);
  crown2.scale(1, 0.85, 1);
  crown2.translate(0, 2.05, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: false });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, leafMat, count);
  const tops = new THREE.InstancedMesh(crown2, leafMat, count);
  const dummy = new THREE.Object3D();
  const bark = new THREE.Color();
  const leaf = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 8) {
    guard++;
    const dist = rand() * path.length;
    const side = rand() > 0.42 ? 1 : -1;
    const lat = side * (HALF + 2.4 + rand() * 12);
    if (side < 0 && Math.abs(lat) > 46 && rand() > 0.35) continue;
    path.frameAt(dist, scratch);
    const x = scratch.point.x + scratch.right.x * lat;
    const z = scratch.point.z + scratch.right.z * lat;
    const r = Math.hypot(x, z);
    let y = 0.2;
    if (r < 52) y = 1.35 * (1 - r / 52) + 0.15;
    else y = 0.25 + Math.min(1, (Math.abs(lat) - HALF) / 18) * 2.2;
    const s = 0.75 + rand() * 1.15;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    crowns.setMatrixAt(placed, dummy.matrix);
    tops.setMatrixAt(placed, dummy.matrix);
    bark.setHSL(0.07, 0.35, 0.18 + rand() * 0.08);
    leaf.setHSL(0.28 + rand() * 0.08, 0.45, 0.22 + rand() * 0.12);
    trunks.setColorAt(placed, bark);
    crowns.setColorAt(placed, leaf);
    leaf.offsetHSL(0.02, 0.05, 0.04);
    tops.setColorAt(placed, leaf);
    placed++;
  }
  for (const mesh of [trunks, crowns, tops]) {
    mesh.count = placed;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }
}

function addRocks(scene: THREE.Scene, path: RiverPath, rand: () => number): void {
  const count = 70;
  const geo = new THREE.DodecahedronGeometry(0.7, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.04 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const dist = rand() * path.length;
    const side = rand() > 0.5 ? 1 : -1;
    const lat = side * (HALF + 0.8 + rand() * 8);
    path.frameAt(dist, scratch);
    const x = scratch.point.x + scratch.right.x * lat;
    const z = scratch.point.z + scratch.right.z * lat;
    const s = 0.35 + rand() * 0.9;
    dummy.position.set(x, 0.05 + rand() * 0.3, z);
    dummy.rotation.set(rand(), rand(), rand());
    dummy.scale.set(s * (0.8 + rand() * 0.5), s * 0.7, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.07, 0.12, 0.35 + rand() * 0.2);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addReeds(scene: THREE.Scene, path: RiverPath, rand: () => number): void {
  const count = 160;
  const geo = new THREE.ConeGeometry(0.05, 0.9, 4);
  geo.translate(0, 0.45, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const dist = rand() * path.length;
    const side = rand() > 0.5 ? 1 : -1;
    const lat = side * (HALF + 0.15 + rand() * 1.1);
    path.frameAt(dist, scratch);
    dummy.position.set(
      scratch.point.x + scratch.right.x * lat,
      0.05,
      scratch.point.z + scratch.right.z * lat,
    );
    dummy.rotation.y = rand() * 3;
    dummy.rotation.z = (rand() - 0.5) * 0.3;
    dummy.scale.setScalar(0.7 + rand() * 0.8);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.22 + rand() * 0.08, 0.5, 0.28 + rand() * 0.1);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

function addClouds(scene: THREE.Scene, tex: THREE.Texture): void {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 });
  const group = new THREE.Group();
  group.name = "clouds";
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const a = (i / 8) * Math.PI * 2;
    const rad = 70 + (i % 3) * 30;
    mesh.position.set(Math.cos(a) * rad, 42 + (i % 4) * 6, Math.sin(a) * rad * 0.75);
    mesh.scale.set(22 + (i % 3) * 8, 10, 1);
    mesh.userData.spin = a;
    mesh.userData.rad = rad;
    mesh.userData.y = mesh.position.y;
    group.add(mesh);
  }
  scene.add(group);
}

export function driftClouds(scene: THREE.Scene, time: number, camera: THREE.Camera): void {
  const group = scene.getObjectByName("clouds");
  if (!group) return;
  for (const cloud of group.children) {
    const spin = (cloud.userData.spin as number) + time * 0.012;
    const rad = cloud.userData.rad as number;
    cloud.position.x = Math.cos(spin) * rad;
    cloud.position.z = Math.sin(spin) * rad * 0.75;
    cloud.position.y = cloud.userData.y as number;
    cloud.lookAt(camera.position.x, cloud.position.y, camera.position.z);
  }
}

function addLanterns(scene: THREE.Scene, path: RiverPath, glow: THREE.Texture): void {
  const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.8, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.7 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe1a8,
    emissive: 0xffb15a,
    emissiveIntensity: 2.6,
  });
  const haloMat = new THREE.SpriteMaterial({
    map: glow,
    color: 0xffb15a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 14; i++) {
    const dist = (i / 14) * path.length + 12;
    const side = i % 2 === 0 ? 1 : -1;
    path.frameAt(dist, scratch);
    const lat = side * (HALF + 1.6);
    const g = new THREE.Group();
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 0.9;
    post.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), bulbMat);
    bulb.position.y = 1.85;
    const halo = new THREE.Sprite(haloMat.clone());
    halo.position.y = 1.85;
    halo.scale.set(2.4, 2.4, 1);
    g.add(post, bulb, halo);
    g.position.set(scratch.point.x + scratch.right.x * lat, 0.15, scratch.point.z + scratch.right.z * lat);
    scene.add(g);
  }
}

function addMountains(scene: THREE.Scene, rand: () => number): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x7f8ea4, roughness: 1, metalness: 0 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
    const r = 250 + rand() * 40;
    const h = 34 + rand() * 48;
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(22 + rand() * 26, h, 5), mat);
    mesh.position.set(Math.cos(a) * r, h * 0.35 - 6, Math.sin(a) * r);
    scene.add(mesh);
  }
}

function addDock(scene: THREE.Scene, path: RiverPath): void {
  path.frameAt(8, scratch);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.78 });
  const dock = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.28), wood);
    plank.position.set(0, 0.35, -i * 0.32);
    plank.castShadow = true;
    plank.receiveShadow = true;
    dock.add(plank);
  }
  const pilingGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.1, 6);
  for (const x of [-0.6, 0.6]) {
    for (const z of [0, -1.5]) {
      const p = new THREE.Mesh(pilingGeo, wood);
      p.position.set(x, -0.15, z);
      dock.add(p);
    }
  }
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 512;
  signCanvas.height = 180;
  const g = signCanvas.getContext("2d");
  if (g) {
    g.fillStyle = "#1b2430";
    g.fillRect(0, 0, 512, 180);
    g.fillStyle = "#ff6a45";
    g.fillRect(0, 0, 512, 10);
    g.fillStyle = "#fff7f2";
    g.font = "700 64px Outfit, Trebuchet MS, sans-serif";
    g.textAlign = "center";
    g.fillText("RIVER ENERGY", 256, 88);
    g.font = "600 28px Outfit, Trebuchet MS, sans-serif";
    g.fillStyle = "#ffd7a8";
    g.fillText("BLUE HOUR CUP", 256, 136);
  }
  const tex = new THREE.CanvasTexture(signCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.1),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
  );
  sign.position.set(0, 1.7, -1.7);
  dock.add(sign);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), wood);
  pole.position.set(0, 1.05, -1.7);
  dock.add(pole);

  dock.position.copy(scratch.point).addScaledVector(scratch.right, HALF + 1.3);
  dock.position.y = 0.05;
  const yaw = Math.atan2(scratch.tangent.x, scratch.tangent.z);
  dock.rotation.y = yaw;
  scene.add(dock);
}

function addGates(scene: THREE.Scene, path: RiverPath): Gate[] {
  const labels = ["START", "GATE 2", "GATE 3"];
  const gates: Gate[] = [];
  for (let i = 0; i < 3; i++) {
    const dist = (i / 3) * path.length;
    path.frameAt(dist, scratch);
    const mat = new THREE.MeshStandardMaterial({
      map: bannerTexture(labels[i]),
      roughness: 0.55,
      emissive: 0xff6a45,
      emissiveIntensity: 0.08,
    });
    const group = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.1, 0.13, 3.3, 7);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.35, metalness: 0.18 });
    const left = new THREE.Mesh(postGeo, postMat);
    left.position.set(-6.2, 1.5, 0);
    left.castShadow = true;
    const right = left.clone();
    right.position.x = 6.2;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.7, 0.08), mat);
    banner.position.y = 3.15;
    group.add(left, right, banner);
    group.position.copy(scratch.point);
    group.position.y = 0;
    group.rotation.y = Math.atan2(scratch.tangent.x, scratch.tangent.z);
    scene.add(group);
    gates.push({ dist, mesh: group, mat });
  }
  return gates;
}

function addPads(scene: THREE.Scene, path: RiverPath, glow: THREE.Texture): Pad[] {
  const spots = [
    { t: 0.16, lat: -2.2 },
    { t: 0.39, lat: 2.4 },
    { t: 0.63, lat: 0.2 },
    { t: 0.84, lat: -1.6 },
  ];
  const pads: Pad[] = [];
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd56a,
    emissive: 0xff9a1f,
    emissiveIntensity: 1.6,
    roughness: 0.28,
    metalness: 0.2,
  });
  for (const spot of spots) {
    const dist = spot.t * path.length;
    path.frameAt(dist, scratch);
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.07, 8, 28), mat);
    ring.rotation.x = -Math.PI / 2;
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: 0xffc56a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    halo.scale.set(4.2, 4.2, 1);
    halo.position.y = 0.2;
    group.add(ring, halo);
    group.position.copy(scratch.point).addScaledVector(scratch.right, spot.lat);
    scene.add(group);
    pads.push({ dist, lateral: spot.lat, mesh: group });
  }
  return pads;
}

function addHazards(scene: THREE.Scene, path: RiverPath): Hazard[] {
  const spots = [
    { t: 0.27, lat: 2.3, s: 1.15 },
    { t: 0.51, lat: -2.5, s: 1.3 },
    { t: 0.73, lat: 1.5, s: 1.05 },
  ];
  const hazards: Hazard[] = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d847c, roughness: 0.78, metalness: 0.05 });
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xe7f6ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  for (const spot of spots) {
    const dist = spot.t * path.length;
    path.frameAt(dist, scratch);
    const group = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), rockMat);
    rock.scale.set(spot.s, spot.s * 0.72, spot.s * 0.9);
    rock.position.y = 0.15;
    rock.castShadow = true;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(spot.s + 0.45, 0.1, 6, 18), foamMat);
    collar.rotation.x = -Math.PI / 2;
    collar.renderOrder = 2;
    group.add(rock, collar);
    group.position.copy(scratch.point).addScaledVector(scratch.right, spot.lat);
    scene.add(group);
    hazards.push({ dist, lateral: spot.lat, radius: spot.s + 0.85, mesh: group });
  }
  return hazards;
}

export function followSun(scene: THREE.Scene, focus: THREE.Vector3): void {
  const sun = scene.userData.sun as THREE.DirectionalLight | undefined;
  if (!sun) return;
  sun.position.copy(focus).addScaledVector(SUN, 48);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();
}
