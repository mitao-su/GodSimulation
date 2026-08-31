import { AlertTriangle, BrainCircuit, CircleCheck } from "lucide-react";

import type { WorldView } from "@god-sim/protocol";

export interface DecisionReviewProps {
  readonly view: WorldView;
}

export function DecisionReview({ view }: DecisionReviewProps) {
  const pendingCount = view.pendingDecisions.filter((decision) => decision.status === "pending").length;
  const readyCount = view.pendingDecisions.filter((decision) => decision.status === "ready").length;
  const hasError = view.technicalFailure !== null;
  const Icon = hasError ? AlertTriangle : view.mode === "READY_FOR_RELEASE" ? CircleCheck : BrainCircuit;
  const title = hasError
    ? "世界技术阻塞"
    : view.mode === "READY_FOR_RELEASE"
      ? "决策等待放行"
      : view.mode === "THINKING"
        ? "角色思考中"
        : "世界运行中";

  return (
    <div className={`decision-banner decision-banner--${hasError ? "error" : view.mode.toLowerCase()}`}>
      <Icon aria-hidden="true" size={18} />
      <div className="decision-banner__copy">
        <strong>{title}</strong>
        <span>{view.pauseReason?.message ?? "角色正在执行程序安排的动作"}</span>
      </div>
      {view.pendingDecisions.length > 0 ? (
        <div className="decision-banner__counts" aria-label="决策进度">
          <span>{readyCount} 就绪</span>
          <span>{pendingCount} 等待</span>
        </div>
      ) : null}
    </div>
  );
}
