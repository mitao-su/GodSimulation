import { CircleUserRound, MapPin } from "lucide-react";

import type { WorldView } from "@god-sim/protocol";

export interface AgentListProps {
  readonly view: WorldView;
  readonly selectedId: string | null;
  readonly onSelect: (entityId: string) => void;
}

const decisionLabels = {
  none: "执行中",
  thinking: "思考中",
  ready: "已就绪",
  error: "决策错误",
} as const;

export function AgentList({ view, selectedId, onSelect }: AgentListProps) {
  return (
    <div className="agent-list">
      <section className="sidebar-section" aria-labelledby="agents-title">
        <h2 id="agents-title">角色</h2>
        <div className="agent-list__items">
          {view.agents.map((agent) => (
            <button
              type="button"
              key={agent.agentId}
              className="agent-row"
              data-selected={selectedId === agent.agentId}
              onClick={() => onSelect(agent.agentId)}
            >
              <CircleUserRound aria-hidden="true" size={18} />
              <span className="agent-row__copy">
                <strong>{agent.displayName}</strong>
                <span>{agent.currentGoalLabel ?? "尚无目标"}</span>
              </span>
              <span className={`status-dot status-dot--${agent.decisionStatus}`}>
                {decisionLabels[agent.decisionStatus]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section" aria-labelledby="zones-title">
        <h2 id="zones-title">区域</h2>
        <ul className="zone-list">
          {view.map.zones.map((zone) => (
            <li key={zone.id}>
              <MapPin aria-hidden="true" size={15} />
              <span>{zone.name}</span>
              <span>{zone.cells.length}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
