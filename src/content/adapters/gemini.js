(() => {
  const registry = globalThis.AICopyFix;
  registry.register(
    registry.util.makeSiteAdapter({
      id: "gemini",
      match: (location) => location.hostname.endsWith("gemini.google.com"),
      blockSelector:
        "code-block, .formatted-code-block-internal-container",
      codeSelector: 'code[data-test-id="code-content"]',
    }),
  );
})();
