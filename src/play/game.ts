import * as THREE from "three";
import { ResolutionGovernor } from "./governor.ts";
import { groundDetailFor, nextQuality, QUALITY_SCALE, type Quality } from "./quality.ts";
import { defaultGrade, type GradeParams } from "../core/render/grade.ts";
import { emptySpec } from "../core/deform/stages.ts";
import { createTerrain, type Terrain } from "../world/cpu/terrain.ts";
import { foldSpec, PLANET_RADIUS, RIPPLE_SPEED } from "../world/folds.ts";
import { ProcWorld, type WorldView } from "../world/procworld.ts";
import { lookAt, REALM_LOOKS } from "../world/realms.ts";
import { lightningAt, NO_LIGHTNING, type Lightning } from "../world/storm.ts";
import { gateFrame, wondersNear, type GateFrame, type Wonder } from "../world/wonders.ts";
import { Score, type ScoreEvent } from "./audio.ts";
import { Hud } from "./hud.ts";
import { Input, isTouchDevice, type Action } from "./input.ts";
import { lensFov } from "./lens.ts";
import { Player, type PlayerEvent } from "./player.ts";
import { FoldPowers, type Toggle } from "./powers.ts";
import { formatShare, type ShareState } from "./share.ts";
import { landRing, RingPool, stepRing } from "./rings.ts";
import { findSpawn } from "./spawn.ts";

const MAX_DPR = 1.5;
/** Pixels the first frame aims for, before the governor has seen any timing. */
const START_PIXELS = 1.35e6;
/** How high the camera rises above the walker when the planet is fully rolled. */
const PLANET_LIFT = 250;
const PLANET_PITCH = 1.32;
const DEEP_REALM = 2;

export interface GameOptions {
  canvas: HTMLCanvasElement;
  seed: number;
  quality: Quality;
  share: ShareState | null;
  showStats: boolean;
  /** Leaves out the flashes of lightning, for people who asked their system for less motion. */
  calm: boolean;
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

/** The whole experience: one walker in an endless world, with the fold powers, the HUD and the score. */
export class Game {
  readonly world: ProcWorld;
  readonly player: Player;
  readonly powers = new FoldPowers();
  readonly hud: Hud;
  readonly input: Input;
  readonly score = new Score();
  terrain: Terrain;

  private readonly canvas: HTMLCanvasElement;
  private readonly governor: ResolutionGovernor;
  private quality: Quality;
  private seed: number;
  private time = 0;
  private frozen = false;
  private photo = false;
  private begun = false;
  private statsOn: boolean;
  private lastNow = 0;
  private statsClock = 0;
  private frameMsEma = 16.7;
  private pendingScale: number | null = null;
  private fade = 0;
  private introAge = 0;
  private readonly rings = new RingPool();
  private flash: [number, number] = [0, -10];
  private readonly calm: boolean;
  /** The lightning flash that thunder has already followed. */
  private thunderFor = -1;
  private saveNext = false;
  private nearby: Wonder[] = [];
  private wonderClock = 0;
  private readonly found = new Set<string>();
  private readonly gates = new Map<string, GateFrame>();
  private readonly gateSide = new Map<string, number>();
  private gateCooldown = 0;
  private readonly eye = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();

  private constructor(o: GameOptions, world: ProcWorld, governor: ResolutionGovernor) {
    this.canvas = o.canvas;
    this.world = world;
    this.governor = governor;
    this.quality = o.quality;
    this.seed = o.seed;
    this.statsOn = o.showStats;
    this.calm = o.calm;
    this.terrain = createTerrain(o.seed);
    this.player = new Player(this.terrain);
    this.hud = new Hud({
      action: (a) => this.act(a),
      touchJump: (down) => this.input.setTouchJump(down),
      touchDescend: (down) => this.input.setTouchDescend(down),
    });
    this.input = new Input(o.canvas, () => this.score.start());
    this.hud.setTouch(isTouchDevice());
    this.applyQuality(o.quality);
    if (o.share && o.share.seed === o.seed) this.restore(o.share);
    else this.respawn();
  }

  static create(o: GameOptions): Game {
    const scale = startScale();
    const { width, height } = renderSize(scale);
    const world = ProcWorld.create({ canvas: o.canvas, width, height, supersample: 1, hdr: "half", capture: false });
    const governor = new ResolutionGovernor({ min: 0.4, max: 1, step: 0.1, start: scale });
    const game = new Game(o, world, governor);
    world.stage.renderer.getContext().canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      game.hud.fail("The graphics context was lost. Reload the page.");
    });
    window.addEventListener("resize", () => (game.pendingScale = game.governor.scale));
    return game;
  }

  /** Starts the opening: the world fades in from black and unrolls from a small planet. Sound waits for the first click or key. */
  begin(): void {
    this.begun = true;
    this.introAge = 0;
    this.powers.startFrom("planet", 1, 0.95);
    this.fade = 0;
  }

  start(onFirstFrame?: () => void): void {
    let first = true;
    const loop = (now: number): void => {
      requestAnimationFrame(loop);
      this.frame(now);
      if (first) {
        first = false;
        onFirstFrame?.();
      }
    };
    requestAnimationFrame(loop);
  }

  snapshot(): ShareState {
    const p = this.player;
    return { seed: this.seed, x: p.feet.x, z: p.feet.z, yaw: p.yaw, pitch: p.pitch, agl: Math.max(0, p.feet.y - p.ground(p.feet.x, p.feet.z)) };
  }

  private restore(s: ShareState): void {
    this.player.place(s.x, s.z, s.yaw, s.pitch);
    if (s.agl > 1) {
      this.player.feet.y += s.agl;
      this.player.toggleFly();
    }
  }

  private respawn(): void {
    const spawn = findSpawn(this.terrain);
    this.player.place(spawn.x, spawn.z, spawn.yaw, 0.05);
    this.powers.reset();
    this.world.blooms.clear();
    this.gateSide.clear();
  }

  /** Hops to another seed in place: new ground, new wonders, new creatures, the same page. */
  private newWorld(): void {
    let seed = this.seed;
    while (seed === this.seed) seed = Math.floor(Math.random() * 0x100000000);
    this.seed = seed;
    this.terrain = createTerrain(seed);
    this.player.setTerrain(this.terrain);
    this.nearby = [];
    this.gates.clear();
    this.found.clear();
    this.world.blooms.clear();
    this.respawn();
    const url = new URL(location.href);
    url.searchParams.set("seed", String(seed));
    url.hash = "";
    history.replaceState(null, "", url);
    this.flash = [0.6, this.time];
  }

  private applyQuality(next: Quality): void {
    this.quality = next;
    this.governor.lock(next === "auto" ? null : QUALITY_SCALE[next]);
    this.pendingScale = this.governor.scale;
  }

  private act(action: Action): void {
    this.score.start();
    if (!this.begun) return;
    switch (action) {
      case "fly": {
        const e = this.player.toggleFly();
        this.onPlayerEvent(e);
        return;
      }
      case "planet":
      case "corkscrew":
      case "hinge": {
        const on = this.powers.toggle(action satisfies Toggle);
        this.hud.setActive(action, on);
        this.score.event(action, 1, on);
        this.rings.add({ x: this.player.feet.x, z: this.player.feet.z, start: this.time, amplitude: 0.55, speed: 70, life: 3.6, radius: 3, width: 6 });
        return;
      }
      case "ripple":
        this.powers.ripple();
        this.score.event("ripple");
        this.rings.add({ x: this.player.feet.x, z: this.player.feet.z, start: this.time, amplitude: 0.7, speed: RIPPLE_SPEED, life: 5.5, radius: 20, width: 24 });
        return;
      case "sing":
        this.score.event("sing");
        this.rings.add({ x: this.player.feet.x, z: this.player.feet.z, start: this.time, amplitude: 1, speed: 110, life: 5.5, radius: 4, width: 8 });
        this.flash = [0.3, this.time];
        return;
      case "photo":
        this.setPhoto(!this.photo);
        return;
      case "help":
        this.hud.setHelp(!this.hud.helpVisible);
        return;
      case "mute":
        this.score.setMuted(!this.score.muted);
        return;
      case "quality":
        this.applyQuality(nextQuality(this.quality));
        return;
      case "respawn":
        this.respawn();
        return;
      case "world":
        this.newWorld();
        return;
      case "share":
        void this.shareLink();
        return;
      case "freeze":
        this.frozen = !this.frozen;
        return;
      case "save":
        this.saveNext = true;
        return;
      case "stats":
        this.statsOn = !this.statsOn;
        if (!this.statsOn) this.hud.setStats("");
        return;
    }
  }

  private setPhoto(on: boolean): void {
    this.photo = on;
    this.hud.setMode(on ? "photo" : "play");
    this.score.event("photo");
    if (on) {
      if (this.player.mode !== "fly") this.onPlayerEvent(this.player.toggleFly());
    }
  }

  private async shareLink(): Promise<void> {
    history.replaceState(null, "", `#${formatShare(this.snapshot())}`);
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
    }
  }

  private onPlayerEvent(e: PlayerEvent): void {
    switch (e.kind) {
      case "step":
        this.rings.add(stepRing(e.x, e.z, this.time, e.strength));
        this.plantBloom(e.x, e.z, 1);
        this.score.event("step", e.strength);
        return;
      case "jump":
        this.score.event("jump");
        return;
      case "land":
        this.rings.add(landRing(this.player.feet.x, this.player.feet.z, this.time));
        this.plantBloom(this.player.feet.x, this.player.feet.z, 1.8);
        this.score.event("land", Math.min(1, e.speed / 18));
        return;
      case "mode":
        this.hud.setActive("fly", e.mode === "fly");
        return;
    }
  }

  private frame(now: number): void {
    const frameMs = this.lastNow ? now - this.lastNow : 16.7;
    this.lastNow = now;
    const dt = Math.min(0.1, frameMs / 1000);
    this.frameMsEma += (frameMs - this.frameMsEma) * 0.1;

    const next = this.governor.observe(frameMs);
    if (next !== null) this.pendingScale = next;
    if (this.pendingScale !== null) {
      const { width, height } = renderSize(this.pendingScale);
      this.world.resize(width, height);
      this.world.ground.setDetail(groundDetailFor(this.pendingScale));
      this.pendingScale = null;
    }

    const input = this.input.poll(dt);
    for (const a of input.actions) this.act(a);
    this.hud.drawStick(this.input.stickOffset);

    const mix = this.terrain.realmAt(this.player.feet.x, this.player.feet.z);
    const deep = mix.a === DEEP_REALM ? 1 - mix.t : mix.b === DEEP_REALM ? mix.t : 0;

    if (this.begun) {
      this.introAge += dt;
      const control = this.introAge > 2.2;
      const idle = { ...input, moveX: 0, moveY: 0, turn: 0, tilt: 0, jumpPressed: false, jumpHeld: false, run: false };
      for (const e of this.player.update(dt, control ? input : idle, deep)) this.onPlayerEvent(e);
    }
    this.powers.update(dt);
    if (!this.frozen) this.time += dt;
    this.fade = Math.min(1, this.fade + dt / 1.6);

    const look = lookAt(mix.a, mix.b, mix.t);
    const stormy = this.calm ? 0 : look.atmosphere.sky.storm;
    const lightning = stormy > 0.02 ? lightningAt(this.time, this.seed, stormy) : NO_LIGHTNING;
    this.followWithThunder(lightning);

    const amounts = this.powers.amounts;
    const planet = smooth(amounts.planet);
    const eye = this.player.eye(this.eye);
    if (this.begun) this.trackWonders(dt, eye);
    eye.y += PLANET_LIFT * Math.pow(planet, 1.4);
    const q = this.player.orientation(this.orientation, -PLANET_PITCH * planet);
    const focus = this.photo ? this.hud.photoValues() : { focus: 0, blur: 0 };
    const feet = this.player.feet;

    const view: WorldView = {
      time: this.time,
      seed: this.seed,
      player: feet,
      heading: this.player.yaw,
      camera: { position: eye, quaternion: q, fov: lensFov(this.player.fov + planet * 8, this.world.stage.camera.aspect) },
      atmosphere: look.atmosphere,
      realm: { a: mix.a, b: mix.b, t: mix.t, variant: 0 },
      spec: this.begun || amounts.planet > 0 ? foldSpec(amounts, feet, this.player.yaw) : emptySpec(),
      dof: this.photo && focus.blur > 0.01 ? { focalDistance: 1.5 * Math.pow(533, focus.focus), apertureAngle: 0.035 * focus.blur * focus.blur } : { focalDistance: 0, apertureAngle: 0 },
      lightRings: this.rings.rings,
      pulse: this.flash,
      storm: lightning.flash && lightning.level > 0 ? { level: lightning.level, azimuth: lightning.flash.azimuth, shape: lightning.flash.shape } : undefined,
    };
    const grade: GradeParams = { ...defaultGrade(), ...look.grade, fade: smooth(this.fade) };
    this.world.setView(view);
    this.world.drawHdr();
    this.world.post.render(this.world.hdrTexture, grade, 0, true);

    if (this.saveNext) {
      this.saveNext = false;
      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `reality-origami-${this.seed}-${Math.round(feet.x)}-${Math.round(feet.z)}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, "image/png");
    }

    const ground = this.player.ground(feet.x, feet.z);
    this.score.update({
      dt,
      realmA: mix.a,
      realmB: mix.b,
      realmBlend: mix.t,
      speed: this.player.speed,
      flying: this.player.mode === "fly",
      gliding: this.player.gliding,
      grounded: this.player.grounded,
      planet,
      altitude: Math.max(0, feet.y - ground),
    });

    this.statsClock += frameMs;
    if (this.statsClock > 400) {
      this.statsClock = 0;
      if (this.statsOn) {
        const { width, height } = this.world.post;
        const name = REALM_LOOKS[mix.t < 0.5 ? mix.a : mix.b]!.name;
        this.hud.setStats(`${Math.round(1000 / this.frameMsEma)} fps   ${width} x ${height}   ${(this.world.splatCount / 1e6).toFixed(2)} M splats\n${name}   x ${feet.x.toFixed(0)}  z ${feet.z.toFixed(0)}\nspeed ${this.player.speed.toFixed(1)} m/s   ${this.quality}`);
      }
    }
  }

  /** Starts the thunder of a flash once, unless the clock has already moved well past it. */
  private followWithThunder({ flash }: Lightning): void {
    if (!flash || flash.id === this.thunderFor || this.time < flash.start || this.time - flash.start > 0.4) return;
    this.thunderFor = flash.id;
    this.score.event("thunder", flash.closeness);
  }

  private plantBloom(x: number, z: number, scale: number): void {
    const m = this.terrain.realmAt(x, z);
    this.world.blooms.plant(x, this.player.ground(x, z), z, this.time, m.t < 0.5 ? m.a : m.b, scale);
  }

  /** Chimes when the walker reaches a wonder, and lets a gate be flown through. */
  private trackWonders(dt: number, eye: THREE.Vector3): void {
    this.gateCooldown -= dt;
    this.wonderClock -= dt;
    if (this.wonderClock <= 0) {
      this.wonderClock = 0.4;
      this.nearby = wondersNear(this.terrain, eye.x, eye.z, 3000);
    }
    for (const w of this.nearby) {
      const id = `${w.cx},${w.cz}`;
      const d = Math.hypot(w.x - eye.x, w.z - eye.z);
      if (!this.found.has(id) && this.introAge > 3 && d < (w.kind === "henge" ? w.size * 3 : w.size * 0.9) + 60) {
        this.found.add(id);
        this.score.event("sing");
      }
      if (w.kind === "gate" && d < w.size * 2) this.crossGate(w, id, eye);
    }
  }

  private crossGate(w: Wonder, id: string, eye: THREE.Vector3): void {
    let g = this.gates.get(id);
    if (!g) {
      g = gateFrame(this.terrain, w);
      this.gates.set(id, g);
    }
    const dx = eye.x - g.x;
    const dy = eye.y - g.y;
    const dz = eye.z - g.z;
    const side = dx * g.nx + dz * g.nz;
    const before = this.gateSide.get(id);
    this.gateSide.set(id, side);
    if (before === undefined || Math.sign(before) === Math.sign(side) || Math.abs(before) > 80 || this.gateCooldown > 0) return;
    if (Math.hypot(dx, dy, dz) ** 2 - side * side > (g.radius * 0.88) ** 2) return;
    this.gateCooldown = 3;
    this.powers.ripple();
    this.score.event("ripple");
    this.rings.add({ x: g.x, z: g.z, start: this.time, amplitude: 1, speed: 130, life: 6, radius: 6, width: 14 });
    this.flash = [0.4, this.time];
  }
}

function renderSize(scale: number): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  return { width: Math.max(320, Math.round(window.innerWidth * dpr * scale)), height: Math.max(180, Math.round(window.innerHeight * dpr * scale)) };
}

function startScale(): number {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const pixels = window.innerWidth * window.innerHeight * dpr * dpr;
  return Math.min(1, Math.max(0.5, Math.sqrt(START_PIXELS / pixels)));
}

export { PLANET_RADIUS };
export type { ScoreEvent };
