import { useEffect, useState } from "react";
import { Activity, Brain, Eye, Info } from "lucide-react";

import type { WorldView } from "@god-sim/protocol";

export interface AgentInspectorProps {
  readonly view: WorldView;
  readonly selectedId: string | null;
}

type InspectorTab = "overview" | "perception" | "memory";

export function AgentInspector({ view, selectedId }: AgentInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("overview");
  const agent = view.agents.find((candidate) => candidate.agentId === selectedId) ?? null;
  const entity = view.entities.find((candidate) => candidate.entityId === selectedId) ?? null;

  useEffect(() => setTab("overview"), [selectedId]);

  if (!selectedId || (!agent && !entity)) {
    return (
      <div className="inspector-empty">
        <Info aria-hidden="true" size={20} />
        <span>未选择对象</span>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="entity-inspector">
        <div className="inspector-heading">
          <span className="inspector-heading__kind">家具</span>
          <h2>{entity!.displayName}</h2>
          <span>{entity!.status}</span>
        </div>
        <dl className="detail-list">
          <div><dt>位置</dt><dd>{entity!.position.x}, {entity!.position.y}</dd></div>
          <div><dt>朝向</dt><dd>{entity!.facing}</dd></div>
          <div><dt>资源</dt><dd>{entity!.resourceId}</dd></div>
        </dl>
      </div>
    );
  }

  const tabItems: readonly { readonly id: InspectorTab; readonly label: string; readonly icon: typeof Info }[] = [
    { id: "overview", label: "概况", icon: Activity },
    { id: "perception", label: "感知", icon: Eye },
    { id: "memory", label: "记忆", icon: Brain },
  ];

  return (
    <div className="agent-inspector">
      <div className="inspector-heading">
        <span className="inspector-heading__kind">角色</span>
        <h2>{agent.displayName}</h2>
        <span>{agent.bodyTask.label ?? agent.headTask.label ?? "无任务"}</span>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label={`${agent.displayName} 信息`}>
        {tabItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              <Icon aria-hidden="true" size={15} />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? (
        <dl className="detail-list inspector-content">
          <div><dt>头部任务</dt><dd>{agent.headTask.label ?? "空任务"}</dd></div>
          <div><dt>身体任务</dt><dd>{agent.bodyTask.label ?? "空任务"}</dd></div>
          <div><dt>内急状态</dt><dd>{agent.bladderLevel}</dd></div>
          <div><dt>决策状态</dt><dd>{agent.decisionStatus}</dd></div>
        </dl>
      ) : null}

      {tab === "perception" ? (
        <ul className="inspector-list inspector-content">
          {agent.perceivedSummaries.length > 0 ? agent.perceivedSummaries.map((summary, index) => (
            <li key={`${index}:${summary}`}>{summary}</li>
          )) : <li className="muted">当前没有明确感知</li>}
        </ul>
      ) : null}

      {tab === "memory" ? (
        <ul className="inspector-list inspector-content">
          {agent.memorySummaries.length > 0 ? agent.memorySummaries.map((summary, index) => (
            <li key={`${index}:${summary}`}>{summary}</li>
          )) : <li className="muted">当前没有即时记忆</li>}
        </ul>
      ) : null}
    </div>
  );
}
