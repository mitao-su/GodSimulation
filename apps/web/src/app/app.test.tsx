// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorldViewSchema, type WorldCommand, type WorldView } from "@god-sim/protocol";

import { App } from "./app";
import type { WorldClientPort } from "../transport/world-client";

vi.mock("../features/world-map/world-map", () => ({
  WorldMap: () => <div aria-label="世界地图" />,
}));

function view(
  mode: WorldView["mode"],
  decisionStatus: "pending" | "ready" | "error",
): WorldView {
  const failure =
    decisionStatus === "error"
      ? {
          id: "failure:model:request-alice",
          category: "model" as const,
          message: "模型暂时不可用",
          requestId: "request-alice",
          retryable: true,
          occurredAtRealTime: "2026-08-31T00:00:00.000Z",
        }
      : null;
  return WorldViewSchema.parse({
    schemaVersion: 1,
    revision: 1,
    worldId: "starter-world",
    worldName: "Starter Home",
    worldVersion: 3,
    worldTick: 12,
    mode,
    reviewRequired: true,
    pauseReason: {
      code: "perceived_goal_conflict",
      message: "Alice 看见冰箱正在被 Bob 使用",
      agentIds: ["alice"],
    },
    map: { width: 18, height: 12, tileSize: 16, zones: [], tiles: [] },
    entities: [
      {
        entityId: "alice",
        kind: "agent",
        displayName: "Alice",
        resourceId: "starter-agents.memao.alice",
        position: { x: 2, y: 3 },
        facing: "east",
        renderLayer: 30,
        status: "thinking",
      },
    ],
    agents: [
      {
        agentId: "alice",
        displayName: "Alice",
        currentGoalLabel: "使用冰箱",
        actionLabel: null,
        bladderLevel: "comfortable",
        decisionStatus: decisionStatus === "error" ? "error" : decisionStatus === "ready" ? "ready" : "thinking",
        perceivedSummaries: ["Wall", "Wall"],
        memorySummaries: ["冰箱在厨房", "冰箱在厨房"],
      },
    ],
    pendingDecisions: [
      {
        requestId: "request-alice",
        agentId: "alice",
        status: decisionStatus,
        reason: "看见目标被占用，需要重新决定",
        proposalReason: decisionStatus === "ready" ? "先等待" : null,
        error: failure,
      },
    ],
    recentEvents: [],
    technicalFailure: failure,
  });
}

class FakeWorldClient implements WorldClientPort {
  readonly sentCommands: WorldCommand[] = [];
  readonly #view: WorldView;

  constructor(initialView: WorldView) {
    this.#view = initialView;
  }

  subscribe(listener: (view: WorldView) => void): () => void {
    listener(this.#view);
    return () => undefined;
  }

  async send(command: WorldCommand): Promise<void> {
    this.sentCommands.push(command);
  }

  connect(): void {}

  disconnect(): void {}
}

describe("director workbench", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the thinking reason and disables release before decisions are ready", () => {
    render(<App client={new FakeWorldClient(view("THINKING", "pending"))} />);

    expect(screen.getByText("角色思考中")).toBeVisible();
    expect(screen.getByText("Alice 看见冰箱正在被 Bob 使用")).toBeVisible();
    expect(screen.getByRole("button", { name: "放行世界" })).toBeDisabled();
  });

  it("sends a release command when every decision is ready", async () => {
    const client = new FakeWorldClient(view("READY_FOR_RELEASE", "ready"));
    render(<App client={client} />);

    await userEvent.click(screen.getByRole("button", { name: "放行世界" }));

    expect(client.sentCommands).toContainEqual(
      expect.objectContaining({
        type: "release_execution",
        worldId: "starter-world",
        expectedWorldVersion: 3,
      }),
    );
  });

  it("changes review mode through a protocol command", async () => {
    const client = new FakeWorldClient(view("THINKING", "pending"));
    render(<App client={client} />);

    await userEvent.click(screen.getByRole("checkbox", { name: "决策审查" }));

    expect(client.sentCommands).toContainEqual(
      expect.objectContaining({ type: "set_review_mode", enabled: false }),
    );
  });

  it("renders repeated perception summaries without duplicate key errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<App client={new FakeWorldClient(view("THINKING", "pending"))} />);

    await userEvent.click(screen.getByRole("tab", { name: "感知" }));

    expect(screen.getAllByText("Wall")).toHaveLength(2);
    expect(
      consoleError.mock.calls.filter(([message]) => String(message).includes("same key")),
    ).toEqual([]);
  });

  it("renders repeated memory summaries without duplicate key errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<App client={new FakeWorldClient(view("THINKING", "pending"))} />);

    await userEvent.click(screen.getByRole("tab", { name: "记忆" }));

    expect(screen.getAllByText("冰箱在厨房")).toHaveLength(2);
    expect(
      consoleError.mock.calls.filter(([message]) => String(message).includes("same key")),
    ).toEqual([]);
  });

  it("retries only the failed decision request", async () => {
    const client = new FakeWorldClient(view("TECHNICALLY_BLOCKED", "error"));
    render(<App client={client} />);

    expect(screen.getByText("模型暂时不可用")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "重试 Alice 的决策" }));

    expect(client.sentCommands).toContainEqual(
      expect.objectContaining({ type: "retry_decision", requestId: "request-alice" }),
    );
  });

  it("shows actionable identity for a failed decision", () => {
    render(<App client={new FakeWorldClient(view("TECHNICALLY_BLOCKED", "error"))} />);

    const failure = screen.getByRole("group", { name: "Alice 决策错误" });
    expect(within(failure).getByText("Alice")).toBeVisible();
    expect(within(failure).getByText("模型")).toBeVisible();
    expect(within(failure).getByText("request-alice")).toBeVisible();
    expect(within(failure).getByText("模型暂时不可用")).toBeVisible();
  });
});
