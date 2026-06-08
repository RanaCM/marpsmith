#!/usr/bin/env node
/*
 * check-slides.mjs — headless DOM verification for Marp decks.
 *
 * Renders a Marp markdown deck to HTML, opens it in headless Chrome via
 * Puppeteer, and emits a JSON report of geometric issues per slide.
 *
 * Usage:
 *   node check-slides.mjs <deck.md> [--theme path/to/theme.css|theme-name]
 *                                   [--config path/to/.marprc.yml]
 *                                   [--viewport WxH]   (default 1280x720)
 *
 * Output (stdout, JSON):
 *   {
 *     "deck": "deck.md",
 *     "viewport": { "w": 1280, "h": 720 },
 *     "slide_count": 47,
 *     "slides": [
 *       {
 *         "index": 12,                    // 1-based, matches preview pagination
 *         "class": "prose-with-tldr",
 *         "issues": [
 *           {
 *             "type": "header-collision",
 *             "severity": "high",
 *             "evidence": { "header_bottom": 134, "content_top": 118 },
 *             "suggested_fix": "heading-sm"
 *           }
 *         ]
 *       }
 *     ],
 *     "summary": { "high": 3, "med": 7, "low": 1 }
 *   }
 *
 * Exit codes:
 *   0 — no HIGH-severity issues
 *   1 — at least one HIGH-severity issue (CI-friendly)
 *   2 — script error (render failed, browser not found, etc.)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ─── arg parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error(
    "Usage: node check-slides.mjs <deck.md> [--theme path] [--config path] [--viewport WxH]"
  );
  process.exit(2);
}
const deck = resolve(args[0]);
let theme = null;
let themeIsFile = false;
let configPath = null;
let viewport = { w: 1280, h: 720 };
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--theme" && args[i + 1]) {
    const input = args[++i];
    const resolved = resolve(input);
    if (existsSync(resolved)) {
      theme = resolved;
      themeIsFile = true;
    } else {
      theme = input;
    }
  }
  else if (args[i] === "--config" && args[i + 1]) configPath = resolve(args[++i]);
  else if (args[i] === "--viewport" && args[i + 1]) {
    const [w, h] = args[++i].split("x").map(Number);
    if (w && h) viewport = { w, h };
  }
}
if (!existsSync(deck)) {
  console.error(`Deck not found: ${deck}`);
  process.exit(2);
}

// ─── render via marp CLI ────────────────────────────────────────────
const workDir = mkdtempSync(join(tmpdir(), "check-slides-"));
const htmlPath = join(workDir, "deck.html");
const marpArgs = [deck, "-o", htmlPath, "--html"];
if (theme) marpArgs.push(themeIsFile ? "--theme-set" : "--theme", theme);
if (configPath) marpArgs.push("--config-file", configPath);

try {
  execFileSync("marp", marpArgs, { stdio: ["ignore", "ignore", "pipe"] });
} catch (err) {
  console.error(`marp render failed: ${err.message}`);
  process.exit(2);
}

// ─── load puppeteer (or puppeteer-core + system Chrome) ─────────────
let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    console.error(
      "puppeteer not installed. From the scripts/ directory, run:\n  npm install"
    );
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

// Wait for fonts to load — affects layout measurement.
await page.evaluate(() => document.fonts?.ready);

// ─── per-slide checks (run in browser context) ──────────────────────
const report = await page.evaluate((vw) => {
  const sections = [...document.querySelectorAll("section")];
  const SAFE_BOTTOM_RATIO = 0.04; // 4% of section height = "near overflow"
  const SPARSE_RATIO = 0.4;
  const ASYMMETRY_RATIO = 1.6;

  const headingTagSet = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

  function getHeading(section) {
    return [...section.children].find((c) => headingTagSet.has(c.tagName));
  }
  function getNonHeadingChildren(section) {
    return [...section.children].filter((c) => !headingTagSet.has(c.tagName));
  }
  function rectsOverlap(a, b) {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }
  // Detect orphan word: last visual line of a heading has < 30% of heading width
  function orphanLastLine(el) {
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()];
    if (rects.length < 2) return null;
    const elRect = el.getBoundingClientRect();
    const lastLine = rects[rects.length - 1];
    const ratio = lastLine.width / elRect.width;
    return { ratio, lastLineWidth: lastLine.width, totalWidth: elRect.width };
  }
  function lineCount(el) {
    if (!el) return 0;
    const cs = getComputedStyle(el);
    let lh = parseFloat(cs.lineHeight);
    if (Number.isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.2;
    const h = el.getBoundingClientRect().height;
    return Math.max(1, Math.round(h / lh));
  }

  return sections.map((section, i) => {
    const issues = [];
    const sectionRect = section.getBoundingClientRect();
    const cls = section.className || "";

    // Marp's <section> has overflow:hidden, which forces scrollHeight to
    // equal clientHeight even when content overflows. We must detect overflow
    // by walking children and comparing their bounding-rect bottoms to the
    // section's bottom. Children's getBoundingClientRect() returns the layout
    // rect, not the clipped rect, so this catches what's been hidden.
    let maxChildBottom = sectionRect.top;
    let maxChildRight = sectionRect.left;
    function walk(el) {
      // Skip absolutely-positioned headers — they're meant to sit at fixed
      // positions and don't represent body content overflow.
      if (getComputedStyle(el).position === "absolute") return;
      const r = el.getBoundingClientRect();
      if (r.height > 0) {
        if (r.bottom > maxChildBottom) maxChildBottom = r.bottom;
        if (r.right > maxChildRight) maxChildRight = r.right;
      }
      for (const c of el.children) walk(c);
    }
    for (const c of section.children) walk(c);

    // 1. Vertical overflow (content extends past section's bottom)
    if (maxChildBottom > sectionRect.bottom + 2) {
      issues.push({
        type: "vertical-overflow",
        severity: "high",
        evidence: {
          content_bottom: Math.round(maxChildBottom),
          section_bottom: Math.round(sectionRect.bottom),
          overflow_px: Math.round(maxChildBottom - sectionRect.bottom),
        },
        suggested_fix: "run auto-fit.mjs (recomputes b-XX or recommends split)",
      });
    }
    // 2. Horizontal overflow
    if (maxChildRight > sectionRect.right + 2) {
      issues.push({
        type: "horizontal-overflow",
        severity: "high",
        evidence: {
          content_right: Math.round(maxChildRight),
          section_right: Math.round(sectionRect.right),
          overflow_px: Math.round(maxChildRight - sectionRect.right),
        },
        suggested_fix: "restructure (auto-fit only handles vertical)",
      });
    }

    // Heading-related checks
    const heading = getHeading(section);
    const others = getNonHeadingChildren(section);
    const isCoverLike =
      cls.includes("title-cover") || cls.includes("pull-quote") || cls.includes("big-stat-hero");

    if (heading) {
      const hRect = heading.getBoundingClientRect();
      const hLines = lineCount(heading);

      // 3. Header–content collision (only meaningful when heading is absolute;
      // by default headings now flow in document order so this rarely fires).
      const hPos = getComputedStyle(heading).position;
      if (hPos === "absolute" && others.length > 0) {
        const firstContent = others[0];
        const fcRect = firstContent.getBoundingClientRect();
        if (rectsOverlap(hRect, fcRect)) {
          issues.push({
            type: "header-collision",
            severity: "high",
            evidence: {
              header_bottom: Math.round(hRect.bottom),
              content_top: Math.round(fcRect.top),
            },
            suggested_fix: "run auto-fit.mjs (recomputes h-XX)",
          });
        }
      }

      // 4. Heading orphan word — flag only if heading wraps to 3+ lines AND
      // last line is short. 2-line headings are intentional in the flow model.
      const orphan = orphanLastLine(heading);
      if (orphan && orphan.ratio < 0.3 && hLines >= 3) {
        issues.push({
          type: "heading-orphan-word",
          severity: "low",
          evidence: { last_line_ratio: orphan.ratio.toFixed(2), lines: hLines },
          suggested_fix: "shorten heading text",
        });
      }

      // 5. Heading takes 3+ lines — almost always a sign the heading is too
      // long. Don't flag 2-line headings; those are expected.
      if (hLines >= 3 && !isCoverLike) {
        issues.push({
          type: "heading-too-long",
          severity: "med",
          evidence: { lines: hLines },
          suggested_fix: "shorten heading text",
        });
      }
    }

    // 6. Near-overflow at bottom
    if (others.length > 0 && section.scrollHeight <= section.clientHeight + 2) {
      const lastChild = others[others.length - 1];
      const lcRect = lastChild.getBoundingClientRect();
      const remaining = sectionRect.bottom - lcRect.bottom;
      const ratio = remaining / sectionRect.height;
      if (ratio < SAFE_BOTTOM_RATIO && ratio >= 0) {
        issues.push({
          type: "near-overflow",
          severity: "med",
          evidence: { remaining_px: Math.round(remaining), ratio: ratio.toFixed(3) },
          suggested_fix: "run auto-fit.mjs (recomputes b-XX)",
        });
      }
    }

    // 7. Excessive whitespace
    if (others.length > 0 && !isCoverLike && !cls.includes("section-divider")) {
      const lastChild = others[others.length - 1];
      const lcRect = lastChild.getBoundingClientRect();
      const usedHeight = lcRect.bottom - sectionRect.top;
      const ratio = usedHeight / sectionRect.height;
      if (ratio < SPARSE_RATIO) {
        issues.push({
          type: "sparse",
          severity: "low",
          evidence: { used_ratio: ratio.toFixed(2) },
          suggested_fix: "roomy (or accept)",
        });
      }
    }

    // 8. Asymmetric columns (comparison / two-col-list / matrix)
    const grid =
      section.querySelector(".compare-grid") ||
      section.querySelector(".matrix");
    if (grid) {
      const cells = [...grid.children];
      if (cells.length >= 2) {
        const heights = cells.map((c) => c.getBoundingClientRect().height);
        const ratio = Math.max(...heights) / Math.max(1, Math.min(...heights));
        if (ratio > ASYMMETRY_RATIO) {
          issues.push({
            type: "asymmetric-columns",
            severity: "low",
            evidence: { ratio: ratio.toFixed(2) },
            suggested_fix: "rebalance content between columns",
          });
        }
      }
    }

    // 9. Image natural overflow (height > 70% of section)
    [...section.querySelectorAll("img")].forEach((img) => {
      const r = img.getBoundingClientRect();
      if (r.height > sectionRect.height * 0.7) {
        issues.push({
          type: "image-too-tall",
          severity: "med",
          evidence: { ratio: (r.height / sectionRect.height).toFixed(2) },
          suggested_fix: "Layer 1 max-height should already cap; investigate",
        });
      }
    });

    // 10. Code block too tall (> 70% section height)
    [...section.querySelectorAll("pre")].forEach((pre) => {
      const r = pre.getBoundingClientRect();
      if (r.height > sectionRect.height * 0.7) {
        issues.push({
          type: "code-too-tall",
          severity: "med",
          evidence: { ratio: (r.height / sectionRect.height).toFixed(2) },
          suggested_fix: "body-dense or split",
        });
      }
    });

    return {
      index: i + 1,
      class: cls || null,
      issues,
    };
  });
}, viewport);

await browser.close();

// Cleanup tmp dir
try {
  rmSync(workDir, { recursive: true, force: true });
} catch {}

// ─── summary + exit code ────────────────────────────────────────────
const summary = { high: 0, med: 0, low: 0 };
for (const s of report) {
  for (const issue of s.issues) summary[issue.severity]++;
}

const filtered = report.filter((s) => s.issues.length > 0);

console.log(
  JSON.stringify(
    {
      deck,
      viewport,
      slide_count: report.length,
      slides: filtered,
      summary,
    },
    null,
    2
  )
);

process.exit(summary.high > 0 ? 1 : 0);
