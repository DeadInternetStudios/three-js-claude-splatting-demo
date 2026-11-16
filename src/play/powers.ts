import { noFolds, RIPPLE_LIFE, type FoldAmounts } from "../world/folds.ts";

export type Toggle = "planet" | "corkscrew" | "hinge";

interface Spring {
  value: number;
  velocity: number;
  target: number;
  omega: number;
}

const OMEGA = 3.1;

/** The fold powers the player switches on and off. Each eases in and out like a settling spring. */
export class FoldPowers {
  private readonly springs: Record<Toggle, Spring> = {
    planet: { value: 0, velocity: 0, target: 0, omega: OMEGA },
    corkscrew: { value: 0, velocity: 0, target: 0, omega: OMEGA },
    hinge: { value: 0, velocity: 0, target: 0, omega: OMEGA },
  };
  private rippleAge: number | null = null;

  /** Flips a power and tells whether it is now on. */
  toggle(name: Toggle): boolean {
    const spring = this.springs[name];
    spring.target = spring.target > 0.5 ? 0 : 1;
    spring.omega = OMEGA;
    return spring.target > 0.5;
  }

  /** Begins a power at `value`, easing toward off at the given stiffness. Used for the opening. */
  startFrom(name: Toggle, value: number, omega: number): void {
    const spring = this.springs[name];
    spring.value = value;
    spring.velocity = 0;
    spring.target = 0;
    spring.omega = omega;
  }

  isOn(name: Toggle): boolean {
    return this.springs[name].target > 0.5;
  }

  set(name: Toggle, target: number): void {
    this.springs[name].target = target;
  }

  /** Starts a ripple from the walker. A new one replaces the one in flight. */
  ripple(): void {
    this.rippleAge = 0;
  }

  get rippling(): boolean {
    return this.rippleAge !== null;
  }

  reset(): void {
    for (const s of Object.values(this.springs)) {
      s.value = 0;
      s.velocity = 0;
      s.target = 0;
      s.omega = OMEGA;
    }
    this.rippleAge = null;
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    for (const s of Object.values(this.springs)) {
      // Critically damped: x'' = w^2 (target - x) - 2 w x'.
      const accel = s.omega * s.omega * (s.target - s.value) - 2 * s.omega * s.velocity;
      s.velocity += accel * step;
      s.value += s.velocity * step;
      if (Math.abs(s.value - s.target) < 1e-3 && Math.abs(s.velocity) < 1e-3) {
        s.value = s.target;
        s.velocity = 0;
        s.omega = OMEGA;
      }
    }
    if (this.rippleAge !== null) {
      this.rippleAge += dt;
      if (this.rippleAge > RIPPLE_LIFE) this.rippleAge = null;
    }
  }

  get amounts(): FoldAmounts {
    const a = noFolds();
    a.planet = Math.min(1, Math.max(0, this.springs.planet.value));
    a.corkscrew = Math.min(1, Math.max(0, this.springs.corkscrew.value));
    a.hinge = Math.min(1, Math.max(0, this.springs.hinge.value));
    a.rippleAge = this.rippleAge;
    return a;
  }
}
