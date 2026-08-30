import { fork, type ChildProcess } from "node:child_process";

import type {
  HostToWorkerMessage,
  WorkerToHostMessage,
} from "@god-sim/protocol";
import {
  HostToWorkerMessageSchema,
  TechnicalFailureSchema,
  WorkerToHostMessageSchema,
} from "@god-sim/protocol";

interface PluginDescriptorConfig {
  readonly manifestPath: string;
  readonly entryPath: string;
}

export interface WorkerTransport {
  onMessage(listener: (message: WorkerToHostMessage) => void): () => void;
  start(initialization?: Extract<HostToWorkerMessage, { type: "initialize" }>): Promise<void>;
  send(message: HostToWorkerMessage): Promise<void>;
  stop(): Promise<void>;
}

export interface ProcessWorkerSupervisorOptions {
  readonly entryPath: string;
  readonly pluginDescriptors: readonly PluginDescriptorConfig[];
  readonly cwd: string;
  readonly execArgv?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly now?: () => string;
}

export class ProcessWorkerSupervisor implements WorkerTransport {
  readonly #options: ProcessWorkerSupervisorOptions;
  readonly #listeners = new Set<(message: WorkerToHostMessage) => void>();
  readonly #now: () => string;
  #child: ChildProcess | null = null;
  #stopping = false;
  #failureSequence = 0;

  constructor(options: ProcessWorkerSupervisorOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  onMessage(listener: (message: WorkerToHostMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(
    initialization?: Extract<HostToWorkerMessage, { type: "initialize" }>,
  ): Promise<void> {
    if (this.#child) throw new Error("Simulation worker process is already started");
    if (!initialization) throw new Error("Simulation worker initialization is required");
    this.#stopping = false;

    const child = fork(this.#options.entryPath, [], {
      cwd: this.#options.cwd,
      execArgv: [...(this.#options.execArgv ?? [])],
      env: {
        ...process.env,
        ...this.#options.environment,
        GOD_SIM_PLUGIN_DESCRIPTORS: JSON.stringify(this.#options.pluginDescriptors),
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.#child = child;
    let becameReady = false;
    let transportFailurePublished = false;
    child.once("exit", (code, signal) => {
      if (this.#child === child) this.#child = null;
      if (becameReady && !this.#stopping && !transportFailurePublished) {
        transportFailurePublished = true;
        this.#publishTransportFailure(
          `Simulation worker exited unexpectedly: code=${code} signal=${signal}`,
        );
      }
    });
    child.once("disconnect", () => {
      if (becameReady && !this.#stopping && !transportFailurePublished) {
        transportFailurePublished = true;
        this.#publishTransportFailure("Simulation worker IPC disconnected unexpectedly");
      }
    });
    const ready = new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        reject(new Error(`Simulation worker exited before ready: code=${code} signal=${signal}`));
      };
      const onMessage = (value: unknown): void => {
        const parsed = WorkerToHostMessageSchema.safeParse(value);
        if (!parsed.success) {
          reject(new Error(`Simulation worker emitted invalid IPC: ${parsed.error.message}`));
          return;
        }
        this.#publish(parsed.data);
        if (parsed.data.type === "worker_ready") {
          becameReady = true;
          child.off("error", onError);
          child.off("exit", onExit);
          resolve();
        } else if (parsed.data.type === "technical_failure") {
          reject(new Error(parsed.data.failure.message));
        }
      };
      child.on("error", onError);
      child.on("exit", onExit);
      child.on("message", onMessage);
    });
    await this.send(initialization);
    await ready;
  }

  async send(messageValue: HostToWorkerMessage): Promise<void> {
    const message = HostToWorkerMessageSchema.parse(messageValue);
    const child = this.#child;
    if (!child?.connected) throw new Error("Simulation worker IPC is not connected");
    await new Promise<void>((resolve, reject) => {
      child.send(message, (error) => (error ? reject(error) : resolve()));
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;
    this.#stopping = true;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.connected) {
      await this.send({ type: "shutdown" });
    } else {
      child.kill();
    }
    await exited;
    if (this.#child === child) this.#child = null;
  }

  #publish(message: WorkerToHostMessage): void {
    for (const listener of this.#listeners) listener(message);
  }

  #publishTransportFailure(message: string): void {
    this.#failureSequence += 1;
    this.#publish({
      type: "technical_failure",
      failure: TechnicalFailureSchema.parse({
        id: `failure:worker:exit:${this.#failureSequence}`,
        category: "worker",
        message,
        retryable: false,
        occurredAtRealTime: this.#now(),
      }),
    });
  }
}
