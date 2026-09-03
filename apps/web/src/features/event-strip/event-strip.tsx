import { AlertCircle, Play, RotateCcw } from "lucide-react";

import type { DomainEvent, WorldView } from "@god-sim/protocol";

export interface EventStripProps {
  readonly view: WorldView;
  readonly commandPending: boolean;
  readonly onRelease: () => void;
  readonly onRetry: (requestId: string) => void;
  readonly onRetryTechnicalFailure: (failureId: string) => void;
}

const eventLabels: Readonly<Record<DomainEvent["type"], string>> = {
  decision_requested: "请求角色决策",
  decision_accepted: "角色决策已接受",
  world_released: "世界继续运行",
  interaction_arbitrated: "交互冲突已判定",
  object_state_changed: "家具状态变化",
  agent_need_changed: "角色需求变化",
  action_failed: "动作执行失败",
  operation_started: "任务已开始",
  operation_result: "任务返回结果",
  operation_terminated: "任务已结束",
  observation_remembered: "角色形成记忆",
  perception_recorded: "角色记录感知",
  perceptible_result_emitted: "角色感知到结果",
};

const failureCategoryLabels = {
  configuration: "配置",
  model: "模型",
  plugin: "插件",
  protocol: "协议",
  persistence: "存储",
  worker: "模拟进程",
} as const;

export function EventStrip({
  view,
  commandPending,
  onRelease,
  onRetry,
  onRetryTechnicalFailure,
}: EventStripProps) {
  const recent = view.recentEvents.slice(-4).reverse();
  const failed = view.pendingDecisions.filter((decision) => decision.status === "error");
  const decisionFailureIds = new Set(
    failed.flatMap((decision) => decision.error?.id ?? []),
  );
  const technicalFailure =
    view.technicalFailure && !decisionFailureIds.has(view.technicalFailure.id)
      ? view.technicalFailure
      : null;
  const canRelease = view.mode === "READY_FOR_RELEASE" && !commandPending;

  return (
    <div className="event-strip">
      <div className="event-strip__events" aria-label="最近事件">
        {recent.length > 0 ? recent.map((event) => (
          <div className="event-item" key={event.eventId}>
            <span>#{event.sequence}</span>
            <strong>{eventLabels[event.type]}</strong>
            <span>T{event.worldTick}</span>
          </div>
        )) : <span className="event-strip__empty">等待第一个世界事件</span>}
      </div>

      <div className="event-strip__actions">
        {technicalFailure ? (
          <div
            className="decision-error"
            role="group"
            aria-label={`${failureCategoryLabels[technicalFailure.category]}错误`}
          >
            <AlertCircle aria-hidden="true" size={17} />
            <div className="decision-error__copy">
              <div className="decision-error__identity">
                <strong>{failureCategoryLabels[technicalFailure.category]}错误</strong>
                <span>{failureCategoryLabels[technicalFailure.category]}</span>
              </div>
              <span className="decision-error__request">{technicalFailure.id}</span>
              <span className="decision-error__message">{technicalFailure.message}</span>
            </div>
            {technicalFailure.retryable ? (
              <button
                type="button"
                aria-label={`重试${failureCategoryLabels[technicalFailure.category]}故障`}
                onClick={() => onRetryTechnicalFailure(technicalFailure.id)}
                disabled={commandPending}
              >
                <RotateCcw aria-hidden="true" size={16} />
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {failed.map((decision) => {
          const agent = view.agents.find((candidate) => candidate.agentId === decision.agentId);
          const agentName = agent?.displayName ?? decision.agentId;
          return (
            <div
              className="decision-error"
              key={decision.requestId}
              role="group"
              aria-label={`${agentName} 决策错误`}
            >
              <AlertCircle aria-hidden="true" size={17} />
              <div className="decision-error__copy">
                <div className="decision-error__identity">
                  <strong>{agentName}</strong>
                  <span>
                    {decision.error
                      ? failureCategoryLabels[decision.error.category]
                      : "决策"}
                  </span>
                </div>
                <span className="decision-error__request">{decision.requestId}</span>
                <span className="decision-error__message">
                  {decision.error?.message ?? "决策失败"}
                </span>
              </div>
              <button
                type="button"
                aria-label={`重试 ${agentName} 的决策`}
                onClick={() => onRetry(decision.requestId)}
                disabled={commandPending}
              >
                <RotateCcw aria-hidden="true" size={16} />
                重试
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="release-button"
          aria-label="放行世界"
          onClick={onRelease}
          disabled={!canRelease}
        >
          <Play aria-hidden="true" size={17} fill="currentColor" />
          放行世界
        </button>
      </div>
    </div>
  );
}
