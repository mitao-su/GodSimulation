import type { Page } from "@playwright/test";

export async function countNonBackgroundCanvasPixels(page: Page): Promise<number> {
  return page.locator("canvas").evaluate((canvas) => {
    const source = canvas as HTMLCanvasElement;
    const scratch = document.createElement("canvas");
    scratch.width = source.width;
    scratch.height = source.height;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to inspect the world canvas");
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      const differsFromBackground =
        Math.abs(pixels[index]! - 32) > 3 ||
        Math.abs(pixels[index + 1]! - 34) > 3 ||
        Math.abs(pixels[index + 2]! - 43) > 3;
      if (alpha !== 0 && differsFromBackground) count += 1;
    }
    return count;
  });
}
