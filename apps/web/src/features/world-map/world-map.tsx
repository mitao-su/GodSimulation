import { useEffect, useRef, useState } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";

import type { WorldView } from "@god-sim/protocol";

import { PixiWorldRenderer } from "./pixi-world-renderer";

export interface WorldMapProps {
  readonly view: WorldView;
  readonly onSelect: (entityId: string) => void;
}

const zoomLevels = [1, 1.5, 2, 3, 4];

export function WorldMap({ view, onSelect }: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiWorldRenderer | null>(null);
  const latestViewRef = useRef(view);
  const onSelectRef = useRef(onSelect);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [zoomStep, setZoomStep] = useState(0);
  const zoomed = zoomStep > 0;
  latestViewRef.current = view;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    const renderer = new PixiWorldRenderer({
      host,
      onSelect: (entityId) => onSelectRef.current(entityId),
    });
    rendererRef.current = renderer;
    void renderer
      .initialize()
      .then(() => {
        if (!active) return;
        renderer.render(latestViewRef.current);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRenderError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    try {
      renderer.render(view);
      setRenderError(null);
    } catch (error) {
      if (error instanceof Error && error.message === "World renderer is not initialized") return;
      setRenderError(error instanceof Error ? error.message : String(error));
    }
  }, [view]);

  useEffect(() => {
    rendererRef.current?.setZoom(zoomLevels[zoomStep]!);
  }, [zoomStep]);

  return (
    <div className="world-map" aria-label="世界地图">
      <div
        ref={hostRef}
        className="world-map__canvas"
        role="region"
        aria-label="地图视野"
        tabIndex={zoomed ? 0 : undefined}
        data-zoomed={zoomed}
      />
      <div className="world-map__controls" role="group" aria-label="地图缩放">
        <button
          type="button"
          aria-label="缩小地图"
          title="缩小地图"
          disabled={!zoomed || renderError !== null}
          onClick={() => setZoomStep((step) => Math.max(0, step - 1))}
        >
          <ZoomOut aria-hidden="true" size={17} />
        </button>
        <button
          type="button"
          aria-label="适应窗口"
          title="适应窗口"
          disabled={!zoomed || renderError !== null}
          onClick={() => setZoomStep(0)}
        >
          <Maximize aria-hidden="true" size={16} />
        </button>
        <button
          type="button"
          aria-label="放大地图"
          title="放大地图"
          disabled={zoomStep >= zoomLevels.length - 1 || renderError !== null}
          onClick={() => setZoomStep((step) => Math.min(zoomLevels.length - 1, step + 1))}
        >
          <ZoomIn aria-hidden="true" size={17} />
        </button>
      </div>
      {renderError ? (
        <div className="world-map__error" role="alert">
          地图渲染失败：{renderError}
        </div>
      ) : null}
    </div>
  );
}
