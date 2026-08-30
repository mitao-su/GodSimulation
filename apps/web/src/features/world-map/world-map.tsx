import { useEffect, useRef, useState } from "react";

import type { WorldView } from "@god-sim/protocol";

import { PixiWorldRenderer } from "./pixi-world-renderer";

export interface WorldMapProps {
  readonly view: WorldView;
  readonly onSelect: (entityId: string) => void;
}

export function WorldMap({ view, onSelect }: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiWorldRenderer | null>(null);
  const latestViewRef = useRef(view);
  const onSelectRef = useRef(onSelect);
  const [renderError, setRenderError] = useState<string | null>(null);
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

  return (
    <div className="world-map" aria-label="世界地图">
      <div ref={hostRef} className="world-map__canvas" />
      {renderError ? (
        <div className="world-map__error" role="alert">
          地图渲染失败：{renderError}
        </div>
      ) : null}
    </div>
  );
}
