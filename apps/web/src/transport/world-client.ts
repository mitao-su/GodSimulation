import {
  WorldCommandSchema,
  WorldViewSchema,
  type WorldCommand,
  type WorldView,
} from "@god-sim/protocol";

interface WorldSocket {
  onmessage: ((event: { readonly data: string }) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface WorldClientPort {
  subscribe(listener: (view: WorldView) => void): () => void;
  send(command: WorldCommand): Promise<void>;
  connect(): void;
  disconnect(): void;
}

export interface WorldClientOptions {
  readonly locationHref?: string;
  readonly webSocketFactory?: (url: string) => WorldSocket;
  readonly fetchImplementation?: typeof fetch;
  readonly reconnectDelayMs?: number;
}

export class WorldClient implements WorldClientPort {
  readonly #location: URL;
  readonly #webSocketFactory: (url: string) => WorldSocket;
  readonly #fetch: typeof fetch;
  readonly #reconnectDelayMs: number;
  readonly #listeners = new Set<(view: WorldView) => void>();
  #socket: WorldSocket | null = null;
  #view: WorldView | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #connected = false;

  constructor(options: WorldClientOptions = {}) {
    this.#location = new URL(options.locationHref ?? globalThis.location.href);
    this.#webSocketFactory =
      options.webSocketFactory ?? ((url) => new WebSocket(url) as WorldSocket);
    this.#fetch = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  }

  subscribe(listener: (view: WorldView) => void): () => void {
    this.#listeners.add(listener);
    if (this.#view) listener(this.#view);
    return () => this.#listeners.delete(listener);
  }

  connect(): void {
    if (this.#connected) return;
    this.#connected = true;
    this.#openSocket();
  }

  disconnect(): void {
    this.#connected = false;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
  }

  async send(commandValue: WorldCommand): Promise<void> {
    const command = WorldCommandSchema.parse(commandValue);
    const endpoint = new URL("/api/commands", this.#location);
    const response = await this.#fetch(endpoint.href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      throw new Error(`世界命令提交失败（HTTP ${response.status}）`);
    }
  }

  #openSocket(): void {
    if (!this.#connected || this.#socket) return;
    const endpoint = new URL("/api/events", this.#location);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const socket = this.#webSocketFactory(endpoint.href);
    this.#socket = socket;
    socket.onmessage = (event) => {
      let value: unknown;
      try {
        value = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      const parsed = WorldViewSchema.safeParse(value);
      if (!parsed.success) return;
      this.#view = parsed.data;
      for (const listener of this.#listeners) listener(parsed.data);
    };
    socket.onclose = () => {
      if (this.#socket === socket) this.#socket = null;
      if (!this.#connected) return;
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = null;
        this.#openSocket();
      }, this.#reconnectDelayMs);
    };
  }
}
