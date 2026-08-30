import type { FastifyInstance } from "fastify";
import { WorldCommandSchema } from "@god-sim/protocol";

import type { SessionClientPort } from "../sessions/session-coordinator";

export function registerHttpRoutes(app: FastifyInstance, session: SessionClientPort): void {
  app.get("/api/health", async () => ({
    status: "ok",
    worldReady: session.getView() !== null,
  }));

  app.get("/api/world", async (_request, reply) => {
    const view = session.getView();
    if (!view) return reply.code(503).send({ error: "world_not_ready" });
    return view;
  });

  app.post("/api/commands", async (request, reply) => {
    const parsed = WorldCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_world_command" });
    }
    await session.sendCommand(parsed.data);
    return reply.code(202).send({ accepted: true, commandId: parsed.data.commandId });
  });
}
