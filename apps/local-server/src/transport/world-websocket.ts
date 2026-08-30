import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { WorldCommandSchema, WorldViewSchema } from "@god-sim/protocol";

import type { SessionClientPort } from "../sessions/session-coordinator";

export async function registerWorldWebSocket(
  app: FastifyInstance,
  session: SessionClientPort,
): Promise<void> {
  await app.register(websocket);
  app.get("/api/events", { websocket: true }, (socket) => {
    let commandTail = Promise.resolve();
    socket.on("message", (raw: { toString(): string }) => {
      commandTail = commandTail
        .then(async () => {
          const command = WorldCommandSchema.parse(JSON.parse(raw.toString()));
          await session.sendCommand(command);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          app.log.warn({ error: message.slice(0, 500) }, "Rejected WebSocket command");
          socket.close(1008, "Invalid world command");
        });
    });

    const unsubscribe = session.subscribe((view) => {
      if (socket.readyState !== 1) return;
      socket.send(JSON.stringify(WorldViewSchema.parse(view)));
    });
    socket.once("close", unsubscribe);
  });
}
