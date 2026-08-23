(() => {
  const registry = globalThis.AICopyFix;
  registry.register(
    registry.util.makeSiteAdapter({
      id: "deepseek",
      match: (location) => location.hostname.endsWith("deepseek.com"),
      blockSelector: ".md-code-block",
      codeSelector: "pre",
    }),
  );
})();
