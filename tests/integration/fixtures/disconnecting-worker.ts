process.on("message", () => {
  process.send?.({ type: "worker_ready", protocolVersion: 1 });
  setImmediate(() => process.disconnect());
  setInterval(() => undefined, 1_000);
});
