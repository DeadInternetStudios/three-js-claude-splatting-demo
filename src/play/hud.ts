import type { Action } from "./input.ts";

export interface HudHandlers {
  action(action: Action): void;
  touchJump(down: boolean): void;
  touchDescend(down: boolean): void;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

/** The overlay: the labelled dock, help, photo bar and touch controls. It prints no title or message while the walker travels. */
export class Hud {
  private readonly root = el("hud");
  private readonly statsEl = el("stats");
  private readonly flyHintEl = el("flyhint");
  private readonly helpEl = el("help");
  private readonly stick = el("stick");
  private readonly dockButtons = new Map<string, HTMLButtonElement>();
  private helpOpen = false;

  constructor(handlers: HudHandlers) {
    for (const button of document.querySelectorAll<HTMLButtonElement>("#hud button[data-action]")) {
      const action = button.dataset.action as Action;
      this.dockButtons.set(action, button);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.action(action);
        button.blur();
      });
    }
    const hold = (id: string, set: (down: boolean) => void): void => {
      const b = el(id);
      b.addEventListener("pointerdown", (e) => {
        b.setPointerCapture(e.pointerId);
        set(true);
      });
      const up = (): void => set(false);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
    };
    hold("touch-jump", handlers.touchJump);
    hold("touch-down", handlers.touchDescend);
    el("touch").style.pointerEvents = "none";
    for (const id of ["touch-jump", "touch-down"]) el(id).style.pointerEvents = "auto";
  }

  setTouch(on: boolean): void {
    document.documentElement.classList.toggle("touch", on);
  }

  fail(message: string): void {
    const box = document.getElementById("failure");
    if (!box) return;
    box.hidden = false;
    box.querySelector(".note")!.textContent = message;
  }

  setActive(action: Action, on: boolean): void {
    this.dockButtons.get(action)?.setAttribute("aria-pressed", String(on));
  }

  /** While flying, one line over the dock says what Shift and B do. */
  setFlying(on: boolean): void {
    this.flyHintEl.classList.toggle("show", on);
  }

  setStats(text: string): void {
    this.statsEl.textContent = text;
  }

  setHelp(open: boolean): void {
    this.helpOpen = open;
    this.helpEl.classList.toggle("show", open);
  }

  get helpVisible(): boolean {
    return this.helpOpen;
  }

  setMode(mode: "play" | "photo"): void {
    this.root.dataset.ui = mode === "play" ? "on" : mode;
  }

  /** Draws the touch stick where the finger went down. */
  drawStick(stick: { originX: number; originY: number; x: number; y: number } | null): void {
    if (!stick) {
      this.stick.classList.remove("on");
      return;
    }
    this.stick.classList.add("on");
    this.stick.style.left = `${stick.originX}px`;
    this.stick.style.top = `${stick.originY}px`;
    const knob = this.stick.firstElementChild as HTMLElement;
    knob.style.transform = `translate(${stick.x}px, ${stick.y}px)`;
  }

  photoValues(): { focus: number; blur: number } {
    return { focus: Number(el<HTMLInputElement>("focus").value) / 100, blur: Number(el<HTMLInputElement>("blur").value) / 100 };
  }
}
