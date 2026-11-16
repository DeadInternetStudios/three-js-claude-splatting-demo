/** One-shot things the player can ask for. */
export type Action =
  | "fly"
  | "planet"
  | "corkscrew"
  | "hinge"
  | "ripple"
  | "sing"
  | "photo"
  | "help"
  | "mute"
  | "quality"
  | "respawn"
  | "world"
  | "share"
  | "freeze"
  | "save"
  | "stats";

/** What the player asked for since the last frame. */
export interface InputFrame {
  /** Strafe right is positive. */
  moveX: number;
  /** Forward is positive. */
  moveY: number;
  /** Radians to turn right and to look up this frame. */
  turn: number;
  tilt: number;
  run: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  descend: boolean;
  /** Held to fly at warp speed. */
  warp: boolean;
  actions: Action[];
}

const KEY_ACTIONS: Record<string, Action> = {
  f: "fly",
  "1": "planet",
  "2": "corkscrew",
  "3": "hinge",
  "4": "ripple",
  e: "sing",
  p: "photo",
  h: "help",
  "?": "help",
  m: "mute",
  q: "quality",
  r: "respawn",
  n: "world",
  g: "share",
  t: "freeze",
  o: "save",
  F3: "stats",
};

/**
 * Keys that act by where they sit and not by the letter on them. The walking cluster is ZQSD on a
 * French keyboard, and the number row reaches 1 to 4 only with Shift held there, which is also run.
 */
const BY_POSITION: Record<string, string> = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
};

/** The name a key goes by while held and in `KEY_ACTIONS`. Shift does not change it. */
export function keyName(e: Pick<KeyboardEvent, "key" | "code">): string {
  return BY_POSITION[e.code] ?? (e.key.length === 1 ? e.key.toLowerCase() : e.key);
}

const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_SENSITIVITY = 0.0042;
const KEY_TURN_RATE = 1.9;
const STICK_RADIUS = 58;

interface Stick {
  id: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

/**
 * Keyboard, mouse and touch folded into one frame of intent. Mouse look uses pointer lock where the
 * browser allows it and falls back to dragging. On touch screens the left half of the screen is a
 * floating stick and the right half turns the view.
 */
export class Input {
  private readonly keys = new Set<string>();
  private readonly pending: Action[] = [];
  private turnAccum = 0;
  private tiltAccum = 0;
  private jumpPressed = false;
  private stick: Stick | null = null;
  private look: { id: number; x: number; y: number } | null = null;
  private dragging: { id: number; x: number; y: number } | null = null;
  private touchJump = false;
  private touchDescend = false;
  /** True once a touch has been seen, so the interface can show touch controls. */
  touchSeen = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFirstGesture: () => void,
  ) {
    this.bindKeys();
    this.bindMouse();
    this.bindTouch();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** The thumb stick as an offset from where it was touched, in pixels, for drawing. */
  get stickOffset(): { originX: number; originY: number; x: number; y: number } | null {
    return this.stick ? { originX: this.stick.originX, originY: this.stick.originY, x: this.stick.x, y: this.stick.y } : null;
  }

  trigger(action: Action): void {
    this.pending.push(action);
  }

  setTouchJump(down: boolean): void {
    if (down && !this.touchJump) this.jumpPressed = true;
    this.touchJump = down;
  }

  setTouchDescend(down: boolean): void {
    this.touchDescend = down;
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      const key = keyName(e);
      this.onFirstGesture();
      if (key === " ") {
        e.preventDefault();
        if (!this.keys.has(" ")) this.jumpPressed = true;
      }
      if (key.startsWith("Arrow") || key === "Tab") e.preventDefault();
      if (e.repeat) {
        this.keys.add(key);
        return;
      }
      this.keys.add(key);
      const action = KEY_ACTIONS[key];
      if (action) this.pending.push(action);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(keyName(e));
    });
    window.addEventListener("blur", () => this.keys.clear());
  }

  private bindMouse(): void {
    const { canvas } = this;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      this.onFirstGesture();
      if (e.pointerType === "mouse" && e.button === 0) {
        this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        if (!this.pointerLocked) void canvas.requestPointerLock?.()?.catch?.(() => undefined);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      if (this.pointerLocked) {
        this.turnAccum += e.movementX * MOUSE_SENSITIVITY;
        this.tiltAccum -= e.movementY * MOUSE_SENSITIVITY;
      } else if (this.dragging && this.dragging.id === e.pointerId) {
        this.turnAccum += (e.clientX - this.dragging.x) * MOUSE_SENSITIVITY;
        this.tiltAccum -= (e.clientY - this.dragging.y) * MOUSE_SENSITIVITY;
        this.dragging.x = e.clientX;
        this.dragging.y = e.clientY;
      }
    });
    const release = (e: PointerEvent): void => {
      if (this.dragging?.id === e.pointerId) this.dragging = null;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  private bindTouch(): void {
    const { canvas } = this;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      this.touchSeen = true;
      this.onFirstGesture();
      canvas.setPointerCapture(e.pointerId);
      if (e.clientX < window.innerWidth * 0.5 && !this.stick) {
        this.stick = { id: e.pointerId, originX: e.clientX, originY: e.clientY, x: 0, y: 0 };
      } else if (!this.look) {
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "touch") return;
      if (this.stick && this.stick.id === e.pointerId) {
        const dx = e.clientX - this.stick.originX;
        const dy = e.clientY - this.stick.originY;
        const len = Math.hypot(dx, dy);
        const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
        this.stick.x = dx * k;
        this.stick.y = dy * k;
      } else if (this.look && this.look.id === e.pointerId) {
        this.turnAccum += (e.clientX - this.look.x) * TOUCH_SENSITIVITY;
        this.tiltAccum -= (e.clientY - this.look.y) * TOUCH_SENSITIVITY;
        this.look.x = e.clientX;
        this.look.y = e.clientY;
      }
    });
    const release = (e: PointerEvent): void => {
      if (this.stick?.id === e.pointerId) this.stick = null;
      if (this.look?.id === e.pointerId) this.look = null;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  /** Reads and clears everything that happened since the last call. */
  poll(dt: number): InputFrame {
    const k = this.keys;
    const held = (...names: string[]): boolean => names.some((n) => k.has(n));
    let moveX = (held("d") ? 1 : 0) - (held("a") ? 1 : 0);
    let moveY = (held("w") ? 1 : 0) - (held("s") ? 1 : 0);
    if (this.stick) {
      moveX += this.stick.x / STICK_RADIUS;
      moveY -= this.stick.y / STICK_RADIUS;
    }
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const turnKeys = (held("ArrowRight") ? 1 : 0) - (held("ArrowLeft") ? 1 : 0);
    const tiltKeys = (held("ArrowUp") ? 1 : 0) - (held("ArrowDown") ? 1 : 0);
    const frame: InputFrame = {
      moveX,
      moveY,
      turn: this.turnAccum + turnKeys * KEY_TURN_RATE * dt,
      tilt: this.tiltAccum + tiltKeys * KEY_TURN_RATE * dt * 0.7,
      run: held("Shift") || (this.stick !== null && Math.hypot(this.stick.x, this.stick.y) > STICK_RADIUS * 0.92),
      jumpHeld: held(" ") || this.touchJump,
      jumpPressed: this.jumpPressed,
      descend: held("c", "Control") || this.touchDescend,
      warp: held("b"),
      actions: this.pending.splice(0),
    };
    this.turnAccum = 0;
    this.tiltAccum = 0;
    this.jumpPressed = false;
    return frame;
  }
}

export const isTouchDevice = (): boolean => window.matchMedia("(pointer: coarse)").matches;
