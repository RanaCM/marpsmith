#!/usr/bin/env node
/*
 * lint-deck.mjs — pre-flight markdown linter for Marp decks.
 *
 * Fast, render-free static analysis. Catches deck-quality issues before the
 * expensive auto-fit + browser render pass. No Puppeteer, no Chrome.
 *
 * Mechanizes the cheap eyeball checks documented in SKILL.md:
 *   - Layout repetition (Cross-deck variety rule)
 *   - Sparse prose
 *   - Asymmetric comparison columns
 *   - Pull-quote attribution
 *   - Heading wrap risk (character budgets)
 *   - Process-flow verb/temporal cues
 *   - Bullet-list density
 *   - Table row count
 *   - Frontmatter sanity
 *   - Duplicate _class directives
 *
 * Usage:
 *   node lint-deck.mjs <deck.md> [--severity high|med|low] [--json]
 *
 * Exit codes:
 *   0 — no findings at or above the severity threshold
 *   1 — findings present
 *   2 — script error
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── arg parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error(
    "Usage: node lint-deck.mjs <deck.md> [--severity high|med|low] [--json]"
  );
  process.exit(2);
}
const deck = resolve(args[0]);
let threshold = "low"; // default: report everything
let outputJson = false;
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--severity" && args[i + 1]) {
    const v = args[++i].toLowerCase();
    if (!["high", "med", "low"].includes(v)) {
      console.error(`Invalid severity: ${v}. Must be one of high|med|low.`);
      process.exit(2);
    }
    threshold = v;
  } else if (a === "--json") {
    outputJson = true;
  } else {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}
if (!existsSync(deck)) {
  console.error(`Deck not found: ${deck}`);
  process.exit(2);
}

const src = readFileSync(deck, "utf8");

// ─── markdown parsing ───────────────────────────────────────────────

const COVER_LIKE_LAYOUTS = new Set([
  "title-cover",
  "section-divider",
  "big-stat-hero",
  "pull-quote",
]);

function parseDeck(src) {
  // Split off frontmatter.
  let frontmatter = "";
  let body = src;
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    frontmatter = fmMatch[1];
    body = src.slice(fmMatch[0].length);
  }
  // Split slides on `---` lines, ignoring fences.
  const lines = body.split("\n");
  const slides = [];
  let buf = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "---") {
      slides.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  slides.push(buf.join("\n"));
  return { frontmatter, slides };
}

// Per-slide parser — extracts:
//   - all `<!-- _class: ... -->` directives (raw class tokens, may include scale)
//   - layout class (the non-scale class), trimmed
//   - heading text + level (first heading only)
//   - rough body content for word counting (heading + directives + fences excluded)
function parseSlide(raw) {
  const classDirectives = [];
  const re = /<!--\s*_class:\s*([^>]+?)\s*-->/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    classDirectives.push(m[1].trim());
  }
  // Layout class = first non-scale token across all directives (Marp uses last
  // directive, but for "duplicate _class" check we keep them all; for layout
  // identification we take the *last* directive's first non-scale token to
  // match Marp's actual behavior).
  let layout = null;
  if (classDirectives.length > 0) {
    const lastDirective = classDirectives[classDirectives.length - 1];
    const tokens = lastDirective.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      if (!/^[hb]-\d+$/.test(t)) {
        layout = t;
        break;
      }
    }
  }

  // Extract first heading.
  let heading = null;
  let headingLevel = 0;
  const headingMatch = raw.match(/^(#{1,6})\s+(.+?)$/m);
  if (headingMatch) {
    headingLevel = headingMatch[1].length;
    heading = headingMatch[2].trim();
  }

  // Body content for word counting — strip frontmatter-ish stuff:
  //   - `<!-- ... -->` comments
  //   - fenced code blocks
  //   - HTML tags
  //   - markdown heading markers
  //   - list markers, blockquote markers
  // Then count words.
  let body = raw;
  body = body.replace(/<!--[\s\S]*?-->/g, " ");
  body = body.replace(/```[\s\S]*?```/g, " ");
  body = body.replace(/`[^`]*`/g, " ");
  // Preserve the heading text but strip the leading `#`s
  body = body.replace(/^(#{1,6})\s+/gm, "");

  return { raw, classDirectives, layout, heading, headingLevel, body };
}

function countWords(text) {
  if (!text) return 0;
  // Strip HTML tags and markdown markers for a rough word count.
  let s = text;
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/[*_>`~|]/g, " ");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  return s.split(/\s+/).filter((w) => w.length > 0).length;
}

// ─── individual rule checks ─────────────────────────────────────────

// Rule 9: frontmatter sanity (HIGH)
function checkFrontmatter(parsed, findings) {
  const fm = parsed.frontmatter;
  if (!fm) {
    findings.push({
      severity: "high",
      rule: "frontmatter-missing",
      slides: [],
      message: "Deck has no YAML frontmatter — Marp will not recognize it as a slide deck",
    });
    return;
  }
  if (!/^\s*marp\s*:\s*true\s*$/m.test(fm)) {
    findings.push({
      severity: "high",
      rule: "frontmatter-no-marp",
      slides: [],
      message: "Frontmatter is missing `marp: true`",
    });
  }
  if (!/^\s*theme\s*:\s*\S+/m.test(fm)) {
    findings.push({
      severity: "high",
      rule: "frontmatter-no-theme",
      slides: [],
      message: "Frontmatter is missing `theme: <name>`",
    });
  }
}

// Rule 10: duplicate `_class` directives on the same slide (HIGH)
function checkDuplicateClassDirectives(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    if (slides[i].classDirectives.length >= 2) {
      findings.push({
        severity: "high",
        rule: "duplicate-class-directive",
        slides: [i + 1],
        message: `${slides[i].classDirectives.length} \`<!-- _class: ... -->\` comments on this slide; Marp uses the last but this is usually a bug`,
      });
    }
  }
}

// Rule 1: same _class directive 4+ slides in a row (MED)
function checkLayoutRepetition(slides, findings) {
  let runStart = 0;
  let runLayout = slides[0]?.layout ?? null;
  function flush(end) {
    const runLen = end - runStart;
    if (runLen >= 4 && runLayout !== null) {
      const indices = [];
      for (let k = runStart; k < end; k++) indices.push(k + 1);
      findings.push({
        severity: "med",
        rule: "layout-repetition",
        slides: indices,
        message: `${runLen} consecutive \`${runLayout}\` slides — consider reshape or section-divider break (Cross-deck variety rule)`,
      });
    }
  }
  for (let i = 1; i < slides.length; i++) {
    if (slides[i].layout !== runLayout) {
      flush(i);
      runStart = i;
      runLayout = slides[i].layout;
    }
  }
  flush(slides.length);
}

// Rule 2: sparse prose (LOW)
function checkSparseProse(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout !== "prose") continue;
    // Exclude heading from the body word count (heading already extracted).
    let bodyOnly = s.body;
    if (s.heading) {
      bodyOnly = bodyOnly.replace(s.heading, " ");
    }
    const wc = countWords(bodyOnly);
    // Detect a TL;DR blockquote of the form "> **TL;DR:** ..." even though
    // strictly the layout for that is prose-with-tldr — defensive.
    const hasTldr = /^>\s*\*\*TL;DR/im.test(s.raw);
    if (wc < 30 && !hasTldr) {
      findings.push({
        severity: "low",
        rule: "sparse-prose",
        slides: [i + 1],
        message: `prose slide has only ${wc} body word(s); merge with adjacent or reshape`,
      });
    }
  }
}

// Rule 3: asymmetric comparison columns (MED)
function checkAsymmetricComparison(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout !== "comparison") continue;
    // Find `<div class="compare-grid">` and its two `<div>` children.
    const gridMatch = s.raw.match(
      /<div\s+class\s*=\s*["']compare-grid["']\s*>([\s\S]*?)<\/div>\s*$/m
    );
    let inner = null;
    if (gridMatch) inner = gridMatch[1];
    else {
      // Fallback: try without anchoring to end.
      const m2 = s.raw.match(/<div\s+class\s*=\s*["']compare-grid["']\s*>([\s\S]*)/);
      if (m2) inner = m2[1];
    }
    if (!inner) continue;
    // Naively split by top-level `<div>` ... `</div>` pairs.
    const cols = [];
    const colRe = /<div\s*>([\s\S]*?)<\/div>/g;
    let cm;
    while ((cm = colRe.exec(inner)) !== null) {
      cols.push(cm[1]);
    }
    if (cols.length < 2) continue;
    const [a, b] = cols;
    const wa = countWords(a);
    const wb = countWords(b);
    if (wa === 0 || wb === 0) continue;
    const ratio = Math.max(wa, wb) / Math.min(wa, wb);
    if (ratio > 3) {
      findings.push({
        severity: "med",
        rule: "asymmetric-comparison",
        slides: [i + 1],
        message: `comparison columns are unbalanced (${wa} vs ${wb} words, ${ratio.toFixed(1)}:1); rebalance for visual symmetry`,
      });
    }
  }
}

// Rule 4: pull-quote without attribution (LOW)
function checkPullQuoteAttribution(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout !== "pull-quote") continue;
    // Attribution = a paragraph starting with em-dash or en-dash or `--`.
    const hasAttribution = /^\s*(?:—|–|--)\s+\S/m.test(s.raw);
    if (!hasAttribution) {
      findings.push({
        severity: "low",
        rule: "pull-quote-no-attribution",
        slides: [i + 1],
        message: "pull-quote slide is missing trailing `— Attribution` paragraph",
      });
    }
  }
}

// Rule 5: heading wrap risk (MED)
function checkHeadingWrapRisk(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (!s.heading) continue;
    // Honor explicit <br> author hint — if the heading is already
    // pre-broken into multiple lines, treat each line independently.
    const segments = s.heading.split(/<br\s*\/?>/i).map((x) => x.trim()).filter(Boolean);
    const longest = segments.reduce((m, seg) => Math.max(m, seg.length), 0);
    const isCoverLike = s.layout && COVER_LIKE_LAYOUTS.has(s.layout);
    const limit = isCoverLike ? 40 : 60;
    if (longest > limit) {
      findings.push({
        severity: "med",
        rule: "heading-wrap-risk",
        slides: [i + 1],
        message: `heading is ${longest} chars (limit ${limit} for ${isCoverLike ? "cover-like" : "content"} layout); risks wrapping — shorten or insert <br>`,
      });
    }
  }
}

// Rule 6: process-flow without verb cues (LOW)
const TEMPORAL_MARKERS = new Set([
  "first",
  "firstly",
  "then",
  "next",
  "afterwards",
  "after",
  "finally",
  "lastly",
  "before",
  "now",
  "later",
  "subsequently",
  "meanwhile",
]);
// Heuristic verb detector — most English verbs in this context appear in
// imperative present tense. We accept any token that ends in common verb
// endings OR is a known short verb. Includes a small common-verb whitelist.
const COMMON_VERBS = new Set([
  "add",
  "ask",
  "be",
  "begin",
  "build",
  "buy",
  "call",
  "check",
  "choose",
  "click",
  "close",
  "come",
  "commit",
  "configure",
  "confirm",
  "connect",
  "consider",
  "convert",
  "copy",
  "create",
  "cut",
  "define",
  "delete",
  "deploy",
  "design",
  "do",
  "download",
  "drop",
  "edit",
  "enable",
  "enter",
  "establish",
  "execute",
  "explain",
  "extract",
  "feed",
  "fetch",
  "fill",
  "find",
  "fix",
  "follow",
  "format",
  "generate",
  "get",
  "give",
  "go",
  "grow",
  "handle",
  "have",
  "help",
  "identify",
  "import",
  "include",
  "initialize",
  "insert",
  "install",
  "introduce",
  "invoke",
  "join",
  "keep",
  "kick",
  "kill",
  "launch",
  "learn",
  "leave",
  "let",
  "list",
  "load",
  "lock",
  "log",
  "look",
  "make",
  "map",
  "measure",
  "merge",
  "monitor",
  "move",
  "name",
  "navigate",
  "note",
  "notice",
  "observe",
  "open",
  "pack",
  "parse",
  "pass",
  "pay",
  "pick",
  "pin",
  "plan",
  "play",
  "plug",
  "point",
  "post",
  "prepare",
  "press",
  "print",
  "process",
  "produce",
  "promote",
  "prompt",
  "publish",
  "pull",
  "push",
  "put",
  "raise",
  "read",
  "receive",
  "record",
  "register",
  "release",
  "remove",
  "rename",
  "render",
  "repeat",
  "replace",
  "report",
  "request",
  "research",
  "reset",
  "respond",
  "restart",
  "restore",
  "return",
  "review",
  "rinse",
  "rotate",
  "run",
  "save",
  "say",
  "scale",
  "scan",
  "schedule",
  "search",
  "seek",
  "select",
  "send",
  "serve",
  "set",
  "share",
  "ship",
  "show",
  "shut",
  "sign",
  "skip",
  "sleep",
  "slot",
  "solve",
  "sort",
  "split",
  "spread",
  "start",
  "stay",
  "stop",
  "store",
  "stream",
  "submit",
  "subtract",
  "suspend",
  "switch",
  "synchronize",
  "synthesize",
  "tag",
  "take",
  "tap",
  "teach",
  "tell",
  "test",
  "think",
  "throw",
  "tie",
  "tighten",
  "toggle",
  "track",
  "train",
  "transfer",
  "translate",
  "trigger",
  "trim",
  "try",
  "tune",
  "turn",
  "type",
  "understand",
  "undo",
  "update",
  "upload",
  "use",
  "validate",
  "verify",
  "view",
  "visit",
  "wait",
  "walk",
  "wash",
  "watch",
  "wear",
  "weigh",
  "win",
  "work",
  "wrap",
  "write",
  "zoom",
]);

function looksLikeVerbOrTemporal(item) {
  const cleaned = item
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/[*_`]/g, "")
    .trim();
  if (!cleaned) return false;
  const firstWord = cleaned.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
  if (!firstWord) return false;
  if (TEMPORAL_MARKERS.has(firstWord)) return true;
  if (COMMON_VERBS.has(firstWord)) return true;
  // Suffix heuristic: -ing, -ed (loosely past-tense / participle) are
  // usually descriptive rather than imperative; we don't flag those as verbs
  // because process-flow items should be imperative. But -ize, -ate are
  // common verb endings.
  if (/(?:ize|ate|ify)$/.test(firstWord) && firstWord.length > 4) return true;
  return false;
}

function checkProcessFlowVerbs(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout !== "process-flow") continue;
    // Extract ordered-list items from the raw markdown (numeric prefix).
    const items = [];
    for (const line of s.raw.split("\n")) {
      if (/^\s*\d+\.\s+/.test(line)) items.push(line);
    }
    if (items.length === 0) continue;
    const cued = items.filter(looksLikeVerbOrTemporal).length;
    const ratio = cued / items.length;
    if (ratio < 0.5) {
      findings.push({
        severity: "low",
        rule: "process-flow-no-verbs",
        slides: [i + 1],
        message: `process-flow has ${cued}/${items.length} items with verb/temporal cues (<50%); review for imperative phrasing`,
      });
    }
  }
}

// Rule 7: bullet-list density (MED)
function checkBulletListDensity(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    // Count top-level list items. A "default bullet list" slide = no layout
    // class (or unrecognized class) with bullet items. Also covers two-col-list.
    const layout = s.layout;
    const isDefaultBullet = layout === null || layout === undefined;
    const isTwoCol = layout === "two-col-list";
    if (!isDefaultBullet && !isTwoCol) continue;

    // Skip if the slide is mostly something else (table, code, image).
    if (/^\s*\|/m.test(s.raw)) continue;
    if (/```/.test(s.raw)) continue;
    if (/<div\s+class\s*=\s*["']compare-grid["']/.test(s.raw)) continue;
    if (/<div\s+class\s*=\s*["']matrix["']/.test(s.raw)) continue;
    if (/<div\s+class\s*=\s*["']stat["']/.test(s.raw)) continue;

    // Count list items (lines beginning with `-`, `*`, `+`, or `<digit>.`).
    // Only consider top-level (no leading whitespace) to avoid nested items.
    let count = 0;
    for (const line of s.raw.split("\n")) {
      if (/^[-*+]\s+\S/.test(line)) count++;
      else if (/^\d+\.\s+\S/.test(line)) count++;
    }
    if (count === 0) continue;

    if (isDefaultBullet && count > 6) {
      findings.push({
        severity: "med",
        rule: "bullet-list-too-many",
        slides: [i + 1],
        message: `${count} top-level list items on a default bullet slide; switch to \`two-col-list\` (>6 items)`,
      });
    } else if (isTwoCol && count > 10) {
      findings.push({
        severity: "med",
        rule: "two-col-list-too-many",
        slides: [i + 1],
        message: `${count} items on \`two-col-list\` slide; split (>10 items)`,
      });
    }
  }
}

// Rule 8: table row count (MED)
function checkTableRowCount(slides, findings) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const lines = s.raw.split("\n");
    let inFence = false;
    let tableRows = 0;
    let sawDivider = false;
    let sawHeader = false;
    let tablesOnSlide = 0;
    for (const line of lines) {
      if (/^```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      // A table row is a line with at least one `|` and not the divider.
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const isDivider = /^\s*\|?\s*:?-{2,}/.test(line) || /^\s*\|(\s*:?-+:?\s*\|)+/.test(line);
        if (isDivider) {
          if (sawHeader) {
            sawDivider = true;
            tablesOnSlide++;
          }
          continue;
        }
        if (!sawHeader) {
          sawHeader = true;
        } else if (sawDivider) {
          tableRows++;
        }
      } else if (line.trim() === "") {
        // Blank line ends a table.
        sawHeader = false;
        sawDivider = false;
      }
    }
    if (tablesOnSlide >= 1 && tableRows > 6) {
      findings.push({
        severity: "med",
        rule: "table-too-many-rows",
        slides: [i + 1],
        message: `table has ${tableRows} data rows (>6); split across slides`,
      });
    }
  }
}

// ─── orchestrate ────────────────────────────────────────────────────

const parsed = parseDeck(src);
const slides = parsed.slides.map(parseSlide);

const findings = [];
checkFrontmatter(parsed, findings);
checkDuplicateClassDirectives(slides, findings);
checkLayoutRepetition(slides, findings);
checkSparseProse(slides, findings);
checkAsymmetricComparison(slides, findings);
checkPullQuoteAttribution(slides, findings);
checkHeadingWrapRisk(slides, findings);
checkProcessFlowVerbs(slides, findings);
checkBulletListDensity(slides, findings);
checkTableRowCount(slides, findings);

// ─── filter by severity threshold ───────────────────────────────────
const SEV_RANK = { high: 3, med: 2, low: 1 };
const thresholdRank = SEV_RANK[threshold];
const filteredFindings = findings.filter((f) => SEV_RANK[f.severity] >= thresholdRank);

const summary = { high: 0, med: 0, low: 0 };
for (const f of filteredFindings) summary[f.severity]++;

// ─── output ─────────────────────────────────────────────────────────

if (outputJson) {
  console.log(
    JSON.stringify(
      {
        deck,
        slide_count: slides.length,
        summary,
        findings: filteredFindings.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]),
      },
      null,
      2
    )
  );
} else {
  const isTTY = process.stdout.isTTY;
  const C = isTTY
    ? {
        red: (s) => `\x1b[31m${s}\x1b[0m`,
        yellow: (s) => `\x1b[33m${s}\x1b[0m`,
        blue: (s) => `\x1b[34m${s}\x1b[0m`,
        bold: (s) => `\x1b[1m${s}\x1b[0m`,
        dim: (s) => `\x1b[2m${s}\x1b[0m`,
      }
    : {
        red: (s) => s,
        yellow: (s) => s,
        blue: (s) => s,
        bold: (s) => s,
        dim: (s) => s,
      };
  const sevColor = { high: C.red, med: C.yellow, low: C.blue };
  const sevLabel = { high: "HIGH", med: "MED ", low: "LOW " };

  console.log(C.bold(`lint-deck: ${deck}`));
  console.log(C.dim(`  slides: ${slides.length}    threshold: ${threshold}`));
  console.log(
    `  summary: ${C.red("high " + summary.high)}  ${C.yellow("med " + summary.med)}  ${C.blue("low " + summary.low)}`
  );

  if (filteredFindings.length === 0) {
    console.log(C.dim("\n  (no findings at this threshold)"));
  } else {
    console.log("");
    const sorted = [...filteredFindings].sort((a, b) => {
      const r = SEV_RANK[b.severity] - SEV_RANK[a.severity];
      if (r !== 0) return r;
      // Then by first slide index.
      const sa = a.slides[0] ?? 0;
      const sb = b.slides[0] ?? 0;
      return sa - sb;
    });
    for (const f of sorted) {
      const sev = sevColor[f.severity](sevLabel[f.severity]);
      const where = f.slides.length === 0
        ? C.dim("(deck)")
        : f.slides.length === 1
          ? `slide ${f.slides[0]}`
          : `slides ${f.slides[0]}–${f.slides[f.slides.length - 1]}`;
      console.log(`  ${sev}  ${C.bold(f.rule)}  ${C.dim(where)}`);
      console.log(`         ${f.message}`);
    }
  }
}

// ─── exit code ──────────────────────────────────────────────────────
process.exit(filteredFindings.length > 0 ? 1 : 0);
