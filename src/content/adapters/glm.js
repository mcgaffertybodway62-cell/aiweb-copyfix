(() => {
  const registry = globalThis.AICopyFix;
  registry.register(
    registry.util.makeSiteAdapter({
      id: "glm",
      match: (location) => location.hostname.endsWith("chatglm.cn"),
      blockSelector: ".code-no-artifacts",
      codeSelector: "pre.hljs",
    }),
  );
})();
