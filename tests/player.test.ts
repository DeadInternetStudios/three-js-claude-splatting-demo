import { describe, expect, it } from "vitest";
import type { InputFrame } from "../src/play/input.ts";
import { FLIGHT_CEILING, Player } from "../src/play/player.ts";
import { createTerrain } from "../src/world/cpu/terrain.ts";

const DT = 1 / 60;

const idle: InputFrame = { moveX: 0, moveY: 0, turn: 0, tilt: 0, run: false, jumpHeld: false, jumpPressed: false, descend: false, warp: false, actions: [] };

function flyer(): Player {
  const player = new Player(createTerrain(1));
  player.place(0, 0, 0);
  player.toggleFly();
  return player;
}

/** Holds `input` for `seconds` and returns the highest the flyer got. */
function hold(player: Player, input: Partial<InputFrame>, seconds: number): number {
  let top = player.feet.y;
  for (let t = 0; t < seconds; t += DT) {
    player.update(DT, { ...idle, ...input }, 0);
    top = Math.max(top, player.feet.y);
  }
  return top;
}

describe("flight", () => {
  it("climbs freely well below the ceiling", () => {
    const player = flyer();
    const start = player.feet.y;
    hold(player, { jumpHeld: true }, 3);
    expect(player.feet.y - start).toBeGreaterThan(40);
  });

  it("never rises past the ceiling, even at warp speed", () => {
    const player = flyer();
    const top = hold(player, { jumpHeld: true, warp: true }, 60);
    expect(top).toBeLessThanOrEqual(FLIGHT_CEILING);
    expect(player.feet.y).toBeGreaterThan(FLIGHT_CEILING - 300);
    expect(player.velocity.y).toBeLessThan(1);
  });

  it("comes back down from the ceiling", () => {
    const player = flyer();
    hold(player, { jumpHeld: true, warp: true }, 60);
    hold(player, { descend: true }, 3);
    expect(player.feet.y).toBeLessThan(FLIGHT_CEILING - 50);
  });
});
