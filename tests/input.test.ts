import { describe, expect, it } from "vitest";
import { keyName } from "../src/play/input.ts";

describe("keyName", () => {
  it("names the walking keys by position, so ZQSD on a French keyboard walks", () => {
    expect(keyName({ key: "z", code: "KeyW" })).toBe("w");
    expect(keyName({ key: "q", code: "KeyA" })).toBe("a");
    expect(keyName({ key: "s", code: "KeyS" })).toBe("s");
    expect(keyName({ key: "d", code: "KeyD" })).toBe("d");
    expect(keyName({ key: "W", code: "KeyW" })).toBe("w");
  });

  it("names the number row by position, with Shift held or not", () => {
    expect(keyName({ key: "&", code: "Digit1" })).toBe("1");
    expect(keyName({ key: "!", code: "Digit1" })).toBe("1");
    expect(keyName({ key: "$", code: "Digit4" })).toBe("4");
  });

  it("does not let a letter shortcut take a walking key on another layout", () => {
    expect(keyName({ key: "q", code: "KeyA" })).not.toBe("q");
    expect(keyName({ key: "e", code: "KeyD" })).not.toBe("e");
  });

  it("names every other key by the letter on it", () => {
    expect(keyName({ key: "M", code: "Semicolon" })).toBe("m");
    expect(keyName({ key: "f", code: "KeyF" })).toBe("f");
    expect(keyName({ key: " ", code: "Space" })).toBe(" ");
    expect(keyName({ key: "Shift", code: "ShiftLeft" })).toBe("Shift");
    expect(keyName({ key: "F3", code: "F3" })).toBe("F3");
    expect(keyName({ key: "ArrowUp", code: "ArrowUp" })).toBe("ArrowUp");
  });

  it("falls back to the letter when an event carries no code", () => {
    expect(keyName({ key: "W", code: "" })).toBe("w");
    expect(keyName({ key: "1", code: "" })).toBe("1");
  });
});
