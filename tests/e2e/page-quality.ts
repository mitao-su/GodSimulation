import type { Page } from "@playwright/test";

export function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export interface WorkbenchLayoutInspection {
  readonly clippedControls: readonly string[];
  readonly overlappingRegions: readonly string[];
  readonly viewportOverflow: boolean;
}

export async function inspectWorkbenchLayout(page: Page): Promise<WorkbenchLayoutInspection> {
  return page.evaluate(() => {
    const rectangle = (selector: string): DOMRect => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout region ${selector}`);
      return element.getBoundingClientRect();
    };
    const overlap = (left: DOMRect, right: DOMRect): boolean =>
      Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
      Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1;
    const regionPairs = [
      [".app-shell__header", ".app-shell__sidebar"],
      [".app-shell__header", ".app-shell__stage"],
      [".app-shell__header", ".app-shell__inspector"],
      [".app-shell__timeline", ".app-shell__sidebar"],
      [".app-shell__timeline", ".app-shell__stage"],
      [".app-shell__timeline", ".app-shell__inspector"],
      [".app-shell__sidebar", ".app-shell__stage"],
      [".app-shell__stage", ".app-shell__inspector"],
      [".event-strip__events", ".event-strip__actions"],
    ] as const;
    const overlappingRegions = regionPairs
      .filter(([left, right]) => overlap(rectangle(left), rectangle(right)))
      .map(([left, right]) => `${left} overlaps ${right}`);
    const clippedControls = [...document.querySelectorAll("button, label, [role='tab']")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && bounds.width > 0 && bounds.height > 0;
      })
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left < -1 ||
          bounds.top < -1 ||
          bounds.right > innerWidth + 1 ||
          bounds.bottom > innerHeight + 1
        );
      })
      .map((element) => (element.getAttribute("aria-label") || element.textContent || "").trim());
    return {
      clippedControls,
      overlappingRegions,
      viewportOverflow:
        document.documentElement.scrollWidth > innerWidth + 1 ||
        document.documentElement.scrollHeight > innerHeight + 1,
    };
  });
}
