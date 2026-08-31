import { useEffect, useMemo, useState } from "react";
import { Clock3, Database, PauseCircle } from "lucide-react";

import {
  WorldCommandSchema,
  type RequestId,
  type WorldCommand,
  type WorldView,
} from "@god-sim/protocol";

import { AppShell } from "./app-shell";
import type { WorldClientPort } from "../transport/world-client";
import { AgentList } from "../features/agent-list/agent-list";
import { AgentInspector } from "../features/agent-inspector/agent-inspector";
import { DecisionReview } from "../features/decision-review/decision-review";
import { EventStrip } from "../features/event-strip/event-strip";
import { WorldMap } from "../features/world-map/world-map";

export interface AppProps {
  readonly client: WorldClientPort;
}

const modeLabels: Readonly<Record<WorldView["mode"], string>> = {
  RUNNING: "运行中",
  THINKING: "思考中",
  READY_FOR_RELEASE: "等待放行",
  TECHNICALLY_BLOCKED: "技术阻塞",
};

function commandId(): string {
  return `command:web:${crypto.randomUUID()}`;
}

function commandEnvelope(view: WorldView) {
  return {
    schemaVersion: 1 as const,
    commandId: commandId(),
    worldId: view.worldId,
    expectedWorldVersion: view.worldVersion,
    issuedAtRealTime: new Date().toISOString(),
  };
}

export function App({ client }: AppProps) {
  const [view, setView] = useState<WorldView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = client.subscribe(setView);
    client.connect();
    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [client]);

  useEffect(() => {
    if (!view) return;
    const stillExists =
      view.entities.some((entity) => entity.entityId === selectedId) ||
      view.agents.some((agent) => agent.agentId === selectedId);
    if (!stillExists) setSelectedId(view.agents[0]?.agentId ?? view.entities[0]?.entityId ?? null);
  }, [selectedId, view]);

  const submit = async (command: WorldCommand): Promise<void> => {
    setCommandPending(true);
    setCommandError(null);
    try {
      await client.send(WorldCommandSchema.parse(command));
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandPending(false);
    }
  };

  const release = (): void => {
    if (!view || view.mode !== "READY_FOR_RELEASE") return;
    void submit(WorldCommandSchema.parse({
      ...commandEnvelope(view),
      type: "release_execution",
    }));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement) return;
      if (view?.mode !== "READY_FOR_RELEASE") return;
      event.preventDefault();
      release();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const headerStatus = useMemo(() => {
    if (!view) return null;
    return (
      <>
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">GS</span>
          <div><strong>{view.worldName}</strong><span>God Simulation</span></div>
        </div>
        <div className={`world-mode world-mode--${view.mode.toLowerCase()}`}>
          <PauseCircle aria-hidden="true" size={16} />
          {modeLabels[view.mode]}
        </div>
        <div className="header-metric">
          <Clock3 aria-hidden="true" size={16} />
          <span>世界时间</span><strong>{view.worldTick}</strong>
        </div>
        <div className="header-metric">
          <Database aria-hidden="true" size={16} />
          <span>版本</span><strong>{view.worldVersion}</strong>
        </div>
        <label className="review-toggle">
          <span>决策审查</span>
          <input
            type="checkbox"
            checked={view.reviewRequired}
            disabled={commandPending}
            onChange={(event) => {
              void submit(WorldCommandSchema.parse({
                ...commandEnvelope(view),
                type: "set_review_mode",
                enabled: event.target.checked,
              }));
            }}
          />
          <span className="review-toggle__track" aria-hidden="true"><span /></span>
        </label>
      </>
    );
  }, [commandPending, view]);

  if (!view) {
    return (
      <main className="connection-screen">
        <span className="connection-screen__pulse" aria-hidden="true" />
        <strong>正在连接本地世界</strong>
      </main>
    );
  }

  return (
    <AppShell
      header={<div className="topbar">{headerStatus}</div>}
      sidebar={<AgentList view={view} selectedId={selectedId} onSelect={setSelectedId} />}
      stage={
        <div className="world-stage">
          <DecisionReview view={view} />
          <WorldMap view={view} onSelect={setSelectedId} />
          {commandError ? <div className="command-error" role="alert">{commandError}</div> : null}
        </div>
      }
      inspector={<AgentInspector view={view} selectedId={selectedId} />}
      timeline={
        <EventStrip
          view={view}
          commandPending={commandPending}
          onRelease={release}
          onRetry={(requestId) => {
            void submit(WorldCommandSchema.parse({
              ...commandEnvelope(view),
              type: "retry_decision",
              requestId: requestId as RequestId,
            }));
          }}
          onRetryTechnicalFailure={(failureId) => {
            void submit(WorldCommandSchema.parse({
              ...commandEnvelope(view),
              type: "retry_technical_failure",
              failureId,
            }));
          }}
        />
      }
    />
  );
}
