import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export async function registerStaticWeb(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, prefix: "/" });
}
