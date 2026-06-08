#!/usr/bin/env node
/*
 * audit-theme.mjs — Marp theme accessibility auditor.
 *
 * Parses a theme CSS, extracts foreground/background color pairs from
 * the well-known Marp selector slots (body text, headings, links, blockquote,
 * code, table cells, layout-specific overrides), and computes:
 *
 *   - WCAG 2.1 contrast ratio   (L1+0.05)/(L2+0.05) on sRGB relative luminance.
 *   - APCA Lc (W3C-licensed v0.0.98G-4g, simplified).
 *   - Color-vision-deficiency simulated WCAG ratios for protan/deuter/tritan,
 *     to flag pairs that pass for trichromats but collapse for ~5% of viewers.
 *
 * Usage:
 *   node audit-theme.mjs <path/to/theme.css> [--md] [--apca]
 *
 *   --md    emit markdown report (default: text summary)
 *   --apca  also report APCA Lc values
 *
 * No npm deps. WCAG/APCA/CVD math is inlined. If you want richer
 * color parsing (hsl(), color(), named colors beyond a tiny built-in list),
 * swap in `culori` or `chroma-js`.
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Color parsing ────────────────────────────────────────────────────

const NAMED = {
  black: '#000000', white: '#ffffff',
  red: '#ff0000', green: '#008000', blue: '#0000ff',
  gray: '#808080', grey: '#808080',
  transparent: null,
};

// Parse a CSS color into [r, g, b] in 0..255, or null if unsupported (e.g. gradients).
function parseColor(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'transparent' || s === 'inherit' || s === 'currentcolor' || s === 'none') return null;

  if (NAMED[s] !== undefined) {
    const v = NAMED[s];
    if (v === null) return null;
    return parseColor(v);
  }

  // #rgb, #rrggbb, #rrggbbaa
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const hex = m[1];
    if (hex.length === 3) {
      return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    return null;
  }

  // rgb(...) / rgba(...) — supports both space and comma separators, 0..255 or %
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p) => {
      if (p.endsWith('%')) return Math.round(parseFloat(p) * 2.55);
      return Math.max(0, Math.min(255, Math.round(parseFloat(p))));
    };
    return [ch(parts[0]), ch(parts[1]), ch(parts[2])];
  }

  return null;
}

// Alpha-blend a possibly-transparent foreground tint over a background.
// rgba(r,g,b,a) over [bgR,bgG,bgB] → composited [r,g,b].
function blendOverBg(raw, bg) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return parseColor(raw);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return parseColor(raw);
  const ch = (p) => {
    if (p.endsWith('%')) return parseFloat(p) * 2.55;
    return parseFloat(p);
  };
  const a = parseFloat(parts[3]);
  const r = ch(parts[0]), g = ch(parts[1]), b = ch(parts[2]);
  return [
    Math.round(r * a + bg[0] * (1 - a)),
    Math.round(g * a + bg[1] * (1 - a)),
    Math.round(b * a + bg[2] * (1 - a)),
  ];
}

const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// ─── WCAG 2.1 contrast ────────────────────────────────────────────────

function relLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagRatio(fg, bg) {
  const L1 = relLuminance(fg);
  const L2 = relLuminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// WCAG 2.1 thresholds:
//   AA  normal:  4.5:1
//   AA  large:   3.0:1   (≥18pt or ≥14pt bold)
//   AAA normal: 7.0:1
//   AAA large:  4.5:1
function wcagVerdict(ratio, isLarge) {
  if (isLarge) {
    if (ratio >= 4.5) return 'AAA';
    if (ratio >= 3.0) return 'AA';
    return 'FAIL';
  }
  if (ratio >= 7.0) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'FAIL';
}

// ─── APCA Lc (simplified W3C-licensed implementation) ─────────────────
// Reference: Myndex/apca-w3, v0.0.98G-4g constants.
// Returns signed Lc (negative = dark text on light bg, positive = light on dark).
// Recommended thresholds for body text: |Lc| ≥ 75 minimum, ≥ 90 preferred.
// Large headings: |Lc| ≥ 45. Non-essential: |Lc| ≥ 30.

const APCA_MAINTRC = 2.4;
const APCA_NORMBG = 0.56;
const APCA_NORMTXT = 0.57;
const APCA_REVTXT = 0.62;
const APCA_REVBG = 0.65;
const APCA_BLKTHRS = 0.022;
const APCA_BLKCLMP = 1.414;
const APCA_SCALEBOW = 1.14;
const APCA_LOBOWOFFSET = 0.027;
const APCA_DELTAYMIN = 0.0005;
const APCA_SCALEWOB = 1.14;
const APCA_LOWOBOFFSET = 0.027;
const APCA_LOCLIP = 0.1;

function apcaY([r, g, b]) {
  const sR = Math.pow(r / 255, APCA_MAINTRC);
  const sG = Math.pow(g / 255, APCA_MAINTRC);
  const sB = Math.pow(b / 255, APCA_MAINTRC);
  return 0.2126729 * sR + 0.7151522 * sG + 0.0721750 * sB;
}

function apcaLc(fg, bg) {
  let txtY = apcaY(fg);
  let bgY = apcaY(bg);

  // Black soft-clamp
  if (txtY < APCA_BLKTHRS) txtY += Math.pow(APCA_BLKTHRS - txtY, APCA_BLKCLMP);
  if (bgY < APCA_BLKTHRS) bgY += Math.pow(APCA_BLKTHRS - bgY, APCA_BLKCLMP);

  if (Math.abs(bgY - txtY) < APCA_DELTAYMIN) return 0;

  let outputContrast;
  if (bgY > txtY) {
    // Dark text on light background (BoW)
    const SAPC = (Math.pow(bgY, APCA_NORMBG) - Math.pow(txtY, APCA_NORMTXT)) * APCA_SCALEBOW;
    outputContrast = SAPC < APCA_LOCLIP ? 0 : SAPC - APCA_LOBOWOFFSET;
    return outputContrast * -100; // negative = dark on light
  }
  // Light text on dark background (WoB)
  const SAPC = (Math.pow(bgY, APCA_REVBG) - Math.pow(txtY, APCA_REVTXT)) * APCA_SCALEWOB;
  outputContrast = SAPC > -APCA_LOCLIP ? 0 : SAPC + APCA_LOWOBOFFSET;
  return outputContrast * -100; // positive = light on dark
}

// APCA verdict — uses bronze (Lc 75, body min), silver (Lc 60, large-text min),
// or fail. We treat |Lc| ≥ 75 = body OK, ≥ 60 = headline OK, ≥ 45 = spot OK.
function apcaVerdict(lc, kind = 'body') {
  const a = Math.abs(lc);
  if (kind === 'body') return a >= 90 ? 'AAA' : a >= 75 ? 'AA' : a >= 60 ? 'WEAK' : 'FAIL';
  if (kind === 'large') return a >= 75 ? 'AAA' : a >= 60 ? 'AA' : a >= 45 ? 'WEAK' : 'FAIL';
  return a >= 60 ? 'AAA' : a >= 45 ? 'AA' : a >= 30 ? 'WEAK' : 'FAIL';
}

// ─── Color-blindness simulation matrices (Brettel/Viénot, RGB-to-RGB) ──

const CVD_MATRICES = {
  protanopia: [
    [0.567, 0.433, 0.000],
    [0.558, 0.442, 0.000],
    [0.000, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0.000],
    [0.700, 0.300, 0.000],
    [0.000, 0.300, 0.700],
  ],
  tritanopia: [
    [0.950, 0.050, 0.000],
    [0.000, 0.433, 0.567],
    [0.000, 0.475, 0.525],
  ],
};

function simulateCvd([r, g, b], kind) {
  const m = CVD_MATRICES[kind];
  return [
    Math.round(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    Math.round(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    Math.round(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  ];
}

// ─── CSS extraction ───────────────────────────────────────────────────

// Strip comments first, then grep for property values in `section ...` blocks.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Find the value of `property` in the first matching CSS rule. Naive but
// sufficient — themes follow a flat structure with one selector per block.
function findValue(css, selectorRegex, property) {
  const blockRe = new RegExp(`(?:^|\\})\\s*([^{}]*?${selectorRegex.source}[^{}]*?)\\{([^{}]*)\\}`, 'gi');
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    const body = m[2];
    const propRe = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, 'i');
    const pm = body.match(propRe);
    if (pm) return pm[1].trim();
  }
  return null;
}

// Extract a flat list of (label, fgRaw, bgRaw) pairs to audit.
// The selectors here mirror Marp/glamour theme conventions used in
// <skills-dir>/marp-slides/themes/*.
function extractPairs(css) {
  const c = stripComments(css);

  const bgRaw = findValue(c, /\bsection\b(?!\.)/, 'background-color')
              || findValue(c, /\bsection\b/, 'background');
  const bodyRaw = findValue(c, /\bsection\b(?!\.)/, 'color');
  if (!bgRaw || !bodyRaw) {
    return { bg: null, pairs: [] };
  }

  const bg = parseColor(bgRaw);
  const pairs = [];

  const add = (label, fgRaw, bgRawOverride, kind = 'body', large = false) => {
    if (!fgRaw) return;
    const bgRes = bgRawOverride ? (parseColor(bgRawOverride) || blendOverBg(bgRawOverride, bg) || bg) : bg;
    const fg = fgRaw.includes('rgba') ? blendOverBg(fgRaw, bgRes) : parseColor(fgRaw);
    if (!fg || !bgRes) return;
    pairs.push({ label, fg, bg: bgRes, kind, large, fgRaw, bgRaw: bgRawOverride || bgRaw });
  };

  add('body text', bodyRaw, null, 'body', false);
  add('headings (h1-h6)', findValue(c, /section\s+:is\(h1, h2, h3/, 'color'), null, 'large', true);
  add('strong emphasis', findValue(c, /section\s+strong/, 'color'), null, 'body', false);
  add('em emphasis', findValue(c, /section\s+em/, 'color'), null, 'body', false);
  add('link', findValue(c, /section\s+a\b/, 'color'), null, 'body', false);
  add('blockquote', findValue(c, /section\s+blockquote/, 'color'), null, 'body', false);
  add('inline code', findValue(c, /section\s+:not\(pre\)\s*>\s*code/, 'color'),
      findValue(c, /section\s+:not\(pre\)\s*>\s*code/, 'background-color'), 'body', false);
  add('code block', findValue(c, /section\s+pre\b/, 'color'),
      findValue(c, /section\s+pre\b/, 'background-color'), 'body', false);
  add('table header', findValue(c, /section\s+table\s+th/, 'color'),
      findValue(c, /section\s+table\s+th/, 'background-color'), 'body', false);
  add('table cell', findValue(c, /section\s+table\s+td/, 'color'),
      findValue(c, /section\s+table\s+tr:nth-child\(even\)/, 'background-color'), 'body', false);
  add('section-divider heading',
      findValue(c, /section\.section-divider\s+:is\(h1, h2, h3\)/, 'color'), null, 'large', true);
  add('title-cover h1', findValue(c, /section\.title-cover\s+h1/, 'color'), null, 'large', true);
  add('title-cover subtitle', findValue(c, /section\.title-cover\s+p\b/, 'color'), null, 'body', false);
  add('pull-quote body', findValue(c, /section\.pull-quote\s+blockquote\s+p/, 'color'), null, 'large', true);
  add('pull-quote attribution', findValue(c, /section\.pull-quote\s+>\s+p/, 'color'), null, 'body', false);
  add('big-stat-hero stat', findValue(c, /section\.big-stat-hero\s+\.stat/, 'color'), null, 'large', true);
  add('big-stat-hero heading', findValue(c, /section\.big-stat-hero\s+:is\(h1, h2, h3\)/, 'color'), null, 'large', true);
  add('header/footer chrome', findValue(c, /section\s+header,\s*section\s+footer/, 'color'), null, 'other', false);
  add('page number (::after)', findValue(c, /section::after/, 'color'), null, 'other', false);
  add('prose-with-tldr blockquote', findValue(c, /section\.prose-with-tldr\s+blockquote/, 'color'), null, 'body', false);

  return { bg, pairs };
}

// ─── Audit driver ─────────────────────────────────────────────────────

function severityFor(verdict, kind) {
  // 'other' = low-salience chrome / page numbers. Keep reporting failures,
  // but do not let visible UI chrome dominate content-accessibility findings.
  if (verdict === 'AAA' || verdict === 'AA') return null;
  if (verdict === 'WEAK') return kind === 'other' ? 'LOW' : 'MED';
  return kind === 'other' ? 'LOW' : 'HIGH';
}

function suggestNeutralFix(fg, bg) {
  // Walk fg toward bg's opposite extreme until we hit AA. Returns null if
  // we never reach AA (rare — means the bg itself is hostile).
  const targetLightenBg = relLuminance(bg) < 0.18; // dark bg → push fg lighter
  for (let step = 0.05; step <= 1; step += 0.05) {
    const candidate = fg.map((c, i) => {
      const dest = targetLightenBg ? 255 : 0;
      return c + (dest - c) * step;
    });
    if (wcagRatio(candidate, bg) >= 4.5) return toHex(candidate);
  }
  return targetLightenBg ? '#ffffff' : '#000000';
}

function auditPair(pair) {
  const wcag = wcagRatio(pair.fg, pair.bg);
  const lc = apcaLc(pair.fg, pair.bg);
  const verdict = wcagVerdict(wcag, pair.large);
  const apca = apcaVerdict(lc, pair.kind === 'large' ? 'large' : pair.kind === 'other' ? 'spot' : 'body');

  const cvd = {};
  for (const kind of ['protanopia', 'deuteranopia', 'tritanopia']) {
    const simFg = simulateCvd(pair.fg, kind);
    const simBg = simulateCvd(pair.bg, kind);
    cvd[kind] = wcagRatio(simFg, simBg);
  }

  // CVD collapse: simulated ratio drops by >25% relative to nominal AND nominal was >= 4.5.
  // i.e. trichromat sees fine, CVD viewer sees borderline.
  const cvdCollapsed = wcag >= 4.5 && Object.values(cvd).some((r) => r / wcag < 0.75 && r < 4.5);

  const severity = severityFor(verdict, pair.kind);
  return { ...pair, wcag, lc, verdict, apca, cvd, cvdCollapsed, severity };
}

// ─── Report ───────────────────────────────────────────────────────────

function renderText(theme, results) {
  const lines = [];
  lines.push(`Theme: ${theme}`);
  lines.push(`Pairs audited: ${results.length}`);
  const fails = results.filter((r) => r.severity);
  lines.push(`Findings: ${fails.length} (${results.filter((r) => r.severity === 'HIGH').length} HIGH, ${results.filter((r) => r.severity === 'MED').length} MED, ${results.filter((r) => r.severity === 'LOW').length} LOW)`);
  lines.push('');
  for (const r of results) {
    const marker = r.severity ? `[${r.severity}]` : '[ OK ]';
    const cvdNote = r.cvdCollapsed ? ' (CVD-collapsed)' : '';
    lines.push(`${marker} ${r.label}: ${toHex(r.fg)} on ${toHex(r.bg)} — WCAG ${r.wcag.toFixed(2)}:1 (${r.verdict}), APCA Lc ${r.lc.toFixed(0)} (${r.apca})${cvdNote}`);
  }
  return lines.join('\n');
}

function renderMarkdown(theme, results, themePath) {
  const fails = results.filter((r) => r.severity);
  const high = fails.filter((r) => r.severity === 'HIGH');
  const med = fails.filter((r) => r.severity === 'MED');
  const low = fails.filter((r) => r.severity === 'LOW');
  const cvd = results.filter((r) => r.cvdCollapsed);

  const lines = [];
  lines.push(`# A11y audit — ${theme}`);
  lines.push('');
  lines.push(`**Source:** \`${themePath}\``);
  lines.push(`**Audited:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Pairs audited:** ${results.length}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **HIGH** failures: ${high.length}`);
  lines.push(`- **MED** failures: ${med.length}`);
  lines.push(`- **LOW** failures: ${low.length}`);
  lines.push(`- **CVD-collapsed** pairs (look fine to trichromats, fail under simulated color-blindness): ${cvd.length}`);
  lines.push('');

  const section = (title, items) => {
    if (!items.length) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const r of items) {
      lines.push(`### ${r.label}`);
      lines.push('');
      lines.push(`- **Foreground:** \`${toHex(r.fg)}\` (raw: \`${r.fgRaw}\`)`);
      lines.push(`- **Background:** \`${toHex(r.bg)}\``);
      lines.push(`- **WCAG 2.1 ratio:** ${r.wcag.toFixed(2)}:1 — **${r.verdict}** (threshold: ${r.large ? '3.0/4.5 (large)' : '4.5/7.0 (normal)'})`);
      lines.push(`- **APCA Lc:** ${r.lc.toFixed(0)} — **${r.apca}**`);
      const cvdLines = ['protanopia', 'deuteranopia', 'tritanopia']
        .map((k) => `  - ${k}: ${r.cvd[k].toFixed(2)}:1`)
        .join('\n');
      lines.push(`- **CVD-simulated WCAG ratios:**\n${cvdLines}`);
      if (r.cvdCollapsed) {
        lines.push(`- **Color-blind-safety:** FAIL — nominal contrast is acceptable but collapses for at least one CVD type. Pair distinguishability cannot rely on hue here.`);
      }
      const fix = suggestNeutralFix(r.fg, r.bg);
      lines.push(`- **Suggested fix:** \`${fix}\` (reaches WCAG AA against this background). Pick the nearest palette color that lands at or beyond this lightness.`);
      lines.push('');
    }
  };

  section('HIGH severity', high);
  section('MED severity', med);
  section('LOW severity', low);

  if (cvd.length) {
    lines.push('## Color-blind viewers — collapse list');
    lines.push('');
    lines.push('Pairs that pass nominal WCAG but distinguishability drops sharply when simulated through CVD matrices. If your deck uses these colors to *encode meaning* (e.g. compare-A cyan vs. compare-B pink), the encoding fails for ~5% of viewers — add a non-color cue (icon, label, position).');
    lines.push('');
    for (const r of cvd) {
      lines.push(`- **${r.label}** — nominal ${r.wcag.toFixed(2)}:1; sim min ${Math.min(...Object.values(r.cvd)).toFixed(2)}:1.`);
    }
    lines.push('');
  }

  lines.push('## Passing pairs');
  lines.push('');
  for (const r of results.filter((x) => !x.severity)) {
    lines.push(`- \`${r.label}\`: WCAG ${r.wcag.toFixed(2)}:1 (${r.verdict}), APCA Lc ${r.lc.toFixed(0)} (${r.apca})`);
  }
  lines.push('');
  lines.push('## Method notes');
  lines.push('');
  lines.push('- WCAG 2.1 contrast: `(L1+0.05)/(L2+0.05)` on sRGB relative luminance. AA = 4.5:1 normal / 3.0:1 large; AAA = 7.0:1 / 4.5:1.');
  lines.push('- APCA Lc: WCAG 3 draft candidate, perception-tuned for screens. Body-text minimum |Lc|≥75; preferred ≥90. Large-headline minimum ≥60.');
  lines.push('- CVD simulation: Brettel/Viénot/Mollon-derived RGB→RGB 3×3 matrices for protanopia, deuteranopia, tritanopia. A pair is "CVD-collapsed" when nominal WCAG ≥4.5 but any simulated ratio drops below 4.5 AND to <75% of nominal.');
  lines.push('- Severity: HIGH = body/heading text fails WCAG AA. MED = WEAK APCA on content text. LOW = low-salience chrome/page-number contrast or nitpicks.');
  lines.push('- Not checked here: font size at presentation distance, heading hierarchy correctness, motion. Those are SKILL.md workflow checks.');
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const themePath = args.find((a) => !a.startsWith('--'));
  const md = args.includes('--md');
  if (!themePath) {
    process.stderr.write('Usage: node audit-theme.mjs <theme.css> [--md]\n');
    process.exit(2);
  }
  const css = fs.readFileSync(themePath, 'utf8');
  const themeName = path.basename(themePath, '.css');
  const { bg, pairs } = extractPairs(css);
  if (!bg || !pairs.length) {
    process.stderr.write(`Could not extract bg + pairs from ${themePath}. Is this a Marp theme?\n`);
    process.exit(1);
  }
  const results = pairs.map(auditPair);
  process.stdout.write(md ? renderMarkdown(themeName, results, themePath) : renderText(themeName, results));
  process.stdout.write('\n');
}

main();
