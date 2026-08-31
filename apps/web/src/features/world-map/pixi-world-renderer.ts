import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  Rectangle,
  Sprite,
  Texture,
  type DestroyOptions,
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
  "pixel-16-interiors.tiles": new URL(
    "../../../../../plugins/home-objects/assets/pixel-16-interiors/tiles.png",
    import.meta.url,
  ).href,
  "pixel-16-interiors.furniture": new URL(
    "../../../../../plugins/home-objects/assets/pixel-16-interiors/furniture.png",
    import.meta.url,
  ).href,
  "pixel-16-interiors.carpets": new URL(
    "../../../../../plugins/home-objects/assets/pixel-16-interiors/carpets.png",
    import.meta.url,
  ).href,
  "memao.alice": new URL(
    "../../../../../plugins/starter-agents/assets/memao/alice.png",
    import.meta.url,
  ).href,
  "memao.bob": new URL(
    "../../../../../plugins/starter-agents/assets/memao/bob.png",
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

export class PixiWorldRenderer {
  readonly #host: HTMLElement;
  readonly #onSelect: (entityId: string) => void;
  readonly #app = new Application();
  readonly #worldLayer = new Container();
  readonly #baseTextures = new Map<string, Texture>();
  readonly #frameTextures = new Map<string, Texture>();
  #catalog: AssetCatalog | null = null;
  #lastView: WorldView | null = null;
  #resizeObserver: ResizeObserver | null = null;
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
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      resizeTo: this.#host,
    });
    this.#initialized = true;
    if (this.#destroyed) {
      this.#destroyApplication();
      return;
    }
    this.#host.appendChild(this.#app.canvas);
    this.#app.stage.addChild(this.#worldLayer);
    this.#resizeObserver = new ResizeObserver(() => {
      if (!this.#lastView || !this.#catalog || this.#destroyed) return;
      this.#resizeAndLayout(this.#lastView);
    });
    this.#resizeObserver.observe(this.#host);
    this.#catalog = await loadCatalog();
    const allSheets = [
      ...this.#catalog.sheets.values(),
      ...this.#catalog.characterSheets.values(),
    ];
    await Promise.all(
      allSheets.map(async (sheet) => {
        const url = sheetUrls[sheet.id];
        if (!url) throw new Error(`No runtime URL for asset sheet ${sheet.id}`);
        const texture = (await Assets.load({
          src: url,
          data: { scaleMode: "nearest" },
        })) as Texture;
        texture.source.style.scaleMode = "nearest";
        this.#baseTextures.set(sheet.id, texture);
      }),
    );
  }

  render(view: WorldView): void {
    const catalog = this.#catalog;
    if (!catalog) throw new Error("World renderer is not initialized");
    this.#lastView = view;
    for (const child of this.#worldLayer.removeChildren()) {
      child.destroy({ children: true } satisfies DestroyOptions);
    }
    const projected = projectWorldView(view);
    for (const entity of projected) this.#worldLayer.addChild(this.#createDisplay(entity, catalog));

    this.#resizeAndLayout(view);
  }

  #resizeAndLayout(view: WorldView): void {
    const hostWidth = Math.max(1, Math.round(this.#host.clientWidth));
    const hostHeight = Math.max(1, Math.round(this.#host.clientHeight));
    if (this.#app.screen.width !== hostWidth || this.#app.screen.height !== hostHeight) {
      this.#app.renderer.resize(hostWidth, hostHeight);
    }

    const mapWidth = view.map.width * view.map.tileSize;
    const mapHeight = view.map.height * view.map.tileSize;
    const availableWidth = Math.max(1, this.#app.screen.width - 24);
    const availableHeight = Math.max(1, this.#app.screen.height - 24);
    const fitScale = Math.min(availableWidth / mapWidth, availableHeight / mapHeight);
    const scale = fitScale < 1 ? fitScale : Math.max(1, Math.floor(fitScale));
    this.#worldLayer.scale.set(scale);
    this.#worldLayer.position.set(
      Math.round((this.#app.screen.width - mapWidth * scale) / 2),
      Math.round((this.#app.screen.height - mapHeight * scale) / 2),
    );
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (!this.#initialized) return;
    this.#destroyApplication();
  }

  #destroyApplication(): void {
    this.#app.destroy({ removeView: true }, { children: true });
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
    this.#place(sprite, entity, resource.anchor);
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
    this.#place(sprite, entity, sheet.anchor);
    this.#makeSelectable(sprite, entity);
    sprite.play();
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

  #place(sprite: Sprite, entity: RenderEntity, anchor: AssetAnchor): void {
    const tileSize = 16;
    sprite.position.set(
      entity.gridPosition.x * tileSize + anchor.x * tileSize,
      entity.gridPosition.y * tileSize + anchor.y * tileSize,
    );
  }

  #makeSelectable(sprite: Sprite, entity: RenderEntity): void {
    if (!entity.selectable) return;
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", () => this.#onSelect(entity.entityId));
  }
}
