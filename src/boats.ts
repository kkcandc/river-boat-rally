import * as THREE from "three";

export interface RacerDef {
  name: string;
  hull: number;
  deck: number;
  accent: number;
  trim: number;
  aiSpeed: number;
  aiLine: number;
}

export const RACERS: RacerDef[] = [
  { name: "SOLA", hull: 0xff5a36, deck: 0xfff0e8, accent: 0xffe08a, trim: 0x241910, aiSpeed: 1, aiLine: 0.85 },
  { name: "BRINE", hull: 0x14a3a8, deck: 0xe7fffb, accent: 0xd6fff4, trim: 0x062826, aiSpeed: 0.985, aiLine: 1 },
  { name: "KESTREL", hull: 0xf0a202, deck: 0xfff4d8, accent: 0xfff7e4, trim: 0x3a2804, aiSpeed: 0.96, aiLine: 0.75 },
  { name: "NYX", hull: 0x7c5cff, deck: 0xf3efff, accent: 0xddd4ff, trim: 0x160a28, aiSpeed: 0.972, aiLine: 1.08 },
];

const HIST = 42;

export interface HistPoint {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface Boat {
  def: RacerDef;
  group: THREE.Group;
  prop: THREE.Object3D;
  accent: THREE.MeshStandardMaterial;
  bowL: THREE.Mesh;
  bowR: THREE.Mesh;
  label: THREE.Sprite;
  labelCtx: CanvasRenderingContext2D;
  labelTex: THREE.CanvasTexture;
  shadow: THREE.Mesh;
  dist: number;
  lateral: number;
  speed: number;
  latVelocity: number;
  charge: number;
  boostTime: number;
  finished: boolean;
  finishTime: number;
  prevLap: number;
  hitCd: number;
  yaw: number;
  pitch: number;
  roll: number;
  displayY: number;
  pos: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  hist: HistPoint[];
  histHead: number;
  histCount: number;
  lastHistDist: number;
  padClaim: Set<string>;
  rank: number;
}

let hullGeo: THREE.BufferGeometry | null = null;

function sharedHull(): THREE.BufferGeometry {
  if (hullGeo) return hullGeo;
  const stations = [
    { z: -1.58, w: 0.2, deck: 0.24, keel: 0.05 },
    { z: -1.05, w: 0.48, deck: 0.34, keel: -0.05 },
    { z: -0.3, w: 0.64, deck: 0.4, keel: -0.16 },
    { z: 0.4, w: 0.58, deck: 0.38, keel: -0.14 },
    { z: 1.0, w: 0.38, deck: 0.3, keel: -0.05 },
    { z: 1.42, w: 0.16, deck: 0.22, keel: 0.03 },
    { z: 1.74, w: 0.015, deck: 0.14, keel: 0.08 },
  ];
  const ringOf = (s: (typeof stations)[number]) => {
    const { z, w, deck, keel } = s;
    const mid = (keel + deck) * 0.38;
    return [
      [0, keel, z],
      [-w * 0.55, keel + 0.045, z],
      [-w, mid, z],
      [-w * 0.84, deck, z],
      [-w * 0.32, deck + 0.02, z],
      [w * 0.32, deck + 0.02, z],
      [w * 0.84, deck, z],
      [w, mid, z],
      [w * 0.55, keel + 0.045, z],
    ];
  };
  const rings = stations.map(ringOf);
  const R = rings[0].length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) for (const p of ring) positions.push(p[0], p[1], p[2]);
  const S = rings.length;
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < R; j++) {
      const j2 = (j + 1) % R;
      const a = i * R + j;
      const b = i * R + j2;
      const c = (i + 1) * R + j;
      const d = (i + 1) * R + j2;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  hullGeo = geo;
  return geo;
}

function makeLabel(name: string, accent: string): { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("label canvas unavailable");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(3.5, 0.98, 1);
  sprite.position.y = 2.15;
  sprite.renderOrder = 5;
  paintLabel(ctx, tex, name, accent);
  return { sprite, ctx, tex };
}

export function paintLabel(ctx: CanvasRenderingContext2D, tex: THREE.CanvasTexture, text: string, accent: string): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(8, 12, 20, 0.62)";
  roundRect(ctx, 8, 10, w - 16, h - 20, 18);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(8, 10, 8, h - 20);
  ctx.fillStyle = "#f7fbff";
  ctx.font = "700 32px Outfit, Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2 + 4, h / 2 + 1);
  tex.needsUpdate = true;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bowWave(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(0.9, 1.5, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xf4fbff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

export function createBoat(def: RacerDef): Boat {
  const group = new THREE.Group();
  group.rotation.order = "YXZ";

  const hullMat = new THREE.MeshStandardMaterial({
    color: def.hull,
    roughness: 0.38,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const deckMat = new THREE.MeshStandardMaterial({ color: def.deck, roughness: 0.62, metalness: 0.02 });
  const accent = new THREE.MeshStandardMaterial({
    color: def.accent,
    emissive: def.accent,
    emissiveIntensity: 0.18,
    roughness: 0.32,
    metalness: 0.12,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: def.trim, roughness: 0.55, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xb9e7ff,
    transparent: true,
    opacity: 0.38,
    roughness: 0.08,
    metalness: 0.1,
    depthWrite: false,
  });

  const hull = new THREE.Mesh(sharedHull(), hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 1.35), deckMat);
  deck.position.set(0, 0.4, -0.05);
  deck.castShadow = true;
  group.add(deck);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 2.55), accent);
  stripe.position.set(0, 0.4, 0.05);
  group.add(stripe);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.62), trimMat);
  cockpit.position.set(0, 0.5, -0.15);
  group.add(cockpit);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.08), glassMat);
  glass.position.set(0, 0.66, 0.16);
  glass.rotation.x = -0.45;
  group.add(glass);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshStandardMaterial({ color: def.hull, roughness: 0.35, metalness: 0.15 }),
  );
  helmet.position.set(0, 0.7, -0.12);
  helmet.scale.y = 0.9;
  group.add(helmet);

  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff4d2, emissive: 0xffc56a, emissiveIntensity: 2.4 }),
  );
  lamp.position.set(0, 0.36, 1.48);
  group.add(lamp);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.22), accent);
  wing.position.set(0, 0.78, -1.2);
  group.add(wing);
  const strutGeo = new THREE.BoxGeometry(0.05, 0.32, 0.05);
  const strutL = new THREE.Mesh(strutGeo, trimMat);
  strutL.position.set(-0.42, 0.6, -1.18);
  const strutR = strutL.clone();
  strutR.position.x = 0.42;
  group.add(strutL, strutR);

  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.34), trimMat);
  motor.position.set(0, 0.22, -1.48);
  group.add(motor);

  const prop = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(0.06, 0.36, 0.04);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd7dee8, metalness: 0.6, roughness: 0.25 });
  const bladeA = new THREE.Mesh(bladeGeo, bladeMat);
  const bladeB = new THREE.Mesh(bladeGeo, bladeMat);
  bladeB.rotation.z = Math.PI / 2;
  prop.add(bladeA, bladeB);
  prop.position.set(0, 0.12, -1.68);
  group.add(prop);

  const bowL = bowWave();
  bowL.position.set(-0.55, 0.28, 1.25);
  bowL.rotation.set(-Math.PI / 2.15, 0.15, 0.55);
  const bowR = bowWave();
  bowR.position.set(0.55, 0.28, 1.25);
  bowR.rotation.set(-Math.PI / 2.15, -0.15, -0.55);
  group.add(bowL, bowR);

  const accentHex = "#" + def.accent.toString(16).padStart(6, "0");
  const { sprite, ctx, tex } = makeLabel(def.name, accentHex);
  group.add(sprite);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 18),
    new THREE.MeshBasicMaterial({ color: 0x021018, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;

  const hist: HistPoint[] = [];
  for (let i = 0; i < HIST; i++) hist.push({ x: 0, z: 0, rx: 1, rz: 0 });

  return {
    def,
    group,
    prop,
    accent,
    bowL,
    bowR,
    label: sprite,
    labelCtx: ctx,
    labelTex: tex,
    shadow,
    dist: 0,
    lateral: 0,
    speed: 0,
    latVelocity: 0,
    charge: 0.35,
    boostTime: 0,
    finished: false,
    finishTime: 0,
    prevLap: -1,
    hitCd: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    displayY: 0,
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    hist,
    histHead: 0,
    histCount: 0,
    lastHistDist: 0,
    padClaim: new Set(),
    rank: 1,
  };
}

export function pushHistory(boat: Boat, x: number, z: number, rx: number, rz: number): void {
  const h = boat.hist[boat.histHead];
  h.x = x;
  h.z = z;
  h.rx = rx;
  h.rz = rz;
  boat.histHead = (boat.histHead + 1) % HIST;
  boat.histCount = Math.min(HIST, boat.histCount + 1);
}

export function historyAt(boat: Boat, ageIndex: number): HistPoint | null {
  if (ageIndex >= boat.histCount) return null;
  const idx = (boat.histHead - 1 - ageIndex + HIST * 4) % HIST;
  return boat.hist[idx];
}
