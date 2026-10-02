import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { AudioBus } from "./audio";
import { RACERS, createBoat, pushHistory, type Boat } from "./boats";
import { HALF, LAPS, damp, formatTime, ordinal, waveHeight, wrapDelta } from "./config";
import { buildCourse, driftClouds, followSun, type Course } from "./course";
import { Spray } from "./effects";
import { Input } from "./input";
import type { Frame } from "./path";
import { WakeField, WakeRibbon } from "./wake";
import { RiverWater } from "./water";

type Mode = "attract" | "countdown" | "race" | "finish";

const FOAM = new THREE.Color("#e9f8ff");
const FULL = 38;
const CRUISE = 32;
const BOOST_SPEED = 50;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly course: Course;
  private readonly water: RiverWater;
  private readonly wake: WakeField;
  private readonly spray = new Spray();
  private readonly boats: Boat[];
  private readonly ribbons: WakeRibbon[];
  private readonly input = new Input();
  private readonly audio = new AudioBus();
  private readonly frame: Frame = {
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
  private readonly camPos = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly scratchF = new THREE.Vector3();
  private readonly scratchR = new THREE.Vector3();
  private acc = 0;
  private mode: Mode = "attract";
  private raceTime = 0;
  private countdown = 0;
  private lastCount = 99;
  private flashTimer = 0;
  private camReady = false;
  private last = performance.now();
  private slowFrames = 0;
  private readonly topView: boolean;
  private readonly autoThrottle: boolean;
  private readonly hud: {
    lap: HTMLElement;
    clock: HTMLElement;
    place: HTMLElement;
    suf: HTMLElement;
    pace: HTMLElement;
    fill: HTMLElement;
    meter: HTMLElement;
    flash: HTMLElement;
    count: HTMLElement;
    results: HTMLElement;
    standings: HTMLElement;
    map: HTMLCanvasElement;
  };
  private readonly mapBg: HTMLCanvasElement;
  private readonly mapX: (x: number) => number;
  private readonly mapY: (z: number) => number;

  constructor(root: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.topView = params.has("top");
    this.autoThrottle = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 860;
    document.body.classList.toggle("touch", this.autoThrottle);
    if (params.has("clean")) document.body.classList.add("clean");

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.domElement.id = "view";
    root.prepend(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.2, 700);
    this.course = buildCourse(this.scene);
    this.wake = new WakeField(this.course.path.bounds);
    this.water = new RiverWater(this.course.path);
    this.water.setWake(this.wake.texture, this.wake.origin, this.wake.inv);
    this.scene.add(this.water.mesh);

    this.boats = RACERS.map((def) => createBoat(def));
    this.ribbons = this.boats.map(() => new WakeRibbon());
    this.boats.forEach((boat, i) => {
      this.scene.add(boat.group);
      this.scene.add(boat.shadow);
      this.scene.add(this.ribbons[i].mesh);
    });
    this.scene.add(this.spray.points);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.62;
    pmrem.dispose();

    this.hud = {
      lap: must("lap"),
      clock: must("clock"),
      place: must("placeNum"),
      suf: must("placeSuf"),
      pace: must("paceNum"),
      fill: must("meterFill"),
      meter: must("meter"),
      flash: must("flash"),
      count: must("count"),
      results: must("results"),
      standings: must("standings"),
      map: must("map"),
    };
    const map = this.buildMap();
    this.mapBg = map.canvas;
    this.mapX = map.x;
    this.mapY = map.y;

    this.layoutAttract();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    document.getElementById("raceBtn")?.addEventListener("click", () => {
      (document.getElementById("raceBtn") as HTMLButtonElement | null)?.blur();
      this.beginRace();
    });
    document.getElementById("againBtn")?.addEventListener("click", () => {
      (document.getElementById("againBtn") as HTMLButtonElement | null)?.blur();
      this.beginRace();
    });
    document.getElementById("mute")?.addEventListener("click", () => {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      const btn = document.getElementById("mute");
      if (btn) btn.textContent = this.audio.muted ? "🔇" : "♪";
    });
    window.addEventListener("keydown", (e) => {
      if (this.mode === "attract" && (e.code === "Enter" || e.code === "Space")) {
        e.preventDefault();
        this.beginRace();
      } else if (this.mode === "finish" && e.code === "KeyR") {
        this.beginRace();
      }
    });

    document.addEventListener("visibilitychange", () => {
      this.last = performance.now();
    });
    this.syncMode();
    this.renderer.setAnimationLoop((now: number) => this.frameLoop(now));
  }

  private resize(): void {
    const view = this.renderer.domElement.parentElement ?? document.body;
    const w = view.clientWidth || window.innerWidth;
    const h = view.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.water.resize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  private frameLoop(now: number): void {
    if (document.hidden) return;
    const raw = Math.min(0.12, (now - this.last) / 1000);
    this.last = now;
    if (raw > 0.04) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 40 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.resize();
      this.slowFrames = 0;
    }
    const time = now / 1000;
    this.input.poll(this.autoThrottle && this.mode !== "attract");
    this.updateMode(raw);
    const simulate = this.mode !== "countdown";
    this.acc += raw;
    let steps = 0;
    const step = 1 / 60;
    while (this.acc >= step && steps < 5) {
      this.boats.forEach((boat, index) => {
        const control = !simulate ? "frozen" : this.mode !== "attract" && index === 0 ? "player" : "ai";
        this.updateBoat(boat, index, step, time, control);
      });
      this.input.boostEdge = false;
      this.acc -= step;
      steps++;
    }
    if (steps === 0) {
      this.boats.forEach((boat, index) => this.updateBoat(boat, index, 0, time, "frozen"));
    }
    this.updateProps(time);
    this.spray.update(raw, time);
    this.wake.update(raw, this.boats, this.course.hazards);
    this.ribbons.forEach((ribbon, i) => ribbon.update(this.boats[i], time));
    driftClouds(this.scene, time, this.camera);
    this.updateCamera(Math.min(raw, 0.05), time);
    followSun(this.scene, this.look);
    this.water.update(time, this.renderer, this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.updateHud(raw);
    this.audio.setDrive(this.boats[0].speed, this.boats[0].boostTime > 0);
  }

  private updateMode(dt: number): void {
    if (this.mode === "countdown") {
      this.countdown -= dt;
      const shown = this.countdown <= 0.4 ? 0 : Math.ceil(this.countdown);
      if (shown !== this.lastCount) {
        this.lastCount = shown;
        if (shown <= 0) this.audio.go();
        else this.audio.beep(420 + (3 - shown) * 80);
      }
      if (this.countdown <= 0) {
        this.mode = "race";
        this.raceTime = 0;
        this.syncMode();
        this.flash("GO");
      }
    } else if (this.mode === "race" || this.mode === "finish") {
      this.raceTime += dt;
    }
  }

  private beginRace(): void {
    this.audio.unlock();
    this.layoutGrid();
    this.mode = "countdown";
    this.countdown = 3.2;
    this.lastCount = 99;
    this.raceTime = 0;
    this.camReady = false;
    this.hud.results.hidden = true;
    this.syncMode();
  }

  private layoutAttract(): void {
    const spots = [24, 40, 10, 58];
    const lats = [0.2, -1.5, 1.7, 0.6];
    this.boats.forEach((boat, i) => this.resetBoat(boat, spots[i], lats[i], 30));
  }

  private layoutGrid(): void {
    const grid = [
      { dist: -4.5, lat: -2.5 },
      { dist: -4.5, lat: 2.5 },
      { dist: -10.5, lat: -2.5 },
      { dist: -10.5, lat: 2.5 },
    ];
    this.boats.forEach((boat, i) => {
      this.resetBoat(boat, grid[i].dist, grid[i].lat, 0);
      boat.charge = i === 0 ? 1 : 0.2;
    });
  }

  private resetBoat(boat: Boat, dist: number, lateral: number, speed: number): void {
    boat.dist = dist;
    boat.lateral = lateral;
    boat.speed = speed;
    boat.latVelocity = 0;
    boat.boostTime = 0;
    boat.finished = false;
    boat.finishTime = 0;
    boat.prevLap = Math.floor(dist / this.course.path.length);
    boat.hitCd = 0;
    boat.charge = 0.35;
    boat.histCount = 0;
    boat.histHead = 0;
    boat.lastHistDist = dist;
    boat.padClaim.clear();
    boat.rank = 1;
  }

  private updateBoat(boat: Boat, index: number, dt: number, time: number, control: "player" | "ai" | "frozen"): void {
    const len = this.course.path.length;
    const limit = HALF - 1.2;
    boat.hitCd = Math.max(0, boat.hitCd - dt);
    boat.boostTime = Math.max(0, boat.boostTime - dt);

    if (control !== "frozen") {
      let steer = 0;
      let forward = true;
      let brake = false;
      let wantBoost = false;
      if (control === "player") {
        steer = this.input.steer;
        forward = this.input.forward;
        brake = this.input.brake;
        wantBoost = this.input.boostEdge;
      } else {
        const drive = this.aiIntent(boat, index, time, limit);
        steer = drive.steer;
        wantBoost = drive.boost;
      }
      if (wantBoost && boat.charge >= 0.4 && boat.boostTime <= 0 && !boat.finished) {
        boat.charge -= 0.4;
        boat.boostTime = 1.15;
        if (index === 0) {
          this.audio.boost();
          this.flash("CURRENT");
        }
      }

      let target = control === "ai" ? 32.6 * boat.def.aiSpeed : forward ? FULL : CRUISE;
      if (brake) target = 7;
      if (boat.boostTime > 0) target = control === "ai" ? 47 : BOOST_SPEED;
      const stream = 1 - Math.min(1, Math.abs(boat.lateral) / HALF);
      target += stream * 2.3;
      const accel = boat.boostTime > 0 ? 48 : 20;
      if (boat.speed < target) boat.speed = Math.min(target, boat.speed + accel * dt);
      else boat.speed = Math.max(target, boat.speed - 24 * dt);

      boat.latVelocity += steer * 30 * dt;
      boat.latVelocity *= Math.exp(-3.15 * dt);
      boat.lateral += boat.latVelocity * dt;

      for (const other of this.boats) {
        if (other === boat) continue;
        const ahead = wrapDelta(other.dist, boat.dist, len);
        if (ahead > 0.6 && ahead < 8 && Math.abs(other.lateral - boat.lateral) < 1.7) {
          boat.speed += 12 * dt;
        }
      }

      for (const rock of this.course.hazards) {
        const along = wrapDelta(boat.dist, rock.dist, len);
        if (Math.abs(along) < 2.4 && Math.abs(boat.lateral - rock.lateral) < rock.radius) {
          const away = Math.sign(boat.lateral - rock.lateral) || 1;
          boat.lateral = rock.lateral + away * (rock.radius + 0.2);
          boat.latVelocity = away * 7;
          if (boat.hitCd <= 0) {
            boat.speed *= 0.6;
            boat.hitCd = 0.45;
            this.spray.burst(boat.pos.x, boat.displayY + 0.4, boat.pos.z, away * 3, 3, 0, 18, 0.8, FOAM, 0.5);
          }
        }
      }

      if (Math.abs(boat.lateral) > limit) {
        const side = Math.sign(boat.lateral) || 1;
        const hard = Math.abs(boat.latVelocity) > 2 && boat.hitCd <= 0;
        boat.lateral = side * limit;
        if (hard) {
          boat.latVelocity = -side * Math.abs(boat.latVelocity) * 0.35;
          boat.speed *= 0.9;
          boat.hitCd = 0.3;
          this.spray.burst(
            boat.pos.x + boat.right.x * side,
            boat.displayY + 0.3,
            boat.pos.z + boat.right.z * side,
            boat.right.x * side * 4,
            2.4,
            boat.right.z * side * 4,
            14,
            0.5,
            FOAM,
          );
        } else {
          boat.latVelocity *= 0.2;
        }
      }

      boat.dist += (boat.speed + 1.6) * dt;

      const lap = Math.floor(boat.dist / len);
      this.course.pads.forEach((pad, padIndex) => {
        const key = `${lap}:${padIndex}`;
        if (boat.padClaim.has(key)) return;
        const along = wrapDelta(boat.dist, pad.dist, len);
        if (Math.abs(along) < 2.3 && Math.abs(boat.lateral - pad.lateral) < 2.35) {
          boat.padClaim.add(key);
          boat.charge = Math.min(1, boat.charge + 0.58);
          if (index === 0) {
            this.audio.pickup();
            this.flash("+ CURRENT");
          }
        }
      });

      if ((this.mode === "race" || this.mode === "finish") && !boat.finished && lap >= LAPS) {
        boat.finished = true;
        boat.finishTime = this.raceTime;
        if (index === 0 && this.mode === "race") {
          this.mode = "finish";
          this.syncMode();
          this.hud.results.hidden = false;
          if (this.playerRank() === 1) this.confetti(boat);
        }
      }
      if (index === 0 && this.mode === "race" && lap !== boat.prevLap && lap > 0 && lap < LAPS) {
        this.flash(`LAP ${lap + 1}`);
        this.audio.beep(640, 0.14);
      }
      boat.prevLap = lap;
    }

    this.course.path.frameAt(boat.dist, this.frame);
    const slip = THREE.MathUtils.clamp(boat.latVelocity / 16, -0.55, 0.55);
    const fx = this.frame.tangent.x + this.frame.right.x * slip * 0.7;
    const fz = this.frame.tangent.z + this.frame.right.z * slip * 0.7;
    const yaw = Math.atan2(fx, fz);
    const forward = this.scratchF.set(Math.sin(yaw), 0, Math.cos(yaw));
    const right = this.scratchR.set(-Math.cos(yaw), 0, Math.sin(yaw));
    const x = this.frame.point.x + this.frame.right.x * boat.lateral;
    const z = this.frame.point.z + this.frame.right.z * boat.lateral;
    const bowH = waveHeight(x + forward.x * 1.2, z + forward.z * 1.2, time);
    const sternH = waveHeight(x - forward.x * 1.15, z - forward.z * 1.15, time);
    const portH = waveHeight(x - right.x * 0.48, z - right.z * 0.48, time);
    const starH = waveHeight(x + right.x * 0.48, z + right.z * 0.48, time);
    const height = (bowH + sternH + portH + starH) / 4;
    boat.displayY = damp(boat.displayY, height + 0.55, 7.5, dt);
    boat.pitch = damp(boat.pitch, (sternH - bowH) * 1.15, 5.5, dt);
    boat.roll = damp(boat.roll, (starH - portH) * 1.35 - boat.latVelocity * 0.045, 6, dt);
    boat.group.position.set(x, boat.displayY, z);
    boat.group.rotation.y = yaw;
    boat.group.rotation.x = boat.pitch;
    boat.group.rotation.z = boat.roll;
    boat.pos.set(x, boat.displayY, z);
    boat.forward.copy(forward);
    boat.right.copy(right);
    boat.yaw = yaw;

    const moved = boat.dist - boat.lastHistDist;
    if (boat.speed > 2 && (moved > 0.82 || moved < -0.5)) {
      pushHistory(boat, x - forward.x * 1.3, z - forward.z * 1.3, right.x, right.z);
      boat.lastHistDist = boat.dist;
    }

    boat.prop.rotation.z += dt * (12 + boat.speed * 0.85 + (boat.boostTime > 0 ? 28 : 0));
    const bow = Math.min(0.95, Math.max(0, boat.speed / 14));
    (boat.bowL.material as THREE.MeshBasicMaterial).opacity = bow;
    (boat.bowR.material as THREE.MeshBasicMaterial).opacity = bow;
    const bowScale = 0.9 + boat.speed / 22;
    boat.bowL.scale.set(bowScale, bowScale * 1.35, 1);
    boat.bowR.scale.set(bowScale, bowScale * 1.35, 1);
    boat.accent.emissiveIntensity = boat.boostTime > 0 ? 2.5 : 0.16;
    boat.shadow.position.set(x, waveHeight(x, z, time) + 0.05, z);
    (boat.shadow.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.min(0.18, boat.speed / 180);

    if (boat.speed > 6 && dt > 0) {
      const rate = (boat.speed / 30) * (boat.boostTime > 0 ? 2.6 : 1);
      if (Math.random() < rate * dt * 46) {
        this.spray.spawn(
          x + forward.x * 1.5,
          boat.displayY + 0.45,
          z + forward.z * 1.5,
          forward.x * boat.speed * 0.08 + (Math.random() - 0.5) * 1.6,
          2.1 + Math.random() * 2.4,
          forward.z * boat.speed * 0.08 + (Math.random() - 0.5) * 1.6,
          0.45 + Math.random() * 0.3,
          FOAM,
        );
      }
      if (Math.random() < rate * dt * 34) {
        const side = Math.random() > 0.5 ? 1 : -1;
        this.spray.spawn(
          x + right.x * side * 0.55,
          boat.displayY + 0.12,
          z + right.z * side * 0.55,
          right.x * side * (1.6 + boat.speed * 0.05),
          0.8 + Math.random(),
          right.z * side * (1.6 + boat.speed * 0.05),
          0.4,
          FOAM,
        );
      }
    }
  }

  private aiIntent(boat: Boat, index: number, time: number, limit: number): { steer: number; boost: boolean } {
    const len = this.course.path.length;
    let ideal = Math.sin(boat.dist * 0.011 + index * 1.7) * 3.05 * boat.def.aiLine;
    for (const rock of this.course.hazards) {
      const ahead = wrapDelta(rock.dist, boat.dist, len);
      if (ahead > 0 && ahead < 20) {
        const away = Math.sign(boat.lateral - rock.lateral) || (index % 2 === 0 ? 1 : -1);
        ideal += away * (1 - ahead / 20) * 3.4;
      }
    }
    ideal = THREE.MathUtils.clamp(ideal, -limit + 0.3, limit - 0.3);
    const err = ideal - boat.lateral;
    const steer = THREE.MathUtils.clamp(err * 0.24 - boat.latVelocity * 0.09, -1, 1);
    const boost = boat.charge > 0.8 && Math.sin(time * 1.6 + index * 2.2) > 0.62 && boat.boostTime <= 0;
    return { steer, boost };
  }

  private updateProps(time: number): void {
    const len = this.course.path.length;
    for (const pad of this.course.pads) {
      const y = waveHeight(pad.mesh.position.x, pad.mesh.position.z, time) + 0.1;
      pad.mesh.position.y = y;
      pad.mesh.rotation.y = time * 0.7;
    }
    for (const gate of this.course.gates) {
      gate.mesh.position.y = waveHeight(gate.mesh.position.x, gate.mesh.position.z, time) * 0.75;
      const near = this.boats.some((boat) => Math.abs(wrapDelta(boat.dist, gate.dist, len)) < 7);
      gate.mat.emissiveIntensity = near ? 0.85 : 0.08;
    }
    for (const hazard of this.course.hazards) {
      const collar = hazard.mesh.children[1] as THREE.Mesh;
      collar.position.y = waveHeight(hazard.mesh.position.x, hazard.mesh.position.z, time) + 0.06;
    }
  }

  private updateCamera(dt: number, time: number): void {
    const boat = this.boats[0];
    if (this.topView) {
      this.camera.position.set(0, 230, 0);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(0, 0, 0);
      this.look.set(0, 0, 0);
      return;
    }
    this.desired.copy(boat.pos).addScaledVector(boat.forward, -9.2);
    this.desired.y = boat.displayY + 4.6;
    this.course.path.frameAt(boat.dist - 7, this.frame);
    const relX = this.desired.x - this.frame.point.x;
    const relZ = this.desired.z - this.frame.point.z;
    let lat = relX * this.frame.right.x + relZ * this.frame.right.z;
    lat = THREE.MathUtils.clamp(lat, -(HALF - 0.3), HALF - 0.3);
    const along = relX * this.frame.tangent.x + relZ * this.frame.tangent.z;
    this.desired.copy(this.frame.point);
    this.desired.addScaledVector(this.frame.right, lat);
    this.desired.addScaledVector(this.frame.tangent, Math.min(along, -2.2));
    const wave = waveHeight(this.desired.x, this.desired.z, time);
    this.desired.y = Math.max(wave + 2.2, boat.displayY + 4.05);
    if (!this.camReady) {
      this.camPos.copy(this.desired);
      this.camReady = true;
    } else {
      const k = 1 - Math.exp(-3.6 * dt);
      this.camPos.lerp(this.desired, k);
    }
    if (boat.boostTime > 0) {
      this.camPos.x += Math.sin(time * 46) * 0.035;
      this.camPos.y += Math.cos(time * 38) * 0.02;
    }
    this.camera.position.copy(this.camPos);
    this.look.copy(boat.pos).addScaledVector(boat.forward, 6.4);
    this.look.y = boat.displayY + 1.45;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.camera.rotateZ(THREE.MathUtils.clamp(-boat.latVelocity * 0.016, -0.16, 0.16));
    const targetFov = 57 + THREE.MathUtils.clamp(boat.speed / 40, 0, 1) * 7 + (boat.boostTime > 0 ? 6 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  private updateHud(dt: number): void {
    const player = this.boats[0];
    const len = this.course.path.length;
    const ranked = this.ranked();
    ranked.forEach((boat, i) => {
      boat.rank = i + 1;
    });
    const place = player.rank;
    this.hud.place.textContent = String(place);
    this.hud.suf.textContent = ordinal(place);
    if (this.mode === "attract") this.hud.lap.textContent = "WARMUP";
    else if (this.mode === "countdown") this.hud.lap.textContent = "READY";
    else {
      const lap = Math.min(LAPS, Math.max(1, Math.floor(player.dist / len) + 1));
      this.hud.lap.textContent = `LAP ${lap}/${LAPS}`;
    }
    this.hud.clock.textContent = this.mode === "race" || this.mode === "finish" ? formatTime(this.raceTime) : "0:00.00";
    this.hud.pace.textContent = String(Math.round(player.speed * 3.1));
    if (player.boostTime > 0) {
      this.hud.fill.style.width = `${(player.boostTime / 1.15) * 100}%`;
      this.hud.meter.classList.add("hot");
    } else {
      this.hud.fill.style.width = `${player.charge * 100}%`;
      this.hud.meter.classList.remove("hot");
    }
    if (this.mode === "countdown") {
      this.hud.count.textContent = this.countdown <= 0.4 ? "GO" : String(Math.max(1, Math.ceil(this.countdown)));
      this.hud.count.classList.add("show");
    } else {
      this.hud.count.classList.remove("show");
    }
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) this.hud.flash.classList.remove("show");
    if (!this.hud.results.hidden) this.paintStandings(ranked);
    this.paintMap(ranked);
  }

  private flash(text: string): void {
    this.hud.flash.textContent = text;
    this.hud.flash.classList.add("show");
    this.flashTimer = 1.05;
  }

  private confetti(boat: Boat): void {
    const colors = [0xff5a36, 0xffe08a, 0x14a3a8, 0x7c5cff].map((hex) => new THREE.Color(hex));
    for (let i = 0; i < 8; i++) {
      this.spray.burst(
        boat.pos.x,
        boat.displayY + 1.2,
        boat.pos.z,
        (Math.random() - 0.5) * 8,
        6 + Math.random() * 4,
        (Math.random() - 0.5) * 8,
        10,
        1.2,
        colors[i % colors.length],
        0.9,
      );
    }
  }

  private ranked(): Boat[] {
    return [...this.boats].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
  }

  private playerRank(): number {
    return this.ranked().findIndex((boat) => boat === this.boats[0]) + 1;
  }

  private paintStandings(ranked: Boat[]): void {
    this.hud.standings.innerHTML = ranked
      .map((boat, i) => {
        const color = `#${boat.def.hull.toString(16).padStart(6, "0")}`;
        const time = boat.finished ? formatTime(boat.finishTime) : "on course";
        return `<li class="${boat === this.boats[0] ? "you" : ""}"><i style="background:${color}"></i><b>${i + 1}${ordinal(i + 1)}</b><span>${boat.def.name}</span><em>${time}</em></li>`;
      })
      .join("");
  }

  private syncMode(): void {
    document.body.dataset.mode = this.mode;
  }

  private buildMap(): { canvas: HTMLCanvasElement; x: (x: number) => number; y: (z: number) => number } {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 220;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("map");
    const b = this.course.path.bounds;
    const pad = 18;
    const xOf = (x: number) => pad + ((x - b.minX) / (b.maxX - b.minX)) * (220 - pad * 2);
    const yOf = (z: number) => pad + (1 - (z - b.minZ) / (b.maxZ - b.minZ)) * (220 - pad * 2);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(120, 196, 214, 0.35)";
    g.lineWidth = 14;
    g.beginPath();
    this.course.path.samples.forEach((p, i) => {
      const x = xOf(p.x);
      const y = yOf(p.z);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
    g.stroke();
    g.strokeStyle = "rgba(214, 244, 255, 0.95)";
    g.lineWidth = 5;
    g.stroke();
    return { canvas, x: xOf, y: yOf };
  }

  private paintMap(ranked: Boat[]): void {
    const ctx = this.hud.map.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 220, 220);
    ctx.drawImage(this.mapBg, 0, 0);
    for (const boat of ranked) {
      const x = this.mapX(boat.pos.x);
      const y = this.mapY(boat.pos.z);
      ctx.beginPath();
      ctx.fillStyle = `#${boat.def.hull.toString(16).padStart(6, "0")}`;
      ctx.arc(x, y, boat === this.boats[0] ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (boat === this.boats[0]) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}
