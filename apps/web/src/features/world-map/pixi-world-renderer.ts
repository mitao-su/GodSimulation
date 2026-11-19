import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";

import {
  parseAssetCatalog,
  type AssetAnchor,
  type AssetCatalog,
  type AssetFrame,
  type CharacterSheet,
} from "./asset-catalog";
import { projectWorldView, type RenderEntity } from "./render-projection";
import type { WorldView } from "@god-sim/protocol";

const homeManifestUrl = new URL(
  "../../../../../plugins/home-objects/assets/asset-manifest.json",
  import.meta.url,
).href;
const animationManifestUrl = new URL(
  "../../../../../plugins/starter-agents/assets/animation-manifest.json",
  import.meta.url,
).href;

const sheetUrls: Readonly<Record<string, string>> = {
  "modern-pixel.tiles": new URL(
    "../../../../../plugins/home-objects/assets/modern-pixel/tiles.png",
    import.meta.url,
  ).href,
  "modern-pixel.furniture": new URL(
    "../../../../../plugins/home-objects/assets/modern-pixel/furniture.png",
    import.meta.url,
  ).href,
  "modern-pixel.textiles": new URL(
    "../../../../../plugins/home-objects/assets/modern-pixel/textiles.png",
    import.meta.url,
  ).href,
  "modern-pixel.alice": new URL(
    "../../../../../plugins/starter-agents/assets/modern-pixel/alice.png",
    import.meta.url,
  ).href,
  "modern-pixel.bob": new URL(
    "../../../../../plugins/starter-agents/assets/modern-pixel/bob.png",
    import.meta.url,
  ).href,
};

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset manifest request failed with HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function loadCatalog(): Promise<AssetCatalog> {
  const [assetManifest, animationManifest] = await Promise.all([
    readJson(homeManifestUrl),
    readJson(animationManifestUrl),
  ]);
  return parseAssetCatalog(assetManifest, animationManifest);
}

export interface PixiWorldRendererOptions {
  readonly host: HTMLElement;
  readonly onSelect: (entityId: string) => void;
}

interface WorldSprite {
  readonly sprite: Sprite;
  readonly imageKey: string;
}

interface MapDrag {
  readonly pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

const mapInset = 12;

export class PixiWorldRenderer {
  readonly #host: HTMLElement;
  readonly #onSelect: (entityId: string) => void;
  readonly #app = new Application();
  readonly #worldLayer = new Container();
  readonly #baseTextures = new Map<string, Texture>();
  readonly #frameTextures = new Map<string, Texture>();
  readonly #sprites = new Map<string, WorldSprite>();
  #catalog: AssetCatalog | null = null;
  #lastView: WorldView | null = null;
  #resizeObserver: ResizeObserver | null = null;
  readonly #input = new AbortController();
  #zoom = 1;
  #cellSize = 1;
  #center: { readonly x: number; readonly y: number } | null = null;
  #drag: MapDrag | null = null;
  #initialized = false;
  #destroyed = false;

  constructor(options: PixiWorldRendererOptions) {
    this.#host = options.host;
    this.#onSelect = options.onSelect;
  }

  async initialize(): Promise<void> {
    await this.#app.init({
      antialias: false,
      autoDensity: true,
      background: "#20222b",
      preference: "webgl",
      preserveDrawingBuffer: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, 3),
      resizeTo: this.#host,
    });
    this.#initialized = true;
    if (this.#destroyed) {
      this.#destroyApplication();
      return;
    }
    this.#host.appendChild(this.#app.canvas);
    this.#updateTouchAction();
    const inputOptions = { signal: this.#input.signal };
    this.#app.canvas.addEventListener("pointerdown", this.#beginDrag, inputOptions);
    this.#app.canvas.addEventListener("pointermove", this.#moveDrag, inputOptions);
    this.#app.canvas.addEventListener("pointerup", this.#endDrag, inputOptions);
    this.#app.canvas.addEventListener("pointercancel", this.#endDrag, inputOptions);
    this.#app.canvas.addEventListener("lostpointercapture", this.#endDrag, inputOptions);
    this.#app.canvas.addEventListener("pointerleave", this.#leaveCanvas, inputOptions);
    this.#host.addEventListener("keydown", this.#handlePanKey, inputOptions);
    this.#worldLayer.sortableChildren = true;
    this.#app.stage.addChild(this.#worldLayer);
    this.#resizeObserver = new ResizeObserver(() => this.#layoutLastView());
    this.#resizeObserver.observe(this.#host);
    const catalog = await loadCatalog();
    if (this.#destroyed) return;
    const allSheets = [
      ...catalog.sheets.values(),
      ...catalog.characterSheets.values(),
    ];
    const textures = await Promise.all(
      allSheets.map(async (sheet) => {
        const url = sheetUrls[sheet.id];
        if (!url) throw new Error(`No runtime URL for asset sheet ${sheet.id}`);
        const texture = (await Assets.load({
          src: url,
          data: {
            autoGenerateMipmaps: true,
            magFilter: "nearest",
            minFilter: "linear",
            mipmapFilter: "linear",
          },
        })) as Texture;
        return [sheet.id, texture] as const;
      }),
    );
    if (this.#destroyed) return;
    for (const [id, texture] of textures) this.#baseTextures.set(id, texture);
    this.#catalog = catalog;
  }

  render(view: WorldView): void {
    const catalog = this.#catalog;
    if (!catalog) throw new Error("World renderer is not initialized");
    this.#lastView = view;
    const projected = projectWorldView(view, catalog.staticResources);
    const visible = new Set(projected.map(({ entityId }) => entityId));
    for (const [id, entry] of this.#sprites) {
      if (visible.has(id)) continue;
      entry.sprite.destroy();
      this.#sprites.delete(id);
    }
    for (const [index, entity] of projected.entries()) {
      const imageKey = entity.kind === "agent"
        ? `${entity.resourceId}:${entity.animationId}:${entity.facing}`
        : `${entity.resourceId}:${entity.frameId}`;
      let entry = this.#sprites.get(entity.entityId);
      if (entry?.imageKey !== imageKey) {
        const sprite = this.#createDisplay(entity, catalog);
        entry?.sprite.destroy();
        entry = { sprite, imageKey };
        this.#sprites.set(entity.entityId, entry);
        this.#worldLayer.addChild(sprite);
      }
      entry.sprite.zIndex = index;
      const gridAnchor = catalog.staticResources.get(entity.resourceId)?.gridAnchor ?? entry.sprite.anchor;
      this.#place(entry.sprite, entity, catalog.pixelsPerTile, gridAnchor);
    }

    this.#resizeAndLayout(view, catalog.pixelsPerTile);
  }

  setZoom(zoom: number): void {
    if (zoom === this.#zoom) return;
    this.#zoom = zoom;
    if (zoom === 1) this.#center = null;
    this.#updateTouchAction();
    this.#layoutLastView();
  }

  #updateTouchAction(): void {
    if (!this.#initialized || this.#destroyed) return;
    this.#app.canvas.style.touchAction = this.#zoom === 1 ? "pan-y" : "none";
  }

  #layoutLastView(): void {
    if (!this.#lastView || !this.#catalog || this.#destroyed) return;
    this.#resizeAndLayout(this.#lastView, this.#catalog.pixelsPerTile);
  }

  #resizeAndLayout(view: WorldView, pixelsPerTile: number): void {
    const hostWidth = Math.max(1, Math.round(this.#host.clientWidth));
    const hostHeight = Math.max(1, Math.round(this.#host.clientHeight));
    if (this.#app.screen.width !== hostWidth || this.#app.screen.height !== hostHeight) {
      this.#app.renderer.resize(hostWidth, hostHeight);
    }

    const availableWidth = Math.max(1, hostWidth - 2 * mapInset);
    const availableHeight = Math.max(1, hostHeight - 2 * mapInset);
    const fitCell = Math.min(availableWidth / view.map.width, availableHeight / view.map.height);
    const resolution = this.#app.renderer.resolution;
    // 每格对齐设备像素，窄屏仍可使用整个舞台。
    const cell = Math.max(1, Math.floor(fitCell * this.#zoom * resolution)) / resolution;
    this.#cellSize = cell;
    const centerX = this.#center?.x ?? view.map.width / 2;
    const centerY = this.#center?.y ?? view.map.height / 2;
    const clampCenter = (center: number, cells: number, viewport: number): number => {
      const marginInCells = Math.min(cells / 2, Math.max(0, viewport / 2 - mapInset) / cell);
      return Math.min(cells - marginInCells, Math.max(marginInCells, center));
    };
    const x = clampCenter(centerX, view.map.width, hostWidth);
    const y = clampCenter(centerY, view.map.height, hostHeight);
    if (this.#zoom !== 1) this.#center = { x, y };
    this.#worldLayer.scale.set(cell / pixelsPerTile);
    this.#worldLayer.position.set(
      Math.round((hostWidth / 2 - x * cell) * resolution) / resolution,
      Math.round((hostHeight / 2 - y * cell) * resolution) / resolution,
    );
  }

  #panBy(dx: number, dy: number): void {
    if (this.#zoom === 1 || !this.#center) return;
    this.#center = {
      x: this.#center.x - dx / this.#cellSize,
      y: this.#center.y - dy / this.#cellSize,
    };
    this.#layoutLastView();
  }

  readonly #handlePanKey = (event: KeyboardEvent): void => {
    if (this.#zoom === 1) return;
    const step = this.#cellSize / 2;
    switch (event.key) {
      case "ArrowLeft": this.#panBy(step, 0); break;
      case "ArrowRight": this.#panBy(-step, 0); break;
      case "ArrowUp": this.#panBy(0, step); break;
      case "ArrowDown": this.#panBy(0, -step); break;
      default: return;
    }
    event.preventDefault();
  };

  readonly #beginDrag = (event: PointerEvent): void => {
    if (this.#zoom === 1 || !event.isPrimary || event.button !== 0 || this.#drag) return;
    this.#drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };

  readonly #moveDrag = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      this.#app.canvas.setPointerCapture(event.pointerId);
      this.#host.dataset.dragging = "true";
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    this.#panBy(dx, dy);
  };

  readonly #endDrag = (event: PointerEvent): void => {
    if (this.#drag?.pointerId !== event.pointerId) return;
    this.#drag = null;
    delete this.#host.dataset.dragging;
  };

  readonly #leaveCanvas = (event: PointerEvent): void => {
    if (!this.#drag?.moved) this.#endDrag(event);
  };

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#input.abort();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (!this.#initialized) return;
    this.#destroyApplication();
  }

  #destroyApplication(): void {
    this.#app.destroy({ removeView: true }, { children: true });
    this.#sprites.clear();
    for (const texture of this.#frameTextures.values()) texture.destroy(false);
    this.#frameTextures.clear();
  }

  #createDisplay(entity: RenderEntity, catalog: AssetCatalog): Sprite {
    if (entity.kind === "agent") return this.#createCharacter(entity, catalog);
    const resource = catalog.staticResources.get(entity.resourceId);
    if (!resource) throw new Error(`Missing static resource ${entity.resourceId}`);
    const frame =
      (entity.frameId ? resource.frames[entity.frameId] : undefined) ?? resource.frames.default;
    if (!frame) {
      throw new Error(
        `Resource ${entity.resourceId} has no frame ${entity.frameId ?? "default"}`,
      );
    }
    const sprite = new Sprite({
      texture: this.#texture(frame),
      anchor: resource.anchor,
      roundPixels: true,
    });
    this.#makeSelectable(sprite, entity);
    return sprite;
  }

  #createCharacter(entity: RenderEntity, catalog: AssetCatalog): AnimatedSprite {
    const resource = catalog.characterResources.get(entity.resourceId);
    if (!resource) throw new Error(`Missing character resource ${entity.resourceId}`);
    const sheet = catalog.characterSheets.get(resource.sheetId);
    const animationSet = catalog.animationSets.get(resource.animationSetId);
    if (!sheet || !animationSet) throw new Error(`Incomplete character resource ${entity.resourceId}`);
    const animationId = entity.animationId ?? "idle";
    const animation = animationSet.animations[animationId] ?? animationSet.animations.idle;
    const frameIndices = animation?.[entity.facing];
    if (!frameIndices) {
      throw new Error(`Missing ${animationId}.${entity.facing} for ${entity.resourceId}`);
    }
    const textures = frameIndices.map((frameIndex) =>
      this.#characterTexture(sheet, frameIndex),
    );
    const sprite = new AnimatedSprite({
      textures,
      animationSpeed: 1000 / 60 / animationSet.frameDurationMs,
      anchor: sheet.anchor,
      loop: true,
      roundPixels: true,
    });
    this.#makeSelectable(sprite, entity);
    if (textures.length > 1) sprite.play();
    return sprite;
  }

  #texture(frame: AssetFrame): Texture {
    const key = `${frame.sheetId}:${frame.x}:${frame.y}:${frame.width}:${frame.height}`;
    const existing = this.#frameTextures.get(key);
    if (existing) return existing;
    const base = this.#baseTextures.get(frame.sheetId);
    if (!base) throw new Error(`Asset sheet ${frame.sheetId} is not loaded`);
    const texture = new Texture({
      source: base.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    });
    this.#frameTextures.set(key, texture);
    return texture;
  }

  #characterTexture(sheet: CharacterSheet, frameIndex: number): Texture {
    const maximum = sheet.columns * sheet.rows;
    if (frameIndex < 0 || frameIndex >= maximum) {
      throw new Error(`Frame ${frameIndex} leaves character sheet ${sheet.id}`);
    }
    return this.#texture({
      sheetId: sheet.id,
      x: (frameIndex % sheet.columns) * sheet.frameWidth,
      y: Math.floor(frameIndex / sheet.columns) * sheet.frameHeight,
      width: sheet.frameWidth,
      height: sheet.frameHeight,
    });
  }

  #place(sprite: Sprite, entity: RenderEntity, tileSize: number, anchor: AssetAnchor): void {
    sprite.position.set(
      entity.gridPosition.x * tileSize + anchor.x * tileSize,
      entity.gridPosition.y * tileSize + anchor.y * tileSize,
    );
  }

  #makeSelectable(sprite: Sprite, entity: RenderEntity): void {
    if (!entity.selectable) return;
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", () => {
      if (!this.#drag?.moved) this.#onSelect(entity.entityId);
    });
  }
}
