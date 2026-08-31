import { afterEach, describe, expect, it, vi } from "vitest";

import { WorldCommandSchema, WorldViewSchema, type WorldView } from "@god-sim/protocol";

import { WorldClient } from "./world-client";

function view(): WorldView {
  return WorldViewSchema.parse({
    schemaVersion: 1,
    revision: 1,
    worldId: "starter-world",
    worldName: "Starter Home",
    worldVersion: 1,
    worldTick: 0,
    mode: "THINKING",
    reviewRequired: true,
    pauseReason: null,
    map: { width: 18, height: 12, tileSize: 16, zones: [], tiles: [] },
    entities: [],
    agents: [],
    pendingDecisions: [],
    recentEvents: [],
    technicalFailure: null,
  });
}

class FakeSocket {
  readonly url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
  }

  close(): void {
    this.closed = true;
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("WorldClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publishes only protocol-valid world views from the socket", () => {
    let socket: FakeSocket | null = null;
    const client = new WorldClient({
      locationHref: "http://127.0.0.1:5173/",
      webSocketFactory(url) {
        socket = new FakeSocket(url);
        return socket;
      },
      fetchImplementation: vi.fn(),
    });
    const received: WorldView[] = [];
    client.subscribe((nextView) => received.push(nextView));

    client.connect();
    const connectedSocket = socket as FakeSocket | null;
    expect(connectedSocket?.url).toBe("ws://127.0.0.1:5173/api/events");
    connectedSocket?.receive({ arbitrary: "hidden world state" });
    connectedSocket?.receive(view());

    expect(received).toEqual([view()]);
    client.disconnect();
    expect(connectedSocket?.closed).toBe(true);
  });

  it("posts parsed commands to the local command endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    const client = new WorldClient({
      locationHref: "http://127.0.0.1:5173/",
      webSocketFactory: (url) => new FakeSocket(url),
      fetchImplementation,
    });
    const command = WorldCommandSchema.parse({
      schemaVersion: 1,
      commandId: "command:web:1",
      worldId: "starter-world",
      expectedWorldVersion: 2,
      issuedAtRealTime: "2026-08-31T00:00:00.000Z",
      type: "release_execution",
    });

    await client.send(command);

    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/api/commands",
      expect.objectContaining({ method: "POST", body: JSON.stringify(command) }),
    );
  });

  it("keeps the browser receiver when using the default fetch implementation", async () => {
    let usedBrowserReceiver = false;
    vi.stubGlobal("fetch", async function browserFetch(this: unknown) {
      usedBrowserReceiver = this === globalThis;
      if (!usedBrowserReceiver) throw new TypeError("Illegal invocation");
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });
    const client = new WorldClient({
      locationHref: "http://127.0.0.1:5173/",
      webSocketFactory: (url) => new FakeSocket(url),
    });
    const command = WorldCommandSchema.parse({
      schemaVersion: 1,
      commandId: "command:web:default-fetch",
      worldId: "starter-world",
      expectedWorldVersion: 2,
      issuedAtRealTime: "2026-08-31T00:00:00.000Z",
      type: "release_execution",
    });

    await client.send(command);

    expect(usedBrowserReceiver).toBe(true);
  });
});
