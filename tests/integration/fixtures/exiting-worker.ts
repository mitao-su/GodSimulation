process.on("message", () => {
  process.send?.({ type: "worker_ready", protocolVersion: 1 });
  setImmediate(() => process.exit(17));
});
