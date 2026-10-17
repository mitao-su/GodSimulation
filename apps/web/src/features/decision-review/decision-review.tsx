import { AlertTriangle, BrainCircuit, CircleCheck } from "lucide-react";

import type { WorldView } from "@god-sim/protocol";

export interface DecisionReviewProps {
  readonly view: WorldView;
}

type TrackProposal = WorldView["pendingDecisions"][number]["headProposal"];

function operationText(
  task: Extract<NonNullable<TrackProposal>, { kind: "replace" }>['task'],
  view: WorldView,
): string {
  if (task.kind === "empty_task") return "清空轨道";
  const targetEntityId = task.hostEntityId ??
    (typeof task.arguments.targetEntityId === "string"
      ? task.arguments.targetEntityId
      : undefined);
  const target = targetEntityId === undefined
    ? undefined
    : view.entities.find((entity) => entity.entityId === targetEntityId);
  if (task.operationId === "core.move" && target?.kind === "object") {
    return `Move to ${target.displayName}`;
  }
  if (task.operationId.startsWith("object.") && target?.kind === "object") {
    const action = task.operationId.slice(task.operationId.lastIndexOf(".") + 1);
    const verb = action.charAt(0).toUpperCase() + action.slice(1);
    const noun = target.displayName.charAt(0).toLowerCase() + target.displayName.slice(1);
    return `${verb} ${noun}`;
  }
  const argumentsText = Object.keys(task.arguments).length === 0
    ? ""
    : ` ${JSON.stringify(task.arguments)}`;
  const hostText = task.hostEntityId === undefined ? "" : ` @${task.hostEntityId}`;
  return `${task.operationId}${hostText}${argumentsText}`;
}

function proposalText(proposal: TrackProposal, view: WorldView): string {
  if (!proposal) return "等待决策";
  if (proposal.kind === "continue") return proposal.label;
  return operationText(proposal.task, view);
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
      {view.pendingDecisions.length > 0 ? (
        <div className="decision-banner__proposals" aria-label="角色决策提案">
          {view.pendingDecisions.map((decision) => {
            const agentName =
              view.agents.find((agent) => agent.agentId === decision.agentId)
                ?.displayName ?? decision.agentId;
            const proposalReason = decision.proposalReason ?? decision.reason;
            return (
              <div className="decision-proposal" key={decision.requestId}>
                <div className="decision-proposal__agent">
                  <strong>{agentName}</strong>
                  <span>{decision.status === "ready" ? "已就绪" : decision.status === "error" ? "错误" : "思考中"}</span>
                </div>
                <div className="decision-proposal__track">
                  <span>HEAD</span>
                  <strong>{proposalText(decision.headProposal, view)}</strong>
                </div>
                <div className="decision-proposal__track">
                  <span>BODY</span>
                  <strong>{proposalText(decision.bodyProposal, view)}</strong>
                </div>
                {proposalReason !== view.pauseReason?.message ? (
                  <span className="decision-proposal__reason">{proposalReason}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
