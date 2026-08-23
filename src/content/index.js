globalThis.AICopyFix = {
  adapters: [],
  register(adapter) {
    this.adapters.push(adapter);
    console.debug("[aiweb-copyfix] adapter registered:", adapter.id);
  },
};

const util = {};

const LANG_TOKEN = /^[a-z][a-z0-9+#._-]{0,19}$/;
const LANG_NOISE = new Set(["copy", "code", "拷贝", "复制", "复制代码", "代码", "下载"]);
const LANGUAGE_PREFIX = "language-";
const CONFIG = globalThis.AIWEB_COPYFIX_CONFIG ?? {};
const FENCE_PARTIAL_CODE = CONFIG.fencePartialCode === true;

util.findPres = (root) => Array.from(root.querySelectorAll("pre"));

util.textInRange = (container, range, ignore) => {
  let out = "";
  let prevParent = null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    if (ignore && n.parentElement?.closest(ignore)) continue;
    let s = n.textContent;
    if (n === range.startContainer) s = s.slice(range.startOffset);
    if (n === range.endContainer) s = s.slice(0, range.endOffset);
    if (!s) continue;
    const p = n.parentElement;
    if (crossesBlockBoundary(prevParent, p)) out += "\n";
    prevParent = p;
    out += s;
  }
  return out;
};

util.langFromNodes = (nodes) => {
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim().toLowerCase();
      if (LANG_TOKEN.test(t) && !LANG_NOISE.has(t)) return t;
      continue;
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim().toLowerCase();
      if (LANG_TOKEN.test(t) && !LANG_NOISE.has(t)) return t;
    }
  }
  return null;
};

util.langFromClass = (el) => {
  if (!el) return null;
  const cls = Array.from(el.classList).find((c) => c.startsWith(LANGUAGE_PREFIX));
  return cls ? cls.slice(LANGUAGE_PREFIX.length) : null;
};

util.langFromAttr = (root) => {
  const holder = root.querySelector("[data-language], [data-lang]");
  const lang =
    holder?.getAttribute("data-language") ?? holder?.getAttribute("data-lang");
  return lang ? lang.toLowerCase() : null;
};

util.structuralHeaders = (block, codeEl) => {
  const set = new Set();
  let cur = codeEl === block ? null : codeEl;
  while (cur && cur !== block) {
    for (const sib of cur.parentElement.children) {
      if (sib !== cur) set.add(sib);
    }
    cur = cur.parentElement;
  }
  for (const el of block.querySelectorAll("button, svg")) {
    if (!codeEl.contains(el)) set.add(el);
  }
  return set;
};

globalThis.AICopyFix.util = util;

util.makeSiteAdapter = ({ id, match, blockSelector, codeSelector, ignoreSelector }) => ({
  id,
  match,
  ignoreSelector,
  isBlock: (el) => el.matches(blockSelector),
  findCodeBlocks(root) {
    const blocks = Array.from(root.querySelectorAll(blockSelector));
    if (blocks.length > 0) {
      for (const pre of util.findPres(root)) {
        if (!blocks.some((b) => b.contains(pre))) blocks.push(pre);
      }
      return blocks;
    }
    return util.findPres(root);
  },
  getCodeElement(block) {
    if (block.matches("pre")) return block;
    return (
      block.querySelector(codeSelector) ??
      block.querySelector("pre") ??
      block.querySelector("code") ??
      block
    );
  },
  headerNodes(block) {
    return util.structuralHeaders(block, this.getCodeElement(block));
  },
  getLanguage(block) {
    return (
      util.langFromNodes(this.headerNodes(block)) ??
      util.langFromAttr(block) ??
      util.langFromClass(this.getCodeElement(block))
    );
  },
});

function defaultImpl() {
  return {
    id: "generic",
    isBlock: (el) => el.tagName === "PRE",
    findCodeBlocks: util.findPres,
    getCodeElement: (block) => block.querySelector("code") ?? block,
    headerNodes(block) {
      return util.structuralHeaders(block, this.getCodeElement(block));
    },
    getLanguage(block) {
      return (
        util.langFromNodes(this.headerNodes(block)) ??
        util.langFromAttr(block) ??
        util.langFromClass(this.getCodeElement(block))
      );
    },
  };
}

function activeImpl() {
  const adapter = globalThis.AICopyFix.adapters.find((a) =>
    a.match(globalThis.location),
  );
  return adapter ?? defaultImpl();
}

function pruneContained(candidates) {
  return candidates.filter(
    (a) => !candidates.some((b) => b !== a && b.contains(a)),
  );
}

function crossesBlockBoundary(prev, cur) {
  return Boolean(
    prev && cur !== prev && (cur.tagName === "DIV" || prev.tagName === "DIV"),
  );
}

function fullContentsRange(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r;
}

function fullyContains(range, el) {
  return (
    range.compareBoundaryPoints(Range.START_TO_START, fullContentsRange(el)) <=
      0 &&
    range.compareBoundaryPoints(Range.END_TO_END, fullContentsRange(el)) >= 0
  );
}

function clippedToContents(el, range) {
  const r = fullContentsRange(el);
  if (r.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
    r.setStart(range.startContainer, range.startOffset);
  }
  if (r.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
    r.setEnd(range.endContainer, range.endOffset);
  }
  return r;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function normalizeCode(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\n+$/, "")
    .replace(/^\n+/, "");
}

const UI_NOISE_TOKENS = /(复制|下载|拷贝|copy|download)/gi;

function cleanProse(piece) {
  return piece
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split("\n")
        .map((line) => line.replace(UI_NOISE_TOKENS, "").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
}

function assemblePlain(pieces) {
  const parts = [];
  for (const piece of pieces) {
    if (typeof piece === "string") {
      parts.push(...cleanProse(piece));
      continue;
    }
    const code = normalizeCode(piece.code);
    if (!code) continue;
    parts.push(
      piece.fence === false
        ? code
        : "```" + (piece.lang ?? "") + "\n" + code + "\n```",
    );
  }
  return parts.join("\n\n");
}

function assembleHtml(pieces) {
  const parts = [];
  for (const piece of pieces) {
    if (typeof piece === "string") {
      for (const para of cleanProse(piece)) {
        parts.push("<p>" + escapeHtml(para).replace(/\n/g, "<br>") + "</p>");
      }
      continue;
    }
    const code = normalizeCode(piece.code);
    if (!code) continue;
    if (piece.fence === false) {
      parts.push("<p>" + escapeHtml(code).replace(/\n/g, "<br>") + "</p>");
      continue;
    }
    const cls = piece.lang ? ' class="language-' + piece.lang + '"' : "";
    parts.push("<pre><code" + cls + ">" + escapeHtml(code) + "</code></pre>");
  }
  return parts.join("\n");
}

function collectBlocks(range, impl) {
  const anchor = range.commonAncestorContainer;
  const searchRoot =
    anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
  if (!searchRoot) return { searchRoot: null, blocks: [] };
  const candidates = new Set(impl.findCodeBlocks(searchRoot));
  for (const edge of [range.startContainer, range.endContainer]) {
    let cur = edge.nodeType === Node.TEXT_NODE ? edge.parentElement : edge;
    while (cur) {
      if (impl.isBlock(cur)) candidates.add(cur);
      cur = cur.parentElement;
    }
  }
  return { searchRoot, blocks: pruneContained(Array.from(candidates)) };
}

function serialize(range, impl) {
  const { searchRoot, blocks } = collectBlocks(range, impl);
  if (!searchRoot) return null;
  const hit = blocks.filter((p) => range.intersectsNode(p));
  if (hit.length === 0) return null;
  console.debug("[aiweb-copyfix] impl:", impl.id, "blocks:", hit.length);
  const pending = new Set(hit);
  const hitSet = new Set(hit);

  function ownerOf(node, set) {
    let cur = node.parentElement;
    while (cur) {
      if (set.has(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  const pieces = [];
  let buf = "";
  let prevParent = null;
  const flush = () => {
    const t = buf.replace(/\r\n/g, "\n").trim();
    if (t) pieces.push(t);
    buf = "";
  };

  const emitCode = (pre) => {
    flush();
    const codeEl = impl.getCodeElement(pre);
    const headerTouched = Array.from(impl.headerNodes(pre)).some((n) =>
      range.intersectsNode(n),
    );
    const scope =
      fullyContains(range, codeEl) || headerTouched
        ? fullContentsRange(codeEl)
        : clippedToContents(codeEl, range);
    const text = util.textInRange(codeEl, scope, impl.ignoreSelector);
    const fullText = util.textInRange(
      codeEl,
      fullContentsRange(codeEl),
      impl.ignoreSelector,
    );
    pieces.push({
      lang: impl.getLanguage(pre),
      code: text,
      fence:
        FENCE_PARTIAL_CODE ||
        headerTouched ||
        text.trim() === fullText.trim(),
    });
  };

  const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT);  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const owner = ownerOf(n, pending);
    if (owner) {
      pending.delete(owner);
      emitCode(owner);
      continue;
    }
    if (ownerOf(n, hitSet)) continue;
    let s = n.textContent;
    if (n === range.startContainer) s = s.slice(range.startOffset);
    if (n === range.endContainer) s = s.slice(0, range.endOffset);
    if (!s) continue;
    const p = n.parentElement;
    if (crossesBlockBoundary(prevParent, p)) buf += "\n";
    prevParent = p;
    buf += s;
  }
  flush();

  for (const pre of pending) emitCode(pre);

  const plain = assemblePlain(pieces);
  const html = assembleHtml(pieces);
  globalThis.AICopyFix.lastRun = {
    impl: impl.id,
    pieces: pieces.map((p) =>
      typeof p === "string"
        ? { type: "text", chars: p.length }
        : { type: "code", fence: p.fence, chars: p.code.trim().length },
    ),
  };
  return { plain, html };
}

function handleCopy(event) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const impl = activeImpl();
  let out;
  try {
    out = serialize(range, impl);
  } catch (err) {
    console.warn("[aiweb-copyfix] serialize failed, falling back to default", err);
    return;
  }
  if (!out || !out.plain) return;
  event.clipboardData.setData("text/plain", out.plain);
  event.clipboardData.setData("text/html", out.html);
  event.preventDefault();
  console.debug("[aiweb-copyfix] rewrote clipboard:", {
    impl: impl.id,
    plainChars: out.plain.length,
    htmlChars: out.html.length,
  });
}

document.addEventListener("copy", handleCopy);

globalThis.AICopyFix.inspect = () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return "no selection";
  }
  const range = selection.getRangeAt(0);
  const impl = activeImpl();
  const { searchRoot, blocks } = collectBlocks(range, impl);
  let out;
  try {
    out = serialize(range, impl);
  } catch (err) {
    out = { plain: "ERR: " + err.message, html: "" };
  }
  return {
    impl: impl.id,
    searchRoot: searchRoot ? `${searchRoot.tagName}.${String(searchRoot.className).slice(0, 50)}` : null,
    blocks: blocks.map((el) => `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/)[0] : ""}`),
    lastRun: globalThis.AICopyFix.lastRun ?? null,
    selected: out.plain,
    htmlChars: (out.html ?? "").length,
  };
};

window.addEventListener("aicopyfix-inspect", () => {
  console.log("[aiweb-copyfix] inspect:", globalThis.AICopyFix.inspect());
});
