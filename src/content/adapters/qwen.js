(() => {
  const registry = globalThis.AICopyFix;
  registry.register(
    registry.util.makeSiteAdapter({
      id: "qwen",
      match: (location) =>
        location.hostname.endsWith("qianwen.com") ||
        location.hostname === "tongyi.aliyun.com",
      blockSelector: ".qw-md-code",
      codeSelector: "pre",
      ignoreSelector: ".linenumber",
    }),
  );
})();
