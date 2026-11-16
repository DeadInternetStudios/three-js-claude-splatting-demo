import * as THREE from "three";
import type { Terrain } from "../world/cpu/terrain.ts";
import type { InputFrame } from "./input.ts";

export type Locomotion = "walk" | "fly";

export type PlayerEvent =
  | { kind: "step"; x: number; z: number; strength: number }
  | { kind: "jump" }
  | { kind: "land"; speed: number }
  | { kind: "mode"; mode: Locomotion };

export const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.6;
const RUN_SPEED = 11;
const FLY_SPEED = 30;
const FLY_FAST = 130;
const WARP_SPEED = 520;
const JUMP_SPEED = 6.8;
const GRAVITY = 19;
const GLIDE_SPEED = 16;
const DOUBLE_TAP = 0.32;
/** Flight stops here. Higher up, the far edge of the ground comes out of the haze and the world ends in a square. */
export const FLIGHT_CEILING = 4500;
/** A climb slows from this height up to the ceiling. */
const CEILING_EASE = 3500;
/** Cell size of the finest ground ring, which is the surface the walker stands on. */
const FOOT_CELL = 0.9;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const WANT = new THREE.Vector3();

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * The walker. It stands on the same facets the GPU draws, runs, jumps, glides on a held jump and
 * flies. `floaty` from 0 to 1 loosens gravity for places like the sea.
 */
export class Player {
  readonly feet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  mode: Locomotion = "walk";
  grounded = true;
  gliding = false;
  fov = 68;
  /** Metres per second over the ground. */
  speed = 0;

  private eyeY = 0;
  private bobPhase = 0;
  private stepDistance = 0;
  private leftFoot = false;
  private sinceJump = 10;
  private turnRate = 0;

  constructor(private terrain: Terrain) {}

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
  }

  ground(x: number, z: number): number {
    return this.terrain.facetHeight(x, z, FOOT_CELL);
  }

  place(x: number, z: number, yaw: number, pitch = 0): void {
    this.feet.set(x, this.ground(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = 0;
    this.mode = "walk";
    this.grounded = true;
    this.gliding = false;
    this.eyeY = this.feet.y + EYE_HEIGHT;
  }

  toggleFly(): PlayerEvent {
    this.mode = this.mode === "fly" ? "walk" : "fly";
    this.gliding = false;
    if (this.mode === "walk") this.grounded = false;
    return { kind: "mode", mode: this.mode };
  }

  update(dt: number, input: InputFrame, floaty: number): PlayerEvent[] {
    const events: PlayerEvent[] = [];
    this.sinceJump += dt;
    this.yaw -= input.turn;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch + input.tilt));
    this.turnRate += (input.turn / Math.max(dt, 1e-3) - this.turnRate) * damp(10, dt);

    FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (input.jumpPressed && this.mode === "walk" && !this.grounded && this.sinceJump < DOUBLE_TAP) events.push(this.toggleFly());
    else if (input.jumpPressed) this.sinceJump = 0;

    if (this.mode === "fly") this.flyStep(dt, input);
    else this.walkStep(dt, input, floaty, events);

    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = horizontal;
    this.animateCamera(dt, input, horizontal);
    return events;
  }

  private flyStep(dt: number, input: InputFrame): void {
    const cp = Math.cos(this.pitch);
    const look = WANT.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const top = input.warp ? WARP_SPEED : input.run ? FLY_FAST : FLY_SPEED;
    const vx = look.x * input.moveY + RIGHT.x * input.moveX;
    const lift = look.y * input.moveY + ((input.jumpHeld ? 1 : 0) - (input.descend ? 1 : 0)) * 0.7;
    const vy = lift > 0 ? lift * (1 - THREE.MathUtils.smoothstep(this.feet.y, CEILING_EASE, FLIGHT_CEILING)) : lift;
    const vz = look.z * input.moveY + RIGHT.z * input.moveX;
    const k = damp(input.warp ? 1.4 : 2.8, dt);
    this.velocity.x += (vx * top - this.velocity.x) * k;
    this.velocity.y += (vy * top - this.velocity.y) * k;
    this.velocity.z += (vz * top - this.velocity.z) * k;
    this.feet.addScaledVector(this.velocity, dt);
    if (this.feet.y > FLIGHT_CEILING) {
      this.feet.y = FLIGHT_CEILING;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
    const floor = this.ground(this.feet.x, this.feet.z) + 0.5;
    if (this.feet.y < floor) {
      this.feet.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    this.grounded = false;
    this.gliding = false;
  }

  private walkStep(dt: number, input: InputFrame, floaty: number, events: PlayerEvent[]): void {
    const gravity = GRAVITY * (1 - 0.7 * floaty);
    const jump = JUMP_SPEED * (1 + 0.28 * floaty);
    const top = (input.run ? RUN_SPEED : WALK_SPEED) * (1 - 0.15 * floaty);
    if (this.grounded && input.jumpPressed) {
      this.velocity.y = jump;
      this.grounded = false;
      events.push({ kind: "jump" });
    }

    this.gliding = !this.grounded && input.jumpHeld && this.velocity.y <= 1 && this.sinceJump > 0.18;
    const wantX = FORWARD.x * input.moveY + RIGHT.x * input.moveX;
    const wantZ = FORWARD.z * input.moveY + RIGHT.z * input.moveX;
    let targetX = wantX * top;
    let targetZ = wantZ * top;
    let accel = this.grounded ? 55 : 7;
    if (this.gliding) {
      const dive = Math.max(0, -Math.sin(this.pitch));
      const glide = GLIDE_SPEED + 12 * dive;
      targetX = -Math.sin(this.yaw) * glide + RIGHT.x * input.moveX * 5;
      targetZ = -Math.cos(this.yaw) * glide + RIGHT.z * input.moveX * 5;
      accel = 14;
      const lift = Math.max(0, Math.sin(this.pitch));
      const sink = (2.3 + 8 * dive - 3.2 * lift) * (1 - 0.6 * floaty);
      this.velocity.y += (-sink - this.velocity.y) * damp(3, dt);
    } else if (!this.grounded) {
      this.velocity.y -= gravity * dt;
    }
    const dx = targetX - this.velocity.x;
    const dz = targetZ - this.velocity.z;
    const dl = Math.hypot(dx, dz);
    const maxStep = accel * dt;
    const f = dl > maxStep ? maxStep / dl : 1;
    this.velocity.x += dx * f;
    this.velocity.z += dz * f;

    this.feet.x += this.velocity.x * dt;
    this.feet.z += this.velocity.z * dt;
    this.feet.y += this.velocity.y * dt;
    const under = this.ground(this.feet.x, this.feet.z);
    if (this.feet.y <= under + 1e-3 && this.velocity.y <= 0) {
      if (!this.grounded && this.velocity.y < -5.5) events.push({ kind: "land", speed: -this.velocity.y });
      this.feet.y = under;
      this.velocity.y = 0;
      this.grounded = true;
      this.gliding = false;
    } else if (this.grounded) {
      if (this.feet.y - under > 0.45) this.grounded = false;
      else this.feet.y = under;
    } else if (this.feet.y < under) {
      this.feet.y = under;
    }

    if (this.grounded) {
      const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
      this.stepDistance += horizontal * dt;
      const stride = input.run ? 3.1 : 2.1;
      if (this.stepDistance >= stride && horizontal > 0.8) {
        this.stepDistance = 0;
        this.leftFoot = !this.leftFoot;
        const side = this.leftFoot ? -0.22 : 0.22;
        events.push({ kind: "step", x: this.feet.x + RIGHT.x * side, z: this.feet.z + RIGHT.z * side, strength: Math.min(1, horizontal / RUN_SPEED) });
      }
    }
  }

  private animateCamera(dt: number, input: InputFrame, horizontal: number): void {
    const flying = this.mode === "fly" || this.gliding;
    const follow = this.grounded ? 18 : 60;
    const bobbing = this.grounded && this.mode === "walk" ? Math.min(1, horizontal / WALK_SPEED) : 0;
    this.bobPhase += horizontal * dt * (input.run ? 1.15 : 1.5) * bobbing;
    const bob = Math.sin(this.bobPhase * 2) * 0.035 * bobbing;
    this.eyeY += (this.feet.y + EYE_HEIGHT + bob - this.eyeY) * damp(follow, dt);
    const lean = flying ? 0.26 : 0.045;
    const target = THREE.MathUtils.clamp(-this.turnRate * 0.09 * (flying ? 2.4 : 1) - input.moveX * lean, -0.5, 0.5);
    this.roll += (target - this.roll) * damp(5, dt);
    const boost = this.mode === "fly" ? Math.min(1, horizontal / FLY_FAST) * 22 : this.gliding ? 7 : input.run ? 4 : 0;
    this.fov += (68 + boost - this.fov) * damp(4, dt);
  }

  /** Camera position and orientation, before any fold-driven lift. */
  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.feet.x, this.eyeY, this.feet.z);
  }

  orientation(out: THREE.Quaternion, pitchOffset = 0): THREE.Quaternion {
    return out.setFromEuler(new THREE.Euler(this.pitch + pitchOffset, this.yaw, this.roll, "YXZ"));
  }
}
