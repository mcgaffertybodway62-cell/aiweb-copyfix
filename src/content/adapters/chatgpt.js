(() => {
  const registry = globalThis.AICopyFix;
  const adapter = registry.util.makeSiteAdapter({
      id: "chatgpt",
      match: (location) =>
        location.hostname.endsWith("chatgpt.com") ||
        location.hostname.endsWith("chat.openai.com"),
      blockSelector: "pre.overflow-visible",
      codeSelector: "pre.cm-content code",
      ignoreSelector: null,
    });
  adapter.getCodeElement = (block) => block.querySelector("pre.cm-content code") ?? block;
  registry.register(adapter);
})();
