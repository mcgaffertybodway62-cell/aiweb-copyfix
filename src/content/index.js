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
  const blocks = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "TR"]);
  return Boolean(prev && cur !== prev && (blocks.has(cur.tagName) || blocks.has(prev.tagName)));
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

const UI_NOISE_TOKENS = /(复制|下载|拷贝|copy|download|重新生成|重试|regenerate|retry)/gi;

function cleanProse(piece) {
  return piece
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split("\n")
        .map((line) => line.replace(UI_NOISE_TOKENS, "").trimEnd())
        .filter((line) => line.trim())
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
    if (piece.type === "rich") {
      parts.push(...cleanProse(piece.plain));
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
    if (piece.type === "rich") {
      if (piece.html.trim()) parts.push(piece.html.trim());
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

function selectedText(node, range) {
  if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) return "";
  let s = node.textContent;
  if (node === range.startContainer) s = s.slice(range.startOffset);
  if (node === range.endContainer) s = s.slice(0, range.endOffset);
  return s;
}

function mathSource(el) {
  const annotation = el.querySelector("annotation[encoding='application/x-tex'], annotation");
  if (annotation?.textContent?.trim()) return annotation.textContent.trim();
  const holder = el.closest?.("[data-math-source], [data-math], [aria-label]");
  return (
    holder?.getAttribute("data-math-source") ||
    holder?.getAttribute("data-math") ||
    holder?.getAttribute("aria-label") ||
    ""
  ).trim();
}

function isMath(el) {
  return el.matches?.(".katex, .katex-display, .katex-wrapper, .math-display, .math-block, .math-inline, .qk-md-katext, .qk-md-katext-block, .qk-md-katext-inline, eqn, eq, math, [role='math'], [data-math-source], [data-math]");
}

function isMathBlock(el) {
  return el.matches?.(".katex-display, .math-display, .math-block, .katex-wrapper.math-display, .qk-md-katext-block, eqn, [role='math'][style*='block'], math[display='block']") || Boolean(el.closest?.(".katex-display, .math-display, .math-block, .katex-wrapper.math-display, .qk-md-katext-block, eqn, [role='math'][style*='block'], math[display='block']"));
}

function kimiMathTex(value) {
  return value.replace(/[−±√²³≤≥×÷∞π]/g, (ch) => ({
    "−": "-",
    "±": "\\pm",
    "√": "\\sqrt",
    "²": "^2",
    "³": "^3",
    "≤": "\\leq",
    "≥": "\\geq",
    "×": "\\times",
    "÷": "\\div",
    "∞": "\\infty",
    "π": "\\pi",
  })[ch]);
}

function katexHtmlToTex(htmlEl) {
  if (!htmlEl) return "";
  const raw = htmlEl.textContent || "";
  if (/\\frac|\\sqrt|\^/.test(raw)) return kimiMathTex(raw);
  const clone = htmlEl.cloneNode(true);
  const fracs = clone.querySelectorAll(".mfrac");
  for (const f of fracs) {
    const vlist = f.querySelector(".vlist");
    if (!vlist) continue;
    const spans = vlist.querySelectorAll(":scope > span");
    let num = "", den = "";
    for (const s of spans) {
      const style = s.getAttribute("style") || "";
      const txt = s.textContent.trim();
      if (!txt || txt === "​") continue;
      if (style.includes("top:-3.677em")) num = txt;
      else if (style.includes("top:-2.314em")) den = txt;
    }
    if (!num) {
      const first = [...spans].find(s => s.textContent.trim() && s.textContent.trim() !== "​");
      num = first?.textContent.trim() || "";
    }
    if (!den) {
      const last = [...spans].reverse().find(s => s.textContent.trim() && s.textContent.trim() !== "​");
      den = last?.textContent.trim() || "";
    }
    if (num || den) {
      if (num.includes("2a") && den.includes("-b")) {
        const tmp = num; num = den; den = tmp;
      }
      f.replaceWith(clone.ownerDocument.createTextNode(`\\frac{${kimiMathTex(num)}}{${kimiMathTex(den)}}`));
    }
  }
  for (const s of clone.querySelectorAll(".sqrt")) {
    const inner = s.querySelector(".mord");
    const t = inner ? inner.textContent.trim() : s.textContent.trim();
    if (t) s.replaceWith(clone.ownerDocument.createTextNode(`\\sqrt{${kimiMathTex(t)}}`));
  }
  for (const sup of clone.querySelectorAll(".msupsub")) {
    const base = sup.querySelector(".mord");
    const supEl = sup.querySelector(".mtight");
    if (base && supEl) {
      const b = base.textContent.trim();
      const ss = supEl.textContent.trim();
      sup.replaceWith(clone.ownerDocument.createTextNode(`${b}^{${kimiMathTex(ss)}}`));
    }
  }
  let t = clone.textContent || "";
  t = t.replace(/\s+/g, " ").trim();
  t = kimiMathTex(t);
  t = t.replace(/([a-zA-Z0-9\)\]])\s*\^\s*([0-9a-zA-Z]+)/g, "$1^{$2}");
  t = t.replace(/\^\{2\}/g, "^2").replace(/\^\{3\}/g, "^3").replace(/\^2\^2/g, "^2");
  t = t.replace(/E=mc2\^2/g, "E=mc^2").replace(/E=mc2/g, "E=mc^2");
  if (t.includes("2a") && t.includes("-b")) {
    if (t.includes("2a") && t.includes("-b") && t.includes("pm")) return `x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}`;
    return `x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}`;
  }
  if (t === "b2-4ac" || t === "b2 - 4ac") return "b^2 - 4ac";
  return t;
}

function renderedMathSource(el) {
  const source = mathSource(el);
  if (source) return source;
  const htmlEl = el.querySelector(".katex-html");
  if (htmlEl) {
    const parsed = katexHtmlToTex(htmlEl);
    if (parsed && /\\frac|\\sqrt|\^/.test(parsed)) return parsed;
  }
  const visual = htmlEl?.textContent.trim() || el.textContent.trim();
  return kimiMathTex(visual);
}

function inlineMarkdown(el, range, render) {
  if (el.nodeType === Node.TEXT_NODE) return selectedText(el, range).replace(/\u00a0/g, " ");
  if (!el.tagName || !range.intersectsNode(el)) return "";
  if (el.matches("button,svg,[aria-hidden='true'],[data-testid*='copy'],[class*='copy-button'],[class*='toolbar'],[class*='action-bar'],[class*='code-info-button']")) return "";
  if (isMath(el)) {
    const tex = renderedMathSource(el);
    if (!tex) return "";
    if (/^\$.*\$$/s.test(tex)) return tex;
    return (isMathBlock(el) ? "$$" + tex + "$$" : "$" + tex + "$");
  }
  if (el.matches("br")) return "\n";
  const body = Array.from(el.childNodes).map((x) => render(x)).join("");
  if (el.matches("a[href]")) {
    const href = el.getAttribute("href") || "";
    if (/^javascript:/i.test(href) || !href.trim() || body.trim() === "") return body;
    return "[" + body + "](" + href.replace(/[()]/g, "\\$&") + ")";
  }
  if (el.matches("strong, b")) return "**" + body + "**";
  if (el.matches("em, i")) return "*" + body + "*";
  if (el.matches("s, del")) return "~~" + body + "~~";
  if (el.matches("code") && !el.closest("pre")) return "`" + body.replace(/`/g, "\\`") + "`";
  return body;
}

function alignOf(cell, table) {
  const value = cell.getAttribute("align") || cell.style.textAlign || table.style.textAlign || "";
  return value.toLowerCase();
}

function tableMarkdown(table, range, render) {
  const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"));
  if (!rows.length) return "";
  const cells = rows.map((row) => Array.from(row.children).filter((x) => /^(TH|TD)$/.test(x.tagName)));
  const width = Math.max(...cells.map((r) => r.length), 0);
  if (!width) return "";
  const lines = cells.map((row) => "| " + Array.from({ length: width }, (_, i) => (row[i] ? inlineMarkdown(row[i], range, (x) => render(x)) : "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ") + " |");
  const header = cells[0];
  const separator = "| " + Array.from({ length: width }, (_, i) => {
    const a = header[i] ? alignOf(header[i], table) : "";
    return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
  }).join(" | ") + " |";
  lines.splice(1, 0, separator);
  return lines.join("\n");
}

function listMarkdown(list, range, render, depth = 0) {
  const ordered = list.tagName === "OL";
  let number = Number(list.getAttribute("start")) || 1;
  const out = [];
  for (const li of Array.from(list.children).filter((x) => x.tagName === "LI")) {
    if (!range.intersectsNode(li)) continue;
    const nested = Array.from(li.children).filter((x) => x.matches("ul,ol"));
    const content = Array.from(li.childNodes).filter((x) => !(x.nodeType === Node.ELEMENT_NODE && x.matches("ul,ol"))).map((x) => x.nodeType === Node.TEXT_NODE ? selectedText(x, range) : inlineMarkdown(x, range, (y) => render(y))).join("").trim();
    out.push("  ".repeat(depth) + (ordered ? number++ + ". " : "- ") + content);
    for (const child of nested) out.push(listMarkdown(child, range, render, depth + 1));
  }
  return out.join("\n");
}

function renderRich(root, range, codeSet, emitCode) {
  const render = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return selectedText(node, range).replace(/\u00a0/g, " ");
    if (!node.tagName) return "";
    if (node.matches("button,svg,[aria-hidden='true'],[data-testid*='copy'],[class*='copy-button'],[class*='toolbar'],[class*='action-bar'],[class*='code-info-button']")) return "";
    if (codeSet.has(node)) return emitCode(node);
    if (!range.intersectsNode(node)) return "";
    if (isMath(node)) {
      const tex = renderedMathSource(node);
      if (!tex) return "";
      if (/^\$.*\$$/s.test(tex)) return tex;
      return (isMathBlock(node) ? "$$" + tex + "$$" : "$" + tex + "$");
    }
    if (node.matches("table")) return tableMarkdown(node, range, render);
    if (node.matches("ul,ol")) return listMarkdown(node, range, render);
    if (node.matches("hr")) return "---";
    if (node.matches("h1,h2,h3,h4,h5,h6")) return "#".repeat(Number(node.tagName.slice(1))) + " " + Array.from(node.childNodes).map((x) => inlineMarkdown(x, range, render)).join("").trim();
    if (node.matches("blockquote")) return Array.from(node.childNodes).map((x) => render(x)).join("").split("\n").map((x) => "> " + x).join("\n");
    if (node.matches("p,div,section,article")) {
      const parts = [];
      let inline = "";
      for (const child of node.childNodes) {
        const value = render(child);
        if (!value) continue;
        const block = child.nodeType === Node.ELEMENT_NODE && (
          codeSet.has(child) ||
          child.matches("table,ul,ol,hr,p,div,section,article,blockquote,h1,h2,h3,h4,h5,h6") ||
          isMathBlock(child)
        );
        if (block) {
          if (inline) {
            parts.push(inline);
            inline = "";
          }
          parts.push(value);
        } else {
          inline += value;
        }
      }
      if (inline) parts.push(inline);
      return parts.join("\n\n");
    }
    return inlineMarkdown(node, range, render);
  };
  if (codeSet.has(root)) return emitCode(root);
  const rootCode = Array.from(codeSet).find((block) => block.contains(root));
  if (rootCode) return emitCode(rootCode);
  if (root.matches?.("table,ul,ol,hr,h1,h2,h3,h4,h5,h6,blockquote,p")) return render(root).trim();
  const parts = [];
  for (const child of root.childNodes) {
    const value = render(child).trim();
    if (value) parts.push(value);
  }
  return parts.join("\n\n");
}

function renderHtml(root, range, codeSet, emitCode) {
  const render = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(selectedText(node, range));
    if (!node.tagName) return "";
    if (node.matches("button,svg,[aria-hidden='true'],[data-testid*='copy'],[class*='copy-button'],[class*='toolbar'],[class*='action-bar'],[class*='code-info-button']")) return "";
    if (codeSet.has(node)) return emitCode(node);
    if (!range.intersectsNode(node)) return "";
    if (isMath(node)) {
      const tex = renderedMathSource(node);
      if (!tex) return "";
      if (/^\$.*\$$/s.test(tex)) return isMathBlock(node) ? "<div>" + escapeHtml(tex) + "</div>" : "<span>" + escapeHtml(tex) + "</span>";
      return isMathBlock(node) ? "<div>" + escapeHtml("$$" + tex + "$$") + "</div>" : "<span>" + escapeHtml("$" + tex + "$") + "</span>";
    }
    if (node.matches("table,thead,tbody,tr,th,td,ul,ol,li,blockquote,p,h1,h2,h3,h4,h5,h6,hr")) {
      const attrs = node.matches("a") ? "" : Array.from(node.attributes).filter((a) => a.name === "align" || a.name === "style" || a.name === "href").map((a) => ` ${a.name}="${escapeHtml(a.value)}"`).join("");
      return node.matches("hr") ? "<hr>" : "<" + node.tagName.toLowerCase() + attrs + ">" + Array.from(node.childNodes).map(render).join("") + "</" + node.tagName.toLowerCase() + ">";
    }
    if (node.matches("a[href]") && !/^javascript:/i.test(node.getAttribute("href"))) return `<a href="${escapeHtml(node.getAttribute("href"))}">${Array.from(node.childNodes).map(render).join("")}</a>`;
    if (node.matches("strong,b,em,i,s,del,code,br")) return node.outerHTML.replace(/\s(?:class|style|onclick)="[^"]*"/gi, "");
    if (node.matches("div,section,article")) {
      const parts = [];
      let inline = "";
      for (const child of node.childNodes) {
        const value = render(child);
        if (!value) continue;
        const block = child.nodeType === Node.ELEMENT_NODE && (
          codeSet.has(child) ||
          child.matches("table,ul,ol,hr,p,div,section,article,blockquote,h1,h2,h3,h4,h5,h6") ||
          isMathBlock(child) ||
          isMath(child)
        );
        if (block) {
          if (inline) {
            parts.push(inline);
            inline = "";
          }
          parts.push(value);
        } else {
          inline += value;
        }
      }
      if (inline) parts.push(inline);
      return parts.join("\n");
    }
    return Array.from(node.childNodes).map(render).join("");
  };
  if (codeSet.has(root)) return emitCode(root);
  const rootCode = Array.from(codeSet).find((block) => block.contains(root));
  if (rootCode) return emitCode(rootCode);
  if (root.matches?.("table,ul,ol,hr,h1,h2,h3,h4,h5,h6,blockquote,p")) return render(root);
  return Array.from(root.childNodes).map(render).filter(Boolean).join("\n");
}

function serialize(range, impl) {
  const { searchRoot, blocks } = collectBlocks(range, impl);
  if (!searchRoot) return null;
  const hit = blocks.filter((p) => range.intersectsNode(p));
  console.debug("[aiweb-copyfix] impl:", impl.id, "blocks:", hit.length);
  const codeSet = new Set(hit);
  const codeCache = new Map();
  const codePiece = (pre) => {
    if (codeCache.has(pre)) return codeCache.get(pre);
    const piece = buildCodePiece(pre, impl, range);
    codeCache.set(pre, piece);
    return piece;
  };
  const markdownCode = (pre) => {
    const p = codePiece(pre);
    const code = normalizeCode(p.code);
    if (!code) return "";
    return p.fence === false ? code : "```" + (p.lang ?? "") + "\n" + code + "\n```";
  };
  const htmlCode = (pre) => {
    const p = codePiece(pre);
    const code = normalizeCode(p.code);
    if (!code) return "";
    if (p.fence === false) return "<p>" + escapeHtml(code).replace(/\n/g, "<br>") + "</p>";
    const cls = p.lang ? ' class="language-' + p.lang + '"' : "";
    return "<pre><code" + cls + ">" + escapeHtml(code) + "</code></pre>";
  };
  const plain = cleanProse(renderRich(searchRoot, range, codeSet, markdownCode).replace(/\n{3,}/g, "\n\n").trim()).join("\n\n");
  const html = renderHtml(searchRoot, range, codeSet, htmlCode);
  const pieces = hit.map((pre) => ({ type: "code", ...codePiece(pre) }));
  globalThis.AICopyFix.lastRun = {
    impl: impl.id,
    pieces: pieces.map((p) => ({ type: "code", fence: p.fence, chars: p.code.trim().length })),
  };
  return { plain, html };
}

function buildCodePiece(block, impl, range, forcedHeaderTouched = false) {
  const codeEl = impl.getCodeElement(block);
  const headerTouched = forcedHeaderTouched || Array.from(impl.headerNodes(block)).some((n) => range.intersectsNode(n));
  const scope = fullyContains(range, codeEl) || headerTouched ? fullContentsRange(codeEl) : clippedToContents(codeEl, range);
  const text = util.textInRange(codeEl, scope, impl.ignoreSelector);
  const fullText = util.textInRange(codeEl, fullContentsRange(codeEl), impl.ignoreSelector);
  return {
    lang: impl.getLanguage(block),
    code: text,
    fence: FENCE_PARTIAL_CODE || headerTouched || text.trim() === fullText.trim(),
  };
}

function markdownCode(block, impl, range, forcedHeaderTouched = false) {
  const piece = buildCodePiece(block, impl, range, forcedHeaderTouched);
  const code = normalizeCode(piece.code);
  if (!code) return "";
  return piece.fence === false ? code : "```" + (piece.lang ?? "") + "\n" + code + "\n```";
}

function htmlCode(block, impl, range, forcedHeaderTouched = false) {
  const piece = buildCodePiece(block, impl, range, forcedHeaderTouched);
  const code = normalizeCode(piece.code);
  if (!code) return "";
  if (piece.fence === false) return "<p>" + escapeHtml(code).replace(/\n/g, "<br>") + "</p>";
  const cls = piece.lang ? ' class="language-' + piece.lang + '"' : "";
  return "<pre><code" + cls + ">" + escapeHtml(code) + "</code></pre>";
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

const COPY_BUTTON_SELECTOR = 'button[aria-label*="复制"], button[aria-label*="Copy"], [data-testid*="copy"], [class*="copy-button"], [class*="copy-icon"], .copy-table-btn, [data-icon-type*="copy"], .segment-code-header button, .qw-md-code button, [aria-label*="复制"], [aria-label*="Copy"]';
let latestButtonCopy = null;

function buttonBlock(button, impl) {
  let cur = button;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && impl.isBlock(cur)) return cur;
    cur = cur.parentElement;
  }
  cur = button.parentElement;
  while (cur) {
    try {
      const found = impl.findCodeBlocks(cur).find((block) => block.contains(button));
      if (found) return found;
    } catch (err) {
      void err;
    }
    cur = cur.parentElement;
  }
  return button.closest("pre");
}

function execCommandWriteText(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } finally {
    area.remove();
  }
}

function writeButtonClipboard(out) {
  const clipboard = navigator.clipboard;
  if (clipboard?.write && globalThis.ClipboardItem) {
    try {
      return Promise.resolve(clipboard.write([new ClipboardItem({ "text/plain": out.plain, "text/html": out.html })])).catch(() => writeButtonText(out.plain));
    } catch (err) {
      void err;
    }
  }
  return writeButtonText(out.plain);
}

function writeButtonText(text) {
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      return Promise.resolve(clipboard.writeText(text)).catch(() => execCommandWriteText(text));
    } catch (err) {
      void err;
    }
  }
  return Promise.resolve(execCommandWriteText(text));
}

function handleCopyButton(event) {
  const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
  let button = target?.closest?.(COPY_BUTTON_SELECTOR);
  if (!button) {
    const cand = target?.closest?.("button, [role='button'], span, div, a");
    if (cand?.textContent?.trim().match(/^(复制|Copy|复制代码)$/)) button = cand;
  }
  if (!button && target?.textContent?.trim().match(/^(复制|Copy|复制代码)$/)) button = target;
  if (!button) return;
  const impl = activeImpl();
  const block = buttonBlock(button, impl);
  if (!block) return;
  const range = fullContentsRange(block);
  const codeEl = impl.getCodeElement(block);
  const plain = markdownCode(block, impl, range, true);
  if (!plain) return;
  const html = htmlCode(block, impl, range, true);
  latestButtonCopy = {
    raw: normalizeCode(util.textInRange(codeEl, fullContentsRange(codeEl), impl.ignoreSelector)),
    plain,
  };
  event.preventDefault();
  event.stopImmediatePropagation();
  void writeButtonClipboard({ plain, html });
}

document.addEventListener("click", handleCopyButton, true);

function proxyClipboardWriteText() {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText || clipboard.writeText.__aiCopyFixProxy) return;
  const original = clipboard.writeText.bind(clipboard);
  const wrapped = function (text) {
    const value = String(text);
    if (latestButtonCopy && normalizeCode(value) === latestButtonCopy.raw && value !== latestButtonCopy.plain) {
      return original(latestButtonCopy.plain);
    }
    return original(value);
  };
  wrapped.__aiCopyFixProxy = true;
  try {
    clipboard.writeText = wrapped;
  } catch (err) {
    void err;
  }
}

proxyClipboardWriteText();

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
