import type { Page } from "@playwright/test";

export interface CanvasPixelInspection {
  readonly count: number;
  readonly bottomMargin: number;
  readonly leftMargin: number;
  readonly rightMargin: number;
  readonly topMargin: number;
}

export async function inspectNonBackgroundCanvasPixels(
  page: Page,
): Promise<CanvasPixelInspection> {
  return page.locator("canvas").evaluate((canvas) => {
    const source = canvas as HTMLCanvasElement;
    const scratch = document.createElement("canvas");
    scratch.width = source.width;
    scratch.height = source.height;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to inspect the world canvas");
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
    const backgroundRed = pixels[0]!;
    const backgroundGreen = pixels[1]!;
    const backgroundBlue = pixels[2]!;
    const columnCounts = new Uint32Array(scratch.width);
    const rowCounts = new Uint32Array(scratch.height);
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      const differsFromBackground =
        Math.abs(pixels[index]! - backgroundRed) > 3 ||
        Math.abs(pixels[index + 1]! - backgroundGreen) > 3 ||
        Math.abs(pixels[index + 2]! - backgroundBlue) > 3;
      if (alpha !== 0 && differsFromBackground) {
        const pixelIndex = index / 4;
        const x = pixelIndex % scratch.width;
        const y = Math.floor(pixelIndex / scratch.width);
        count += 1;
        columnCounts[x] = columnCounts[x]! + 1;
        rowCounts[y] = rowCounts[y]! + 1;
      }
    }
    const columnThreshold = Math.max(2, Math.floor(scratch.height * 0.01));
    const rowThreshold = Math.max(2, Math.floor(scratch.width * 0.01));
    const minimumX = columnCounts.findIndex((value) => value >= columnThreshold);
    const minimumY = rowCounts.findIndex((value) => value >= rowThreshold);
    const maximumX = columnCounts.findLastIndex((value) => value >= columnThreshold);
    const maximumY = rowCounts.findLastIndex((value) => value >= rowThreshold);
    const bounds = source.getBoundingClientRect();
    const scaleX = scratch.width / Math.max(1, bounds.width);
    const scaleY = scratch.height / Math.max(1, bounds.height);
    return {
      count,
      bottomMargin: count === 0 ? 0 : (scratch.height - 1 - maximumY) / scaleY,
      leftMargin: count === 0 ? 0 : minimumX / scaleX,
      rightMargin: count === 0 ? 0 : (scratch.width - 1 - maximumX) / scaleX,
      topMargin: count === 0 ? 0 : minimumY / scaleY,
    };
  });
}

export async function countNonBackgroundCanvasPixels(page: Page): Promise<number> {
  return (await inspectNonBackgroundCanvasPixels(page)).count;
}
