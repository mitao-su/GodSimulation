// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const pixi = vi.hoisted(() => {
  const applications: FakeApplication[] = [];

  class FakeApplication {
    readonly canvas = document.createElement("canvas");
    readonly stage = { addChild: vi.fn() };
    readonly screen = { width: 320, height: 240 };
    readonly init = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          this.completeInitialization = () => {
            this.initialized = true;
            resolve();
          };
        }),
    );
    readonly destroy = vi.fn(() => {
      if (!this.initialized) throw new Error("Application.destroy called before init completed");
    });
    initialized = false;
    completeInitialization = () => undefined;

    constructor() {
      applications.push(this);
    }
  }

  class FakeContainer {
    readonly scale = { set: vi.fn() };
    readonly position = { set: vi.fn() };
    readonly addChild = vi.fn();

    removeChildren(): [] {
      return [];
    }
  }

  return { applications, FakeApplication, FakeContainer };
});

vi.mock("pixi.js", () => ({
  AnimatedSprite: class {},
  Application: pixi.FakeApplication,
  Assets: { load: vi.fn() },
  Container: pixi.FakeContainer,
  Rectangle: class {},
  Sprite: class {},
  Texture: class {},
}));

import { PixiWorldRenderer } from "./pixi-world-renderer";

describe("PixiWorldRenderer lifecycle", () => {
  it("waits for Pixi initialization before destroying an unmounted renderer", async () => {
    const host = document.createElement("div");
    const renderer = new PixiWorldRenderer({ host, onSelect: () => undefined });
    const application = pixi.applications.at(-1);
    if (!application) throw new Error("Expected the renderer to create a Pixi application");

    const initialization = renderer.initialize();

    expect(() => renderer.destroy()).not.toThrow();
    expect(application.destroy).not.toHaveBeenCalled();

    application.completeInitialization();
    await initialization;

    expect(application.destroy).toHaveBeenCalledOnce();
    expect(host.childElementCount).toBe(0);
  });
});
