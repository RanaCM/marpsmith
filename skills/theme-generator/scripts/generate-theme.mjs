#!/usr/bin/env node
/*
 * generate-theme.mjs — produce a Marp theme CSS file from 1–3 brand colors.
 *
 * Usage:
 *   node generate-theme.mjs \
 *     --brand "#E63946" \
 *     [--brand2 "#FACC15"] \
 *     [--brand3 "#06B6D4"] \
 *     --slug crimson-night \
 *     --bg dark \                # dark | light (default: heuristic from brand)
 *     [--accent vivid] \         # vivid | muted | pastel (default: vivid)
 *     [--scheme auto] \          # auto | complementary | split | triadic | analogous | mono
 *     [--variant none] \         # none | glow | rounded | uppercase-divider | circle-badges | square-badges
 *     [--out path] \             # default: <skills-dir>/marp-slides/themes/<slug>.css
 *     [--verbose]
 *
 * Output: CSS file at --out; report (JSON-ish) on stderr summarising
 *         scheme picked, contrast ratios for critical pairs, iterations.
 *
 * No npm deps. HSL/sRGB math + WCAG-2 relative luminance is enough.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── arg parsing ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, dflt = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}

const opts = {
  brand: arg('brand'),
  brand2: arg('brand2'),
  brand3: arg('brand3'),
  slug: arg('slug'),
  bg: arg('bg'),
  accent: arg('accent', 'vivid'),
  scheme: arg('scheme', 'auto'),
  variant: arg('variant', 'auto'),
  out: arg('out'),
  verbose: !!arg('verbose'),
};

if (!opts.brand || !opts.slug) {
  console.error('Usage: --brand <hex> --slug <name> [--bg dark|light] [--accent vivid|muted|pastel] [--scheme ...] [--variant ...] [--out <path>]');
  process.exit(2);
}

// ─── color math ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) throw new Error(`bad hex: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1, g1, b1;
  if (hp < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  const m = l - c / 2;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

const hex2hsl = h => rgbToHsl(hexToRgb(h));
const hsl2hex = o => rgbToHex(hslToRgb(o));

// WCAG relative luminance + contrast ratio
function relLum({ r, g, b }) {
  const f = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(hex1, hex2) {
  const l1 = relLum(hexToRgb(hex1));
  const l2 = relLum(hexToRgb(hex2));
  const a = Math.max(l1, l2), b = Math.min(l1, l2);
  return (a + 0.05) / (b + 0.05);
}

// rgba string with given alpha
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ─── scheme decision ────────────────────────────────────────────────

function pickScheme({ brand2, brand3, scheme }) {
  if (scheme && scheme !== 'auto') return scheme;
  if (brand3) return 'triadic-from-input';
  if (brand2) return 'dual-input';
  // Single brand color: pick split-complementary by default — gives 3
  // distinct accents without the eye-jarring tension of straight complementary.
  return 'split';
}

// Given a primary brand HSL and scheme, return { primary, secondary, tertiary }
// hue/sat/L starting points (caller adjusts L for fg-vs-bg later).
function expandScheme(primaryHex, brand2Hex, brand3Hex, scheme) {
  const p = hex2hsl(primaryHex);
  if (scheme === 'triadic-from-input') {
    return {
      primary: p,
      secondary: hex2hsl(brand2Hex),
      tertiary: hex2hsl(brand3Hex),
    };
  }
  if (scheme === 'dual-input') {
    // user gave 2 colors. Tertiary = halfway between p and brand2 on the
    // wheel, shifted 60° (gives a third anchor that doesn't compete).
    const s = hex2hsl(brand2Hex);
    const tertHue = ((p.h + s.h) / 2 + 60) % 360;
    return {
      primary: p,
      secondary: s,
      tertiary: { h: tertHue, s: Math.max(p.s, s.s), l: (p.l + s.l) / 2 },
    };
  }
  if (scheme === 'complementary') {
    return {
      primary: p,
      secondary: { h: (p.h + 180) % 360, s: p.s, l: p.l },
      tertiary: { h: (p.h + 60) % 360, s: p.s * 0.85, l: p.l },
    };
  }
  if (scheme === 'triadic') {
    return {
      primary: p,
      secondary: { h: (p.h + 120) % 360, s: p.s, l: p.l },
      tertiary: { h: (p.h + 240) % 360, s: p.s, l: p.l },
    };
  }
  if (scheme === 'analogous') {
    return {
      primary: p,
      secondary: { h: (p.h + 30) % 360, s: p.s, l: p.l },
      tertiary: { h: (p.h - 30 + 360) % 360, s: p.s * 0.9, l: p.l },
    };
  }
  if (scheme === 'mono') {
    return {
      primary: p,
      secondary: { h: p.h, s: p.s * 0.6, l: Math.min(0.85, p.l + 0.15) },
      tertiary: { h: p.h, s: p.s * 0.4, l: Math.max(0.2, p.l - 0.2) },
    };
  }
  // default = split-complementary: 180±30°
  return {
    primary: p,
    secondary: { h: (p.h + 150) % 360, s: p.s, l: p.l },
    tertiary: { h: (p.h + 210) % 360, s: p.s * 0.9, l: p.l },
  };
}

// ─── bg-tone heuristic ──────────────────────────────────────────────

function pickBgTone({ bg, brand }) {
  if (bg === 'dark' || bg === 'light') return bg;
  // Heuristic: very dark or very saturated brands -> dark theme; pale brands -> light theme.
  const { l, s } = hex2hsl(brand);
  if (l < 0.35) return 'dark';
  if (l > 0.78 && s < 0.4) return 'light';
  return 'dark'; // default — most brand palettes pop better on dark
}

// ─── accent style → saturation tuning ───────────────────────────────

const ACCENT_SAT_MULT = { vivid: 1.0, muted: 0.55, pastel: 0.75 };
const ACCENT_L_BOOST  = { vivid: 0.0, muted: -0.05, pastel: 0.18 };

// Adjust an HSL color to fit the bg-tone — push L into the readable range,
// keeping H untouched (preserves brand identity).
function tuneForBg(hsl, bgTone, accentStyle) {
  const satMult = ACCENT_SAT_MULT[accentStyle] ?? 1;
  const lBoost = ACCENT_L_BOOST[accentStyle] ?? 0;
  const s = Math.max(0.15, Math.min(1, hsl.s * satMult));
  let l = hsl.l + lBoost;
  // Foreground accents on dark bg should sit in ~0.55–0.75 L.
  // On light bg they should sit in ~0.30–0.50 L.
  if (bgTone === 'dark') l = Math.max(0.55, Math.min(0.78, l));
  else                   l = Math.max(0.30, Math.min(0.52, l));
  return { h: hsl.h, s, l };
}

// Force a color to meet a min contrast against bgHex. Walks L in 0.02 steps
// in the direction that increases contrast, until threshold met or 25 steps used.
function ensureContrast(hsl, bgHex, threshold) {
  const bgL = relLum(hexToRgb(bgHex));
  // If bg is dark, pushing L higher increases contrast.
  // If bg is light, pushing L lower increases contrast.
  const dir = bgL < 0.5 ? +1 : -1;
  let h = { ...hsl };
  let iterations = 0;
  for (let i = 0; i < 25; i++) {
    const hex = hsl2hex(h);
    const c = contrast(hex, bgHex);
    if (c >= threshold) return { hsl: h, hex, contrast: c, iterations };
    h.l = Math.max(0.05, Math.min(0.95, h.l + dir * 0.025));
    iterations++;
  }
  const hex = hsl2hex(h);
  return { hsl: h, hex, contrast: contrast(hex, bgHex), iterations };
}

// ─── palette generation ─────────────────────────────────────────────

function buildPalette({ brand, brand2, brand3, bg, accent, scheme }) {
  const schemeChosen = pickScheme({ brand2, brand3, scheme });
  const { primary, secondary, tertiary } = expandScheme(brand, brand2, brand3, schemeChosen);

  // Base bg / fg by tone — tweaked slightly toward primary hue so the
  // palette doesn't feel disconnected (a 3% sat backdrop helps).
  let bgHex, fgHex, dim1Hex, dim2Hex, tableBgHex, tableAltBgHex, codeBgHex, hrHex;
  if (bg === 'dark') {
    // Slight tint of primary hue at very low S/L.
    bgHex        = hsl2hex({ h: primary.h, s: 0.10, l: 0.10 });
    tableBgHex   = hsl2hex({ h: primary.h, s: 0.10, l: 0.16 });
    tableAltBgHex= hsl2hex({ h: primary.h, s: 0.10, l: 0.13 });
    codeBgHex    = hsl2hex({ h: primary.h, s: 0.08, l: 0.17 });
    fgHex        = hsl2hex({ h: primary.h, s: 0.05, l: 0.85 });
    dim1Hex      = hsl2hex({ h: primary.h, s: 0.08, l: 0.45 });
    dim2Hex      = hsl2hex({ h: primary.h, s: 0.06, l: 0.35 });
    hrHex        = hsl2hex({ h: primary.h, s: 0.06, l: 0.30 });
  } else {
    bgHex        = hsl2hex({ h: primary.h, s: 0.08, l: 0.97 });
    tableBgHex   = '#FFFFFF';
    tableAltBgHex= hsl2hex({ h: primary.h, s: 0.08, l: 0.93 });
    codeBgHex    = hsl2hex({ h: primary.h, s: 0.08, l: 0.93 });
    fgHex        = hsl2hex({ h: primary.h, s: 0.20, l: 0.15 });
    dim1Hex      = hsl2hex({ h: primary.h, s: 0.10, l: 0.45 });
    dim2Hex      = hsl2hex({ h: primary.h, s: 0.06, l: 0.65 });
    hrHex        = hsl2hex({ h: primary.h, s: 0.06, l: 0.78 });
  }

  // Foreground accents — primary = headings, secondary = compare-B / em,
  // tertiary = highlight (numbered list markers, title-cover h1, big-stat).
  const primaryTuned   = tuneForBg(primary,   bg, accent);
  const secondaryTuned = tuneForBg(secondary, bg, accent);
  const tertiaryTuned  = tuneForBg(tertiary,  bg, accent);

  const thresholdAA = 4.5;
  const thresholdHeading = 4.5; // headings often render >24px but we use AA normal as safety
  const headingPick = ensureContrast(primaryTuned, bgHex, thresholdHeading);
  const emPick      = ensureContrast(secondaryTuned, bgHex, thresholdAA);
  const highlightPick = ensureContrast(tertiaryTuned, bgHex, thresholdAA);

  // Body text contrast check — adjust fg if needed (rare).
  let body = ensureContrast(hex2hsl(fgHex), bgHex, 7); // aim AAA for body
  fgHex = body.hex;

  // Inline code color — pick a warm/cool variation that contrasts code-bg.
  const codeAccentSeed = { h: (primary.h + 60) % 360, s: 0.6, l: bg === 'dark' ? 0.7 : 0.4 };
  const codeAccent = ensureContrast(codeAccentSeed, codeBgHex, 4.5);

  // Link color
  const linkSeed = { h: (primary.h + 30) % 360, s: 0.5, l: bg === 'dark' ? 0.6 : 0.4 };
  const linkPick = ensureContrast(linkSeed, bgHex, 4.5);

  // Compare A/B accents — use primary + secondary tuned colors so the
  // headings + compare-A align (visual consistency).
  const compareA = headingPick.hex;
  const compareB = emPick.hex;
  const compareATint = rgba(compareA, 0.10);
  const compareBTint = rgba(compareB, 0.10);

  // Compare A/B border tints — dark muted versions of A/B.
  const compareABorder = hsl2hex({ h: headingPick.hsl.h, s: 0.30, l: bg === 'dark' ? 0.20 : 0.85 });
  const compareBBorder = hsl2hex({ h: emPick.hsl.h,     s: 0.30, l: bg === 'dark' ? 0.20 : 0.85 });

  // Card tint
  const cardTint = bg === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';

  // TL;DR — uses highlight color
  const tldrColor = highlightPick.hex;
  const tldrBg = bg === 'dark'
    ? rgba(highlightPick.hex, 0.10)
    : hsl2hex({ h: highlightPick.hsl.h, s: 0.50, l: 0.92 });
  const tldrText = bg === 'dark' ? highlightPick.hex
                                 : hsl2hex({ h: highlightPick.hsl.h, s: 0.80, l: 0.18 });

  // hljs tokens — derive from primary/secondary/tertiary with bg-correct L
  const dimComment = dim1Hex;
  const tokenKw    = compareA;
  const tokenStr   = hsl2hex({ h: (primary.h + 25) % 360, s: 0.55, l: bg === 'dark' ? 0.6 : 0.35 });
  const tokenNum   = hsl2hex({ h: (primary.h + 140) % 360, s: 0.55, l: bg === 'dark' ? 0.65 : 0.30 });
  const tokenFn    = tokenNum;
  const tokenBuiltin = compareB;
  const tokenAttr  = highlightPick.hex;
  const tokenOp    = compareB;
  const tokenPunct = bg === 'dark' ? hsl2hex({ h: primary.h, s: 0.20, l: 0.7 })
                                   : hsl2hex({ h: primary.h, s: 0.10, l: 0.35 });

  // Table header: keep the heading hue, but ensure the th TEXT passes AA against
  // the header TINT (not just the slide bg). Tinted headers can drop the
  // heading-on-tint pair below 4.5:1 even when heading-on-bg passes cleanly.
  const tableHeaderBgHex = bg === 'dark'
    ? hsl2hex({ h: primary.h, s: 0.20, l: 0.13 })
    : hsl2hex({ h: primary.h, s: 0.30, l: 0.92 });
  const tableHeaderFg = ensureContrast(headingPick.hsl, tableHeaderBgHex, 4.5).hex;

  return {
    schemeChosen,
    bgTone: bg,
    palette: {
      bg: bgHex,
      fg: fgHex,
      heading: headingPick.hex,
      em: emPick.hex,
      strong: fgHex,         // strong typically inherits body
      link: linkPick.hex,
      codeInlineFg: codeAccent.hex,
      codeInlineBg: codeBgHex,
      codeBlockBg: codeBgHex,
      codeBlockFg: fgHex,
      hrHex,
      dim1Hex,
      dim2Hex,
      tableBgHex,
      tableAltBgHex,
      tableBorderHex: hsl2hex({ h: primary.h, s: 0.10, l: bg === 'dark' ? 0.25 : 0.82 }),
      tableHeaderBgHex,
      tableHeaderFg,
      cardTint,
      compareA, compareATint, compareABorder,
      compareB, compareBTint, compareBBorder,
      highlight: highlightPick.hex,
      tldrBorder: highlightPick.hex,
      tldrText,
      tldrBg,
      tldrStrong: headingPick.hex,    // on-brand bold inside TL;DR (was tokenNum = brand+140deg, off-brand)
      coverTitle: highlightPick.hex,    // title-cover h1 + big-stat-hero stat = highlight (most attention-getting accent); was tokenNum (brand+140deg) which drifted off-brand
      sectionDivider: highlightPick.hex,
      processFlowBadgeBg: highlightPick.hex,
      processFlowBadgeFg: bgHex,
      pullQuoteGlyph: highlightPick.hex,
      pullQuoteBody: fgHex,
      pullQuoteH1: headingPick.hex,
      pullQuoteAttr: emPick.hex,    // secondary accent for attribution (was tokenNum = brand+140deg, off-brand)
      sectionDividerText: highlightPick.hex,
      // hljs
      tokenComment: dimComment,
      tokenKw,
      tokenStr,
      tokenNum,
      tokenFn,
      tokenBuiltin,
      tokenAttr,
      tokenOp,
      tokenPunct,
    },
    contrastReport: {
      heading_vs_bg:  contrast(headingPick.hex, bgHex).toFixed(2),
      body_vs_bg:     contrast(fgHex, bgHex).toFixed(2),
      em_vs_bg:       contrast(emPick.hex, bgHex).toFixed(2),
      link_vs_bg:     contrast(linkPick.hex, bgHex).toFixed(2),
      highlight_vs_bg: contrast(highlightPick.hex, bgHex).toFixed(2),
      inlineCode_vs_codeBg: contrast(codeAccent.hex, codeBgHex).toFixed(2),
      tableHeader_vs_headerBg: contrast(tableHeaderFg, tableHeaderBgHex).toFixed(2),
      tldr_text_vs_tldr_bg: bg === 'dark'
        ? contrast(tldrText, bgHex).toFixed(2)
        : contrast(tldrText, tldrBg).toFixed(2),
    },
    iterations: {
      heading: headingPick.iterations,
      em: emPick.iterations,
      link: linkPick.iterations,
      highlight: highlightPick.iterations,
      inlineCode: codeAccent.iterations,
    },
  };
}

// ─── CSS emission ───────────────────────────────────────────────────

function renderTheme({ slug, palette, bgTone, schemeChosen, variant }) {
  const p = palette;
  const titleComment = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Layout variant CSS, appended after the layout block.
  const variantBlock = renderVariant(variant, slug, p, bgTone);

  return `/* @theme ${slug} */
/*
 * ${titleComment} — Marp slide theme.
 * Generated by theme-generator from brand color(s). Scheme: ${schemeChosen}.
 * Bg tone: ${bgTone}.
 *
 * Frontmatter:
 *   ---
 *   marp: true
 *   theme: ${slug}
 *   ---
 */

@import 'default';

/* ─── Slide root ─────────────────────────────────────────────────── */
section {
  background-color: ${p.bg};
  color: ${p.fg};
  font-family: Arial, ui-sans-serif, system-ui, sans-serif;
  font-size: 28px;
  line-height: 1.5;

  /* Layout-block theming hooks (see Layout classes section below) */
  --card-tint: ${p.cardTint};
  --table-row-bg: ${p.tableBgHex};
  --table-row-alt-bg: ${p.tableAltBgHex};
  --compare-a-accent: ${p.compareA};
  --compare-a-tint: ${p.compareATint};
  --compare-b-accent: ${p.compareB};
  --compare-b-tint: ${p.compareBTint};
}

/* ─── Headings ───────────────────────────────────────────────────── */
section :is(h1, h2, h3, h4, h5, h6) {
  color: ${p.heading};
  font-weight: 700;
}

/* ─── Paragraph + lists ─────────────────────────────────────────── */
section p { margin: 0.5em 0; }
section :is(ul, ol) { padding-left: 1.4em; }
section :is(ul, ol) :is(ul, ol) { padding-left: 1em; }
section li { margin: 0.15em 0; }

section li.task-list-item { list-style: none; }
section li.task-list-item input[type="checkbox"] { display: none; }
section li.task-list-item::before { content: "[ ] "; font-family: ui-monospace, monospace; }
section li.task-list-item:has(input:checked)::before { content: "[✓] "; }

section:not(.process-flow) ol li::marker {
  content: counter(list-item) ".  ";
  color: ${p.highlight};
  font-weight: 700;
}
section ul > li::marker        { content: "▸  "; color: ${p.highlight}; }
section ul ul > li::marker     { content: "–  "; color: ${p.dim2Hex}; }

/* ─── Blockquote ─────────────────────────────────────────────────── */
section blockquote {
  color: ${p.heading};
  font-style: italic;
  border-left: 3px solid currentColor;
  padding-left: 0.75em;
  margin: 0.6em 0 0.6em 0.5em;
}

/* ─── Inline emphasis + links ───────────────────────────────────── */
section em             { font-style: italic; color: ${p.em}; }
section strong         { font-weight: 700; }
section :is(del, s)    { text-decoration: line-through; }
section a              { color: ${p.link}; text-decoration: underline; }

/* ─── Inline code ────────────────────────────────────────────────── */
section :not(pre) > code {
  color: ${p.codeInlineFg};
  background-color: ${p.codeInlineBg};
  padding: 0.05em 0.35em;
  border-radius: 3px;
  font-family: Menlo, ui-monospace, "JetBrains Mono", "Fira Code", monospace;
  font-size: 0.92em;
}

/* ─── Code block ─────────────────────────────────────────────────── */
section pre {
  background-color: ${p.codeBlockBg};
  color: ${p.codeBlockFg};
  padding: 0.8em 1em;
  margin: 0.6em 0;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.85em;
  line-height: 1.45;
}
section pre code { background: transparent; color: inherit; padding: 0; font-size: 1em; }

/* highlight.js token colors */
section .hljs                              { color: ${p.codeBlockFg}; background: transparent; }
section .hljs-comment, section .hljs-quote { color: ${p.tokenComment}; }
section .hljs-keyword, section .hljs-selector-tag { color: ${p.tokenKw}; }
section .hljs-string                       { color: ${p.tokenStr}; }
section .hljs-number, section .hljs-literal { color: ${p.tokenNum}; }
section .hljs-built_in                     { color: ${p.tokenBuiltin}; }
section .hljs-title.function_, section .hljs-function .hljs-title { color: ${p.tokenFn}; }
section .hljs-title.class_, section .hljs-class .hljs-title { color: ${p.tokenKw}; font-weight: 700; }
section .hljs-attr, section .hljs-attribute { color: ${p.tokenAttr}; }
section .hljs-operator                     { color: ${p.tokenOp}; }
section .hljs-punctuation                  { color: ${p.tokenPunct}; }

/* ─── Tables ─────────────────────────────────────────────────────── */
section table {
  background-color: ${p.tableBgHex};
  border-collapse: collapse;
  margin: 0.6em 0;
}
section table :is(th, td) {
  border: 1px solid ${p.tableBorderHex};
  padding: 0.4em 0.7em;
}
section table th { background-color: ${p.tableHeaderBgHex}; color: ${p.tableHeaderFg}; font-weight: 700; }
section table td { color: ${p.fg}; }
/* Row backgrounds set by --table-row-bg / --table-row-alt-bg in layout block. */

/* ─── Misc ───────────────────────────────────────────────────────── */
section hr { border: none; border-top: 1px solid ${p.hrHex}; margin: 0.8em 0; }
section dt { font-weight: 700; color: ${p.heading}; }
section dd { color: ${p.fg}; margin-left: 0; }
section dd::before { content: "\u{1F836} "; }
section::after { color: ${p.dim2Hex}; font-size: 0.6em; }
section header, section footer { color: ${p.dim2Hex}; font-size: 0.55em; }

/* ═══════════════════════════════════════════════════════════════════
   Layout palette overrides
   ═══════════════════════════════════════════════════════════════════ */

section.title-cover h1 {
  font-size: 3.5em;
  color: ${p.coverTitle};
  line-height: 1.05;
  margin-bottom: 0.4em;
}
section.title-cover p {
  color: ${p.fg};
  font-size: 0.9em;
  font-weight: 400;
  opacity: 0.75;
}
section.title-cover strong { color: ${p.fg}; font-weight: 400; }
section.title-cover p:first-of-type { font-size: 1em; opacity: 0.9; }

section.section-divider :is(h1, h2, h3) {
  color: ${p.sectionDividerText};
}

section.prose-with-tldr blockquote {
  border-left-color: ${p.tldrBorder};
  background-color: ${p.tldrBg};
  color: ${p.tldrText};
  font-style: normal;
  padding: 0.4em 0.75em;
}
section.prose-with-tldr blockquote strong { color: ${p.tldrStrong}; }

section.big-stat-hero :is(h1, h2, h3) {
  color: ${p.heading};
  align-self: center;
}
section.big-stat-hero .stat {
  color: ${p.coverTitle};
  font-family: Menlo, ui-monospace, "JetBrains Mono", monospace;
}
section.big-stat-hero p { color: ${p.fg}; max-width: 18em; }

section.pull-quote blockquote { color: ${p.pullQuoteBody}; }
section.pull-quote blockquote::before {
  content: '\\201C';
  display: block;
  font-size: 3em;
  color: ${p.pullQuoteGlyph};
  line-height: 0.6;
  margin-bottom: 0.5em;
  font-style: normal;
}
section.pull-quote blockquote p { color: ${p.pullQuoteH1}; font-size: 1.5em; }
section.pull-quote > p { color: ${p.pullQuoteAttr}; font-weight: 700; text-align: right; }

section.process-flow ol li::before { background: ${p.processFlowBadgeBg}; color: ${p.processFlowBadgeFg}; }

section.comparison .compare-grid > div:first-child {
  border: 4px solid ${p.compareABorder};
  border-left: 6px solid ${p.compareA};
}
section.comparison .compare-grid > div:last-child {
  border: 4px solid ${p.compareBBorder};
  border-left: 6px solid ${p.compareB};
}
${LAYOUTS_BLOCK}${variantBlock}`;
}

function renderVariant(variant, slug, p, bgTone) {
  if (!variant || variant === 'none') return '';
  if (variant === 'auto') return ''; // caller decides via flag
  if (variant === 'glow') {
    return `
/* ${slug} variant: neon glow text-shadow */
section :is(h1, h2, h3, h4, h5, h6) {
  text-shadow: 0 0 8px currentColor;
}
section.big-stat-hero .stat {
  text-shadow:
    0 0 20px ${p.coverTitle},
    0 0 40px ${p.coverTitle};
}
`;
  }
  if (variant === 'rounded') {
    return `
/* ${slug} variant: heavy rounded corners on cards */
section.comparison .compare-grid > div { border-radius: 16px; }
section.matrix-2x2 .matrix > div { border-radius: 16px; }
`;
  }
  if (variant === 'uppercase-divider') {
    return `
/* ${slug} variant: uppercase section dividers with rule */
section.section-divider :is(h1, h2, h3) {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-bottom: 2px solid currentColor;
  padding-bottom: 0.2em;
}
`;
  }
  if (variant === 'circle-badges') {
    return `
/* ${slug} variant: circle process-flow badges */
section.process-flow ol li::before {
  clip-path: none;
  border-radius: 50%;
}
`;
  }
  if (variant === 'square-badges') {
    return `
/* ${slug} variant: square process-flow badges */
section.process-flow ol li::before {
  clip-path: none;
  border-radius: 0;
}
`;
  }
  return '';
}

// ─── Layouts block — read once from layouts.css ─────────────────────

const LAYOUTS_PATH = path.resolve(__dirname, '..', '..', 'marp-slides', 'layouts.css');
let layoutsBody = '';
try {
  layoutsBody = fs.readFileSync(LAYOUTS_PATH, 'utf8');
} catch (e) {
  console.error(`WARN: could not read ${LAYOUTS_PATH} — appending an inline fallback header only.`);
  console.error(`      Run with --layouts <path> to override.`);
}

const LAYOUTS_BLOCK = `
/* ═══════════════════════════════════════════════════════════════════
   Layout classes — appended from layouts.css
   Source of truth: <skills-dir>/marp-slides/layouts.css
   ═══════════════════════════════════════════════════════════════════ */

${layoutsBody}`;

// ─── pick a variant based on palette mood ──────────────────────────

function suggestVariant({ schemeChosen, palette, bgTone, accentStyle }) {
  // Vivid + dark + saturated heading → glow
  const headingHsl = hex2hsl(palette.heading);
  if (bgTone === 'dark' && accentStyle === 'vivid' && headingHsl.s > 0.75) return 'glow';
  // Pastel anything → rounded
  if (accentStyle === 'pastel') return 'rounded';
  // Muted → uppercase-divider (more editorial)
  if (accentStyle === 'muted') return 'uppercase-divider';
  return 'none';
}

// ─── main ───────────────────────────────────────────────────────────

const bgTone = pickBgTone({ bg: opts.bg, brand: opts.brand });
const built  = buildPalette({
  brand: opts.brand,
  brand2: opts.brand2,
  brand3: opts.brand3,
  bg: bgTone,
  accent: opts.accent,
  scheme: opts.scheme,
});

let variant = opts.variant;
if (variant === 'auto') {
  variant = suggestVariant({
    schemeChosen: built.schemeChosen,
    palette: built.palette,
    bgTone,
    accentStyle: opts.accent,
  });
}

const css = renderTheme({
  slug: opts.slug,
  palette: built.palette,
  bgTone,
  schemeChosen: built.schemeChosen,
  variant,
});

const defaultOut = path.resolve(__dirname, '..', '..', 'marp-slides', 'themes', `${opts.slug}.css`);
const outPath = opts.out || defaultOut;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, css, 'utf8');

const report = {
  slug: opts.slug,
  outPath,
  bgTone,
  scheme: built.schemeChosen,
  accent: opts.accent,
  variant,
  contrastReport: built.contrastReport,
  iterations: built.iterations,
  palette: built.palette,
};

// Stderr: human-readable summary; stdout: compact JSON.
console.error(`\n[theme-generator] wrote ${outPath}`);
console.error(`[theme-generator] bg=${bgTone} scheme=${built.schemeChosen} accent=${opts.accent} variant=${variant}`);
console.error(`[theme-generator] contrast:`);
for (const [pair, ratio] of Object.entries(built.contrastReport)) {
  const flag = parseFloat(ratio) >= 4.5 ? 'OK' : (parseFloat(ratio) >= 3 ? 'LARGE-ONLY' : 'FAIL');
  console.error(`  ${pair.padEnd(28)} ${ratio.padStart(5)}:1  ${flag}`);
}
console.error(`[theme-generator] iterations: heading=${built.iterations.heading} em=${built.iterations.em} link=${built.iterations.link} highlight=${built.iterations.highlight} inlineCode=${built.iterations.inlineCode}`);

if (opts.verbose) {
  console.log(JSON.stringify(report, null, 2));
}
