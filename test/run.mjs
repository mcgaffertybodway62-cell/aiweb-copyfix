import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(ROOT, "test", "fixtures");

const SITES = [
  {
    file: "deepseek.html",
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    block: ".md-code-block",
    code: "pre",
    lang: "c",
    noise: ["复制", "下载"],
  },
  {
    file: "gemini.html",
    name: "Gemini",
    url: "https://gemini.google.com/",
    block: "code-block",
    code: 'code[data-test-id="code-content"]',
    lang: "c",
    noise: ["复制", "下载"],
  },
  {
    file: "kimi.html",
    name: "Kimi",
    url: "https://www.kimi.com/",
    block: ".segment-code",
    code: "pre",
    lang: "c",
    noise: ["复制", "下载"],
  },
  {
    file: "glm.html",
    name: "GLM",
    url: "https://chatglm.cn/",
    block: ".code-no-artifacts",
    code: "pre.hljs",
    lang: "c",
    noise: ["复制", "下载"],
  },
  {
    file: "qwen.html",
    name: "Qwen",
    url: "https://www.qianwen.com/",
    block: ".qw-md-code",
    code: "pre",
    lang: "c",
    ignore: ".linenumber",
    noise: ["复制", "下载"],
  },
];

const INDEX = fs.readFileSync(path.join(ROOT, "src/content/index.js"), "utf8");
const ADAPTERS = fs
  .readdirSync(path.join(ROOT, "src/content/adapters"))
  .sort()
  .map((f) => ({
    file: f,
    code: fs.readFileSync(path.join(ROOT, "src/content/adapters", f), "utf8"),
  }));

function bootDom(site) {
  const html = fs.readFileSync(path.join(DOCS, site.file), "utf8");
  const dom = new JSDOM(html, { url: site.url, runScripts: "outside-only" });
  const { window } = dom;
  window.eval(INDEX);
  for (const a of ADAPTERS) window.eval(a.code);
  return dom.window;
}

function injectHelpers(window) {
  window.eval(`
    window.__textNodes = (root, ignore) => {
      const out = [];
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (ignore && n.parentElement && n.parentElement.closest(ignore)) continue;
        out.push(n);
      }
      return out;
    };
    window.__copySelected = () => {
      const store = {};
      const ev = new Event("copy", { bubbles: true, cancelable: true });
      ev.clipboardData = {
        setData(type, value) { store[type] = value; },
        getData(type) { return store[type] ?? ""; },
      };
      document.dispatchEvent(ev);
      return { plain: store["text/plain"] ?? "", html: store["text/html"] ?? "", canceled: ev.defaultPrevented };
    };
  `);
}

function scenarios(window, site) {
  const doc = window.document;
  const container = doc.querySelector(site.block);
  if (!container) return [{ name: "*", error: `container ${site.block} not found` }];
  const codeEl =
    container.querySelector(site.code) ??
    container.querySelector("code") ??
    container;
  const tn = (root) => window.__textNodes(root, site.ignore).filter((n) => n.textContent.trim());
  const contTexts = tn(container);
  const codeTexts = tn(codeEl);
  const last = (a) => a[a.length - 1];
  const sel = window.getSelection();
  const run = (name, setup) => {
    sel.removeAllRanges();
    const r = doc.createRange();
    try {
      setup(r);
    } catch (err) {
      return { name, error: err.message };
    }
    if (r.collapsed) return { name, error: "collapsed range" };
    sel.addRange(r);
    const res = window.__copySelected();
    sel.removeAllRanges();
    return { name, ...res };
  };
  const out = [];
  out.push(
    run("inner-whole", (r) => {
      r.selectNodeContents(codeEl);
    }),
  );
  out.push(
    run("header-only", (r) => {
      if (!contTexts.length || contTexts[0] === codeTexts[0])
        throw new Error("no separate header");
      r.selectNodeContents(contTexts[0]);
    }),
  );
  out.push(
    run("header+code", (r) => {
      if (!contTexts.length || contTexts[0] === codeTexts[0]) throw new Error("no separate header");
      r.setStart(contTexts[0], 0);
      r.setEnd(last(codeTexts), last(codeTexts).textContent.length);
    }),
  );
  out.push(
    run("intro+block", (r) => {
      let p = container.previousElementSibling;
      while (p && !p.textContent.trim()) p = p.previousElementSibling;
      if (!p) throw new Error("no preceding sibling");
      const pt = tn(p).filter((n) => n.textContent.trim());
      if (!pt.length) throw new Error("no preceding text");
      const s = last(pt);
      r.setStart(s, Math.floor(s.textContent.trim().length / 2));
      r.setEnd(last(codeTexts), last(codeTexts).textContent.length);
    }),
  );
  out.push(
    run("partial-code", (r) => {
      if (codeTexts.length < 3) throw new Error("too few text nodes");
      const from = codeTexts[1];
      const to = last(codeTexts);
      r.setStart(from, 0);
      r.setEnd(to, to.textContent.length);
      if (r.collapsed) throw new Error("collapsed");
    }),
  );
  out.push(
    run("container-whole", (r) => {
      r.selectNodeContents(container);
    }),
  );
  out.push(
    run("whole-message", (r) => {
      let rootMsg = container;
      while (rootMsg.parentElement && rootMsg.parentElement.textContent.includes(codeEl.textContent)) {
        const up = rootMsg.parentElement;
        if (up === doc.body) break;
        rootMsg = up;
        if (rootMsg.childElementCount > 3) break;
      }
      r.selectNodeContents(rootMsg);
    }),
  );
  return out;
}

function judge(site, r) {
  if (r.error) return { status: "SKIP", reason: r.error };
  if (!r.canceled) return { status: "FAIL", reason: "copy event not intercepted" };
  const fenced = r.plain.includes("```");
  const noisy = site.noise.filter((w) => r.plain.includes(w) || (r.html && r.html.includes(w)));
  const reasons = [];
        if (r.name === "partial-code") {
          if (fenced) reasons.push("expected raw fragment but found fence");
          if (r.html && r.html.includes("<pre"))
            reasons.push("html should not contain pre for fragment");
        } else {
    if (!fenced) reasons.push("missing fence");
    else if (!r.plain.includes("```" + site.lang)) reasons.push(`fence language != ${site.lang}`);
  }
  if (noisy.length) reasons.push(`noise leaked: ${noisy.join(",")}`);
  if (reasons.length) return { status: "FAIL", reason: reasons.join("; ") };
  return { status: "PASS", reason: "" };
}

const report = [];
let pass = 0;
let fail = 0;
for (const site of SITES) {
  let window;
  try {
    window = bootDom(site);
  } catch (err) {
    report.push({ site: site.name, scenario: "*", status: "FAIL", reason: "dom boot: " + err.message });
    fail++;
    continue;
  }
  injectHelpers(window);
  const adapterIds = window.eval("AICopyFix.adapters.map(a => a.id)").join(",");
  const matched = window.eval(
    `AICopyFix.adapters.some(a => a.match(location))`,
  );
  for (const r of scenarios(window, site)) {
    const j = judge(site, r);
    if (j.status === "PASS") pass++;
    else if (j.status === "FAIL") fail++;
    report.push({
      site: `${site.name}${matched ? "" : "(NO-MATCH!)"}`,
      scenario: r.name,
      status: j.status,
      reason: [!matched ? "adapter match() false" : "", j.reason].filter(Boolean).join("; "),
      head: (r.plain ?? "").slice(0, 70).replace(/\n/g, "\\n"),
    });
  }
  void adapterIds;
}

console.table(report.map(({ site, scenario, status, reason }) => ({ site, scenario, status, reason })));
const md = [
  "| 站点 | 场景 | 结果 | 原因 | 输出头部 |",
  "| --- | --- | --- | --- | --- |",
  ...report.map(
    (r) =>
      `| ${r.site} | ${r.scenario} | ${r.status} | ${r.reason || "-"} | \`${(r.head ?? "").replace(/\|/g, "\\|")}\` |`,
  ),
].join("\n");
fs.mkdirSync(path.join(ROOT, "test"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "test", "report.md"), md + "\n");
console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
