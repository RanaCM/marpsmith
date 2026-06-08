#!/usr/bin/env node
/*
 * auto-fit.mjs — rendered-geometry-driven body font-scale assignment for Marp decks.
 *
 * For each slide:
 *   1. Strip any prior b-XX scale class (idempotent re-runs). Also strips any
 *      legacy h-XX classes — headings are never scaled (see SKILL.md).
 *   2. Detect heading wrap and record line count as evidence (informational —
 *      the script does NOT scale headings; the agent should shorten heading
 *      text if it wraps in a way that pressures the body fit).
 *   3. Probe body scales [1.0, 0.95, 0.9] until non-heading content fits
 *      within the section's content area.
 *   4. If 0.9 still overflows, emit a split recommendation (no rescale).
 *
 * Usage:
 *   node auto-fit.mjs <deck.md> [--theme path|theme-name] [--config path]
 *                               [--apply | --dry-run]   default: --dry-run
 *                               [--viewport WxH]        default: 1280x720
 *
 * --dry-run  → JSON to stdout, no writes.
 * --apply    → JSON to stdout AND rewrites the markdown source for
 *              `rescale` actions. `split-*` actions print a separate
 *              human-readable summary to stderr; agent applies splits.
 *
 * Exit codes:
 *   0 — all slides settled at rescale (no splits required)
 *   1 — at least one split-* recommendation pending
 *   2 — script error
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ─── arg parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error(
    "Usage: node auto-fit.mjs <deck.md> [--theme path] [--config path] [--apply|--dry-run] [--viewport WxH]"
  );
  process.exit(2);
}
const deck = resolve(args[0]);
let theme = null;
let themeIsFile = false;
let configPath = null;
let viewport = { w: 1280, h: 720 };
let mode = "dry-run";
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--theme" && args[i + 1]) {
    const input = args[++i];
    const resolved = resolve(input);
    if (existsSync(resolved)) {
      theme = resolved;
      themeIsFile = true;
    } else {
      theme = input;
    }
  }
  else if (a === "--config" && args[i + 1]) configPath = resolve(args[++i]);
  else if (a === "--viewport" && args[i + 1]) {
    const [w, h] = args[++i].split("x").map(Number);
    if (w && h) viewport = { w, h };
  } else if (a === "--apply") mode = "apply";
  else if (a === "--dry-run") mode = "dry-run";
}
if (!existsSync(deck)) {
  console.error(`Deck not found: ${deck}`);
  process.exit(2);
}

// ─── render deck via marp CLI ───────────────────────────────────────
const workDir = mkdtempSync(join(tmpdir(), "auto-fit-"));
const htmlPath = join(workDir, "deck.html");
const marpArgs = [deck, "-o", htmlPath, "--html", "--template", "bare"];
if (theme) marpArgs.push(themeIsFile ? "--theme-set" : "--theme", theme);
if (configPath) marpArgs.push("--config-file", configPath);

try {
  execFileSync("marp", marpArgs, { stdio: ["ignore", "ignore", "pipe"] });
} catch (err) {
  console.error(`marp render failed: ${err.message}`);
  process.exit(2);
}

// ─── load puppeteer ─────────────────────────────────────────────────
let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    console.error("puppeteer not installed. From scripts/ directory: npm install");
    process.exit(2);
  }
}

const browser = await puppeteer.launch({
  headless: "new",
  defaultViewport: { width: viewport.w, height: viewport.h },
  ...(detectChrome() ? { executablePath: detectChrome() } : {}),
  userDataDir: join(workDir, "chrome-profile"),
  args: ["--disable-crash-reporter", "--disable-gpu"],
});

function detectChrome() {
  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return paths.find(existsSync);
}
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts?.ready);

// ─── per-slide auto-fit (browser context) ───────────────────────────
const decisions = await page.evaluate((vw, vh) => {
  const sections = [...document.querySelectorAll("section")];
  const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
  const COVER_LIKE = new Set(["title-cover", "pull-quote", "big-stat-hero", "section-divider"]);
  const BODY_STEPS = [0.95, 0.9];               // probed in order; 1.0 is implicit baseline

  function lineCount(el) {
    if (!el) return 0;
    const cs = getComputedStyle(el);
    let lh = parseFloat(cs.lineHeight);
    if (Number.isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.2;
    return Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
  }

  function maxBodyBottom(section) {
    let max = section.getBoundingClientRect().top;
    function walk(el) {
      if (HEADING_TAGS.has(el.tagName)) return;
      if (getComputedStyle(el).position === "absolute") return;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > max) max = r.bottom;
      for (const c of el.children) walk(c);
    }
    for (const c of section.children) {
      if (!HEADING_TAGS.has(c.tagName)) walk(c);
    }
    return max;
  }

  function isCoverLike(section) {
    for (const c of section.classList) if (COVER_LIKE.has(c)) return true;
    return false;
  }

  function classifySplitShape(section) {
    // Comparison takes priority — its visual identity (side-by-side, color-
    // coded columns) is the reason we offer the 3-slide detail-expansion
    // pattern instead of just splitting into halves.
    if (section.classList.contains("comparison")) {
      const grid = section.querySelector(".compare-grid");
      if (grid && grid.children.length === 2) {
        return { kind: "split-comparison-detail" };
      }
    }
    const kids = [...section.children].filter((c) => !HEADING_TAGS.has(c.tagName));
    const lists = kids.filter((c) => c.tagName === "UL" || c.tagName === "OL");
    const paras = kids.filter((c) => c.tagName === "P");
    const tables = kids.filter((c) => c.tagName === "TABLE");
    const others = kids.filter((c) => c.tagName !== "UL" && c.tagName !== "OL");
    if (lists.length === 1 && others.length === 0 && lists[0].children.length >= 4) {
      return { kind: "split-list-midpoint", item_count: lists[0].children.length };
    }
    if (tables.length === 1 && kids.length === 1) {
      const tbody = tables[0].querySelector("tbody");
      const rows = tbody ? tbody.children.length : Math.max(0, tables[0].rows.length - 1);
      if (rows >= 4) return { kind: "split-table-midpoint", row_count: rows };
    }
    if (paras.length >= 2 && kids.length === paras.length) {
      return { kind: "split-paragraph-midpoint", paragraph_count: paras.length };
    }
    return { kind: "split-restructure" };
  }

  return sections.map((section, i) => {
    // Force native slide dimensions (bare template doesn't size sections).
    Object.assign(section.style, {
      width: vw + "px",
      height: vh + "px",
      boxSizing: "border-box",
      position: "relative",
    });
    section.scrollIntoView();

    // Strip prior scale classes (idempotency).
    const stripped = [];
    for (const cls of [...section.classList]) {
      if (/^[hb]-\d+$/.test(cls)) {
        section.classList.remove(cls);
        stripped.push(cls);
      }
    }

    const heading = [...section.children].find((c) => HEADING_TAGS.has(c.tagName));
    const cover = isCoverLike(section);

    // ── HEADING WRAP DETECTION ──
    // Headings are never scaled (per skill rule). If a heading wraps to >1 line,
    // we record it in evidence so the agent can decide to shorten the heading;
    // we do NOT apply an h-XX class. Body-fit below will naturally account for
    // the heading's actual rendered height.
    let h_lines_at_1 = 0;
    if (heading && !cover) {
      h_lines_at_1 = lineCount(heading);
    }
    // Strip any pre-existing h-XX classes — they're deprecated and the script
    // never re-applies them.
    for (const c of [...section.classList]) {
      if (/^h-\d+$/.test(c)) section.classList.remove(c);
    }

    // ── BODY FIT ──
    const sectionRect = section.getBoundingClientRect();
    const cs = getComputedStyle(section);
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const availBottom = sectionRect.bottom - padBottom;

    let b_scale = 1.0;
    let split = null;
    let overflow_at_1 = 0;
    let overflow_at_min = 0;

    {
      const mbbBaseline = maxBodyBottom(section);
      overflow_at_1 = Math.max(0, mbbBaseline - availBottom);
    }

    if (overflow_at_1 > 2) {
      b_scale = null;
      for (const s of BODY_STEPS) {
        const cls = "b-" + Math.round(s * 100);
        for (const c of [...section.classList]) {
          if (/^b-\d+$/.test(c)) section.classList.remove(c);
        }
        section.classList.add(cls);
        const mbb = maxBodyBottom(section);
        if (mbb <= availBottom + 2) {
          b_scale = s;
          break;
        }
        overflow_at_min = mbb - availBottom;
      }
      if (b_scale === null) {
        // Below floor → split.
        // Reset b- class so subsequent measurements are clean (cosmetic).
        for (const c of [...section.classList]) {
          if (/^b-\d+$/.test(c)) section.classList.remove(c);
        }
        split = classifySplitShape(section);
      }
    }

    const recommended = [];
    if (b_scale !== null && b_scale < 1.0) recommended.push("b-" + Math.round(b_scale * 100));

    const action = split ? split.kind : "rescale";
    const evidence = {};
    if (h_lines_at_1 > 0) evidence.h_lines_at_1 = h_lines_at_1;
    if (overflow_at_1 > 2) evidence.overflow_at_1 = Math.round(overflow_at_1);
    if (split) evidence.overflow_at_0_90 = Math.round(overflow_at_min);
    if (split && split.item_count !== undefined) evidence.list_items = split.item_count;
    if (split && split.paragraph_count !== undefined) evidence.paragraphs = split.paragraph_count;
    if (split && split.row_count !== undefined) evidence.table_rows = split.row_count;

    return {
      index: i + 1,
      previous_scale_classes: stripped,
      action,
      b_scale,
      recommended,
      evidence,
      cover_like: cover,
    };
  });
}, viewport.w, viewport.h);

await browser.close();
try {
  rmSync(workDir, { recursive: true, force: true });
} catch {}

// ─── apply mode: rewrite source markdown ────────────────────────────
function parseMd(src) {
  let frontmatter = "";
  let body = src;
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    frontmatter = fmMatch[0];
    body = src.slice(fmMatch[0].length);
  }
  const lines = body.split("\n");
  const parts = [];
  let buf = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "---") {
      parts.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  parts.push(buf.join("\n"));
  return { frontmatter, slides: parts };
}

function serializeMd({ frontmatter, slides }) {
  // Slides separated by `\n---\n`. Preserve any trailing newline structure
  // by rejoining with the canonical separator.
  return frontmatter + slides.join("\n---\n");
}

function applyClassesToSlide(slideText, recommended) {
  const re = /<!--\s*_class:\s*([^>]+?)\s*-->/;
  const match = slideText.match(re);
  if (match) {
    const existing = match[1].trim().split(/\s+/);
    const filtered = existing.filter((c) => !/^[hb]-\d+$/.test(c));
    const merged = [...filtered, ...recommended];
    if (merged.length === 0) {
      // Drop the directive entirely along with its surrounding blank line.
      return slideText.replace(new RegExp(`\\s*${re.source}\\s*\\n`), "\n");
    }
    return slideText.replace(re, `<!-- _class: ${merged.join(" ")} -->`);
  }
  if (recommended.length > 0) {
    // Insert directive at the top (after leading newlines).
    const leading = slideText.match(/^\n*/)[0];
    return leading + `<!-- _class: ${recommended.join(" ")} -->\n\n` + slideText.slice(leading.length);
  }
  return slideText;
}

if (mode === "apply") {
  const src = readFileSync(deck, "utf8");
  const parsed = parseMd(src);
  if (parsed.slides.length !== decisions.length) {
    console.error(
      `Parse mismatch: ${decisions.length} slides rendered, ${parsed.slides.length} parsed from source`
    );
    process.exit(2);
  }
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (d.action === "rescale") {
      parsed.slides[i] = applyClassesToSlide(parsed.slides[i], d.recommended);
    }
    // Splits are surfaced for the agent; not auto-applied.
  }
  writeFileSync(deck, serializeMd(parsed));
}

// ─── output ─────────────────────────────────────────────────────────
const summary = { rescale: 0, splits: 0, no_change: 0 };
for (const d of decisions) {
  if (d.action === "rescale") {
    if (d.recommended.length > 0) summary.rescale++;
    else summary.no_change++;
  } else summary.splits++;
}

const filtered = decisions.filter(
  (d) => d.recommended.length > 0 || d.action !== "rescale" || d.previous_scale_classes.length > 0
);

console.log(
  JSON.stringify(
    {
      deck,
      viewport,
      mode,
      slide_count: decisions.length,
      summary,
      decisions: filtered,
    },
    null,
    2
  )
);

if (mode === "apply" && summary.splits > 0) {
  const splitDecisions = decisions.filter((d) => d.action !== "rescale");
  console.error(`\n${summary.splits} slide(s) need splitting (auto-fit floor reached):`);
  for (const d of splitDecisions) {
    const ev = JSON.stringify(d.evidence);
    console.error(`  slide ${d.index}: ${d.action}  ${ev}`);
  }
}

process.exit(summary.splits > 0 ? 1 : 0);
