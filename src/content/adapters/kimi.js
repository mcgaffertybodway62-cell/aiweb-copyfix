(() => {
  const registry = globalThis.AICopyFix;
  registry.register(
    registry.util.makeSiteAdapter({
      id: "kimi",
      match: (location) =>
        location.hostname.endsWith("kimi.com") ||
        location.hostname.endsWith("moonshot.cn"),
      blockSelector: ".segment-code",
      codeSelector: "pre",
    }),
  );
})();
