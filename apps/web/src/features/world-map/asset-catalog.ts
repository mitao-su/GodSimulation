import type { Facing } from "@god-sim/protocol";

export interface AssetSheet {
  readonly id: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

export interface AssetFrame {
  readonly sheetId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AssetAnchor {
  readonly x: number;
  readonly y: number;
}

export interface StaticAssetResource {
  readonly id: string;
  readonly anchor: AssetAnchor;
  readonly frames: Readonly<Record<string, AssetFrame>>;
}

export interface CharacterSheet extends AssetSheet {
  readonly resourceId: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly anchor: AssetAnchor;
}

export interface CharacterResource {
  readonly resourceId: string;
  readonly sheetId: string;
  readonly animationSetId: string;
}

export interface AnimationSet {
  readonly id: string;
  readonly frameDurationMs: number;
  readonly animations: Readonly<
    Record<string, Readonly<Record<Facing, readonly number[]>>>
  >;
}

export interface AssetCatalog {
  readonly sheets: ReadonlyMap<string, AssetSheet>;
  readonly staticResources: ReadonlyMap<string, StaticAssetResource>;
  readonly characterSheets: ReadonlyMap<string, CharacterSheet>;
  readonly characterResources: ReadonlyMap<string, CharacterResource>;
  readonly animationSets: ReadonlyMap<string, AnimationSet>;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function number(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a number greater than or equal to ${minimum}`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = number(value, label, minimum);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function anchor(value: unknown, label: string): AssetAnchor {
  const parsed = record(value, label);
  const x = number(parsed.x, `${label}.x`);
  const y = number(parsed.y, `${label}.y`);
  if (x > 1 || y > 1) throw new Error(`${label} values must be between 0 and 1`);
  return { x, y };
}

function uniqueSet<T extends { readonly id: string }>(
  target: Map<string, T>,
  value: T,
  label: string,
): void {
  if (target.has(value.id)) throw new Error(`Duplicate ${label}: ${value.id}`);
  target.set(value.id, value);
}

function parseSheet(value: unknown, label: string): AssetSheet {
  const parsed = record(value, label);
  return {
    id: string(parsed.id, `${label}.id`),
    file: string(parsed.file, `${label}.file`),
    width: integer(parsed.width, `${label}.width`, 1),
    height: integer(parsed.height, `${label}.height`, 1),
  };
}

function parseFrame(value: unknown, label: string): AssetFrame {
  const parsed = record(value, label);
  return {
    sheetId: string(parsed.sheetId, `${label}.sheetId`),
    x: integer(parsed.x, `${label}.x`),
    y: integer(parsed.y, `${label}.y`),
    width: integer(parsed.width, `${label}.width`, 1),
    height: integer(parsed.height, `${label}.height`, 1),
  };
}

function assertSchemaVersion(value: UnknownRecord, label: string): void {
  if (value.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
}

const facings: readonly Facing[] = ["north", "east", "south", "west"];

export function parseAssetCatalog(
  assetManifestValue: unknown,
  animationManifestValue: unknown,
): AssetCatalog {
  const assetManifest = record(assetManifestValue, "assetManifest");
  const animationManifest = record(animationManifestValue, "animationManifest");
  assertSchemaVersion(assetManifest, "assetManifest");
  assertSchemaVersion(animationManifest, "animationManifest");

  const sheets = new Map<string, AssetSheet>();
  for (const [index, sheetValue] of array(assetManifest.sheets, "assetManifest.sheets").entries()) {
    uniqueSet(sheets, parseSheet(sheetValue, `assetManifest.sheets[${index}]`), "sheet ID");
  }

  const staticResources = new Map<string, StaticAssetResource>();
  for (const [index, resourceValue] of array(
    assetManifest.resources,
    "assetManifest.resources",
  ).entries()) {
    const parsed = record(resourceValue, `assetManifest.resources[${index}]`);
    const id = string(parsed.id, `assetManifest.resources[${index}].id`);
    const frameValues = record(parsed.frames, `assetManifest.resources[${index}].frames`);
    const frames: Record<string, AssetFrame> = {};
    for (const [frameId, frameValue] of Object.entries(frameValues)) {
      const frame = parseFrame(frameValue, `${id}.frames.${frameId}`);
      const sheet = sheets.get(frame.sheetId);
      if (!sheet) throw new Error(`${id} references missing sheet ${frame.sheetId}`);
      if (frame.x + frame.width > sheet.width || frame.y + frame.height > sheet.height) {
        throw new Error(`${id}.${frameId} leaves sheet ${frame.sheetId}`);
      }
      frames[frameId] = frame;
    }
    uniqueSet(
      staticResources,
      { id, anchor: anchor(parsed.anchor, `${id}.anchor`), frames },
      "static resource ID",
    );
  }

  const characterSheets = new Map<string, CharacterSheet>();
  for (const [index, sheetValue] of array(
    animationManifest.sheets,
    "animationManifest.sheets",
  ).entries()) {
    const parsed = record(sheetValue, `animationManifest.sheets[${index}]`);
    const base = parseSheet(parsed, `animationManifest.sheets[${index}]`);
    const sheet: CharacterSheet = {
      ...base,
      resourceId: string(parsed.resourceId, `${base.id}.resourceId`),
      frameWidth: integer(parsed.frameWidth, `${base.id}.frameWidth`, 1),
      frameHeight: integer(parsed.frameHeight, `${base.id}.frameHeight`, 1),
      columns: integer(parsed.columns, `${base.id}.columns`, 1),
      rows: integer(parsed.rows, `${base.id}.rows`, 1),
      anchor: anchor(parsed.anchor, `${base.id}.anchor`),
    };
    if (
      sheet.frameWidth * sheet.columns !== sheet.width ||
      sheet.frameHeight * sheet.rows !== sheet.height
    ) {
      throw new Error(`Character sheet ${sheet.id} grid does not match its dimensions`);
    }
    uniqueSet(characterSheets, sheet, "character sheet ID");
  }

  const animationSets = new Map<string, AnimationSet>();
  for (const [index, setValue] of array(
    animationManifest.animationSets,
    "animationManifest.animationSets",
  ).entries()) {
    const parsed = record(setValue, `animationManifest.animationSets[${index}]`);
    const id = string(parsed.id, `animationManifest.animationSets[${index}].id`);
    const animations: Record<string, Record<Facing, readonly number[]>> = {};
    for (const [animationId, animationValue] of Object.entries(
      record(parsed.animations, `${id}.animations`),
    )) {
      const directionValues = record(animationValue, `${id}.${animationId}`);
      const directions = {} as Record<Facing, readonly number[]>;
      for (const facing of facings) {
        directions[facing] = array(directionValues[facing], `${id}.${animationId}.${facing}`).map(
          (frame, frameIndex) => integer(frame, `${id}.${animationId}.${facing}[${frameIndex}]`),
        );
        if (directions[facing].length === 0) {
          throw new Error(`${id}.${animationId}.${facing} must contain a frame`);
        }
      }
      animations[animationId] = directions;
    }
    uniqueSet(
      animationSets,
      {
        id,
        frameDurationMs: integer(parsed.frameDurationMs, `${id}.frameDurationMs`, 1),
        animations,
      },
      "animation set ID",
    );
  }

  const characterResources = new Map<string, CharacterResource>();
  for (const [index, resourceValue] of array(
    animationManifest.resources,
    "animationManifest.resources",
  ).entries()) {
    const parsed = record(resourceValue, `animationManifest.resources[${index}]`);
    const resource: CharacterResource = {
      resourceId: string(parsed.resourceId, `animationManifest.resources[${index}].resourceId`),
      sheetId: string(parsed.sheetId, `animationManifest.resources[${index}].sheetId`),
      animationSetId: string(
        parsed.animationSetId,
        `animationManifest.resources[${index}].animationSetId`,
      ),
    };
    if (!characterSheets.has(resource.sheetId)) {
      throw new Error(`${resource.resourceId} references missing sheet ${resource.sheetId}`);
    }
    if (!animationSets.has(resource.animationSetId)) {
      throw new Error(
        `${resource.resourceId} references missing animation set ${resource.animationSetId}`,
      );
    }
    if (characterResources.has(resource.resourceId)) {
      throw new Error(`Duplicate character resource ID: ${resource.resourceId}`);
    }
    characterResources.set(resource.resourceId, resource);
  }

  return { sheets, staticResources, characterSheets, characterResources, animationSets };
}
