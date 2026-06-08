---
name: marp-slides
description: Convert content-only markdown documents into Marp slide decks with smart, content-shape-aware layout selection. Use when the user wants to turn a doc/report/article into slides, build a Marp presentation, or extend an existing deck — especially when they say "make slides from X", "convert to slides", "presentation from this markdown", or ask about slide layout choices. Provides a 13-layout taxonomy and a priority-ordered decision rubric so layouts match content shape rather than defaulting to bullet-everything (the canonical AI-slop failure mode).
---

# Marp slide builder with auto-layout

Convert content-only markdown into a Marp deck where each slide's layout matches its content shape. Don't bullet-ify everything — that's the failure mode this skill exists to prevent.

## Related skills

Part of the **marpsmith** bundle — composes with:
- **theme-generator** — generate a new theme CSS from brand colors, then set it as the deck's `theme:`.
- **deck-a11y-audit** — check a finished deck or theme for WCAG contrast and colorblind safety.

> Script paths below use `<skills-dir>` — the skills directory configured by the active agent harness; the marpsmith skills live there together.

## Workflow

1. **Read the source document fully** before writing any slides. Layout decisions need the whole document's structure, not just one section at a time.
2. **Read the active theme** — check `.marprc.yml` (or the deck frontmatter) for the theme name, then skim the theme CSS. Note: (a) **heading prefix style** — does it emit `## ` / `# ` before headings? If yes, those ~3 chars count against per-line length budget and increase overflow risk for long headings; (b) **list marker style** — numbered lists with the theme's marker color and spacing; (c) **any custom layout classes** beyond the standard 12; (d) **light vs. dark background** — affects legibility of code blocks and image-heavy slides. These observations should inform phrasing choices and layout selection throughout the conversion.
3. **Set up the project** (only if not already configured). 5 supported starter themes live under `themes/` — single CSS files with palette + layout structure merged in. All share the var-based theming contract: layouts and structure live in a common block driven by CSS custom properties; each theme's palette section sets those vars. A deck written for one theme renders correctly under any other — only the frontmatter `theme:` line changes. Some themes also append a small **layout variant** override (uppercase section dividers, neon glow on hero stats, bordered big-stat, etc.) — the variant changes how a layout renders but never breaks the markdown contract. See `themes/README.md` for the full catalog (dark, light, high-contrast, newspaper, synthwave). Copy what you need to `.marp/` and register them in `.marprc.yml` (see "File setup" below). **Don't replace the user's existing theme.** To create a new color variant, copy `dark.css` (for dark-bg) or `light.css` (for light-bg) and adapt the palette section, including the CSS-var declarations.
4. **Segment the source** into "content blocks" — typically each heading with its body. Split further if a block is too dense for one slide, but do not over-split short adjacent prose blocks; merge related short blocks when they would produce sparse standalone slides.
5. **For each block, run the decision rubric** (below) to pick a layout. First match wins.
6. **Emit the slides** with appropriate `<!-- _class: layout-name -->` directives and the markdown patterns documented per-layout below. **Do not** add heading scale modifiers (`h-XX`) — headings are never scaled down (see "Heading size rule" below). **Do not** add body scale modifiers (`b-XX`) by hand — `auto-fit.mjs` assigns them. **Preserve the original heading level** — if the source has `### Subsection`, render the slide heading as `###`, not `##`. The hierarchy carries meaning (part > section > subsection) that flattening destroys.
7. **Pre-flight lint** — run `node <skills-dir>/marp-slides/scripts/lint-deck.mjs <deck.md>` (see "Pre-flight linter" section). Fast, render-free markdown analysis that mechanizes the cheap checks: layout repetition, sparse prose, asymmetric comparisons, missing pull-quote attribution, heading wrap risk, process-flow verb cues, over-dense bullet lists, over-long tables, frontmatter sanity, duplicate `_class` directives. Fix HIGH and MED findings in source before moving on; LOW findings are advisory.
8. **Auto-fit pass** — run `node <skills-dir>/marp-slides/scripts/auto-fit.mjs <deck.md> --apply --theme <theme.css>` (see "Auto-fit" section). When `--theme` points to a CSS file, the script registers it with Marp's `themeSet` so the deck frontmatter remains authoritative. The script measures each slide's rendered geometry, picks the smallest discrete body scale that fits, and writes `b-XX` classes back to the markdown. Headings are never scaled. Slides that can't fit at the body floor (`b-90`) are flagged for splitting via stderr.
9. **Apply split recommendations.** For each `split-*` action surfaced by auto-fit, read the slide content and split it:
   - `split-list-midpoint` — pure list slide; split items at midpoint, reuse heading on both halves.
   - `split-paragraph-midpoint` — multi-paragraph prose; split at paragraph midpoint.
   - `split-table-midpoint` — single-table slide; split rows at midpoint, refine sub-headings to label each half (e.g., "Topic — Clinical" / "Topic — Community"). Keep the header row on both halves.
   - `split-comparison-detail` — comparison slide that overflows; condense the original to a concise side-by-side overview, then add two detail slides (`compare-detail-a` for the left column's expansion, `compare-detail-b` for the right). The cyan/pink left-edge + tint preserves the visual association.
   - `split-restructure` — mixed content (TL;DR + bullets, etc.); judgment required. Often the right call is to **shorten** the content or restructure it rather than split mechanically.
   - See "Splitting strategy" below for content-aware guidance.
10. **Re-run auto-fit + sanity backstop.** Run auto-fit again; should be idempotent. Then run `check-slides.mjs` as a backstop — it should report zero `vertical-overflow` HIGH issues. Repeat up to 3 iterations if splits introduced new overflow.
11. **Quality checklist pass** (existing checklist at the end of this file).
12. **Escalation** — if HIGH-severity issues remain after 3 iterations, surface a summary to the user with specific slide indices and ask for guidance. Don't silently ship broken slides.

## Heading hierarchy

Keep the source document's heading tiers intact across the slide deck. A document structured as `#` → `##` → `###` should produce slides where:
- `#` headings appear on title-cover or `section-divider` slides as `#`
- `##` headings on most content slides remain `##`
- `###` subsection headings stay `###`
- `####` and deeper render at their natural level

The theme's CSS styles each level differently (h1 has the largest tag background, h2 medium, h3 smaller, etc.), so preserving the level visually communicates depth without extra effort. Don't promote/demote headings just because you wrapped a slide in a layout class — the layout class controls *positioning and decoration*, the heading level controls *hierarchical meaning*.

Exception: if a layout class explicitly normalizes headings (e.g., `big-stat-hero` styles its label uniformly regardless of level), that's intentional. Otherwise, faithfully reflect the source.

## Pre-flight linter

`scripts/lint-deck.mjs` is a fast, render-free markdown linter that runs **before** auto-fit. It catches deck-quality issues that don't require a Chrome render — usually in under 100 ms on a 50-slide deck.

```bash
# Default: print colorized summary, exit 1 on any finding
node <skills-dir>/marp-slides/scripts/lint-deck.mjs path/to/deck.md

# Machine-readable JSON
node <skills-dir>/marp-slides/scripts/lint-deck.mjs path/to/deck.md --json

# CI gate: only HIGH findings affect exit code
node <skills-dir>/marp-slides/scripts/lint-deck.mjs path/to/deck.md --severity high
```

Exit codes: `0` = clean at the chosen severity threshold; `1` = at least one finding; `2` = script error.

### Checks

| Rule | Severity | What it flags |
|---|---|---|
| `frontmatter-missing` / `-no-marp` / `-no-theme` | HIGH | YAML frontmatter missing, no `marp: true`, or no `theme:` |
| `duplicate-class-directive` | HIGH | Two or more `<!-- _class: ... -->` comments on a single slide (Marp uses the last — usually a bug) |
| `layout-repetition` | MED | Same `_class:` directive on 4+ consecutive slides (Cross-deck variety rule) |
| `asymmetric-comparison` | MED | `comparison` columns with word-count ratio > 3:1 |
| `heading-wrap-risk` | MED | Heading > 60 chars on content layout, or > 40 chars on cover-like layout (`title-cover`, `section-divider`, `big-stat-hero`, `pull-quote`) |
| `bullet-list-too-many` | MED | Default bullet slide with > 6 items (should be `two-col-list`) |
| `two-col-list-too-many` | MED | `two-col-list` with > 10 items (should split) |
| `table-too-many-rows` | MED | Table with > 6 data rows |
| `sparse-prose` | LOW | `prose` slide with < 30 body words and no TL;DR (merge or reshape) |
| `pull-quote-no-attribution` | LOW | `pull-quote` missing trailing `— Attribution` paragraph |
| `process-flow-no-verbs` | LOW | `process-flow` where < 50% of items start with a verb or temporal marker |

Run the linter **before** auto-fit. Fixing content-shape issues at source is cheaper than letting auto-fit produce a split recommendation that you then have to rework.

## Auto-fit (font scaling driven by rendered geometry)

Body font size is **not** chosen by hand. After generating the deck, run `auto-fit.mjs` — it renders each slide in headless Chrome, measures the actual text-box bounds, and writes the smallest body scale class that still fits. Headings are never scaled; shorten heading text when needed.

**Discrete steps:**

| Scope | Steps | Floor behavior |
|---|---|---|
| Body (`b-XX`) | 1.00, 0.95, 0.90 | Below 0.90 → split the slide |

Heading scaling (`h-XX`) is **never used** — see "Heading size rule" below.

**Body rule:** default 1.00. Scales down only if non-heading content overflows the section's content area (section bottom minus padding). The script picks the largest scale that fits. **At 0.90 still overflowing → emits a split recommendation; the script does not shrink further.**

Treat `b-90` as a warning state, not proof that the slide is good. After rendering, visually review any `b-90` slide. If it feels packed, crowded, or has little breathing room, fix the markdown content or layout choice rather than accepting the scale just because geometry passed.

**Setup (one-time):**

```bash
cd <skills-dir>/marp-slides/scripts
npm install
```

**Invoke:**

```bash
# Dry run: emit JSON report, no writes.
node <skills-dir>/marp-slides/scripts/auto-fit.mjs path/to/deck.md --theme path/to/theme.css

# Apply: rewrite markdown with recommended classes; surface splits to stderr.
node <skills-dir>/marp-slides/scripts/auto-fit.mjs path/to/deck.md --theme path/to/theme.css --apply
```

When `--theme` is an existing CSS path, the helper registers it as a theme file (`themeSet`) and still lets the deck's frontmatter `theme:` choose by `@theme` name. When `--theme` is a non-path name, it uses Marp's theme override semantics.

The script is **idempotent**: it strips any existing `h-XX` / `b-XX` from the class list before computing fresh ones. Re-running after content edits yields fresh decisions.

**Output (per slide that needs a class or a split):**

```json
{
  "index": 60,
  "action": "rescale",
  "h_scale": 1.0,
  "b_scale": 0.9,
  "recommended": ["b-90"],
  "evidence": { "overflow_at_1": 12 }
}
```

```json
{
  "index": 75,
  "action": "split-restructure",
  "h_scale": 1.0,
  "b_scale": null,
  "recommended": [],
  "evidence": { "overflow_at_0_90": 18 }
}
```

`split-list-midpoint` and `split-paragraph-midpoint` are mechanical and obvious; `split-restructure` requires content judgment (see "Splitting strategy").

Exit code `1` if any split recommendations remain; `0` if everything fit by rescaling alone.

## Heading size rule

Applies to **all themes** (dark, dark-derived color variants, monokai-glow variants, and any custom theme).

**Headings on content slides always stay at the theme's default font size.** Do not apply `h-XX` modifier classes. The `auto-fit.mjs` script skips heading scale entirely — the table in the Auto-fit section above has no `h-XX` column deliberately.

Covered layouts (headings must not be scaled): `prose`, `prose-with-tldr`, `comparison`, `compare-detail-a / b`, `bullet list` (default), `two-col-list`, `process-flow`, `matrix-2x2`, `table / wide-table`, `code-showcase`, `image-led`.

Excluded (intentionally oversized centered text — skip this rule): `title-cover`, `section-divider`, `big-stat-hero`, `pull-quote`.

**What to do when a heading overflows one line:**

1. **Shorten the heading text first.** Cut filler ("The", "Overview of"), tighten phrasing, drop subordinate clauses. Most headings can shed 20–40% of characters without losing meaning.
2. **Two-line wrap is acceptable as a last resort.** If the heading genuinely cannot be shortened without losing its argument, let it wrap to a second line. When it wraps, check that the break is semantically and visually natural: prefer phrase boundaries, subtitle separators, clause boundaries, or other meaningful units. Avoid breaks that orphan a key noun, split a named concept, or leave a qualifier disconnected from the phrase it modifies. If browser wrapping chooses a poor break, insert an explicit `<br>` in the markdown at the better semantic break, for example `## ADHD, Anger, and Racial Misperception<br>— The Systemic Pattern`.
3. **Never shrink the heading font.** A heading at 0.8em or 0.65em looks like body text and breaks the visual hierarchy. That outcome is worse than a two-line heading.

## Splitting strategy

When auto-fit recommends a split, read the slide content before applying it. Mechanical density application loses information that thoughtful splitting preserves; mechanical splitting loses rhythm that thoughtful condensation preserves.

**For `split-list-midpoint`:** straightforward. Split items at (or near) the midpoint, reuse the heading on both halves OR refine each into a sub-heading (`## Topic — Foundations` / `## Topic — Advanced`).

**For `split-paragraph-midpoint`:** straightforward. Split at the paragraph break.

**For `split-table-midpoint`:** straightforward. Cut data rows at the midpoint, keep the header row on both halves, and refine the heading on each half to label what set of rows it contains (semantic grouping beats `(1/2)` / `(2/2)` whenever the rows fall into natural categories).

**For `split-comparison-detail`:** turn one overflowing comparison into three slides:
1. **The original `comparison` slide** stays as the side-by-side overview, but condense each column's bullets to short labels (1–3 words). The audience sees the contrast frame.
2. **A `compare-detail-a` slide** expands the left column. Use whatever inner layout fits the content shape — `prose compare-detail-a` for short prose, `prose-with-tldr compare-detail-a` for denser prose, or just `compare-detail-a` for a regular bullet list. The cyan left edge + side-fade tint signals "this is the left column from the previous slide."
3. **A `compare-detail-b` slide** does the same for the right column with the pink accent.

The detail slides aren't side-by-side — they get the full slide width, with one column's worth of content expanded. The visual continuity comes entirely from the color cue. Don't add `(detail)` or `— Expanded` suffixes; the color does that work.

**For `split-restructure`:** judgment required. Common patterns:
- `prose` or `prose-with-tldr` with 2+ paragraphs covering distinct sub-themes → split into two prose slides, each with one paragraph. Keep a TL;DR only where it adds orientation; drop it when the heading carries the claim.
- `comparison` where one column has 8 bullets and the other has 3 → rebalance content rather than split (auto-fit can't help with column imbalance, but the recommendation flags it).
- Severe overflow (>30% over) on dense single-unit content → consider whether the slide is trying to do too much; often the right move is to shorten, not split.

**Avoid splitting:**
- `pull-quote`, `big-stat-hero`, `title-cover`, `section-divider` — these are standalone layouts. If they overflow, restructure or shorten.
- Slides where the rhythm relies on staying together (quote + immediate context, stat + explanation, list with a summary line).

**Format for split slides:**
- Reuse the same heading, OR refine into sub-headings (`## Topic — Mechanism` / `## Topic — Treatment Implications`).
- Don't add `(1/2)` / `(2/2)` suffixes by default — they read as scaffolding. Use them only when explicit pagination helps the audience.
- After splitting, **re-run auto-fit** — the halves may now fit at 1.00, or fall to 0.95 / 0.90.

**When the heading itself is the problem:** the heading is too long. Don't shrink it — **shorten the heading text**. A 60+ character heading on a content slide is almost always over-detailed.

## Backstop: check-slides.mjs

`scripts/check-slides.mjs` is a sanity check that runs after auto-fit. It emits a JSON report of remaining geometric issues — overflow, header collision, asymmetric columns, etc. After auto-fit + splits have been applied, this should report zero `vertical-overflow` HIGH issues. Use it for CI / automated quality gates.

```bash
node <skills-dir>/marp-slides/scripts/check-slides.mjs path/to/deck.md --theme path/to/theme.css
```

As with `auto-fit.mjs`, a CSS path is registered with `themeSet`; it does not override the deck's frontmatter theme name.

Exit code `1` if any HIGH-severity issue remains; `0` otherwise.

## File setup

Five supported starter themes under `themes/`. Each is a **single CSS file** — palette + layout structure merged in. No external CSS dependencies beyond an optional Google Font import (Newspaper). The full catalog with variants is in `themes/README.md`.

All themes share the var-based theming contract: a common layout block driven by CSS custom properties. Themes that need a structural signature beyond palette also append a small **layout variant** override at the very end of their file (e.g., circle vs. square process-flow badges, uppercase section dividers, neon glow on hero stats). The variant CSS only changes how a layout renders — it never alters the markdown contract.

Pre-`var-contract` snapshots are under `themes/deprecated/` for historical reference only — do not edit them.

**To install a starter theme:**

1. Copy the desired file to `.marp/` (or `~/.marp/`):
   ```bash
   cp <skills-dir>/marp-slides/themes/dark.css ~/.marp/dark.css
   ```
2. Register it in `.marprc.yml` (do **not** set `theme:` at the config level — it overrides the per-deck frontmatter):
   ```yaml
   themeSet:
     - /Users/me/.marp/dark.css
   ```
3. Set `theme: dark` in the deck frontmatter.

**To create a new theme:** Start from `themes/dark.css` (dark bg) or `themes/light.css` (light bg). Edit the palette section at the top — including the CSS-var declarations on `section { ... }`. Leave the layout block below the `═══ Layout classes` separator untouched. If your theme needs a structural variant, append the override CSS rule at the very end of the file.

The layout block is **theme-agnostic** and parameterized via CSS custom properties. The palette section must set these vars on `section { ... }` (in addition to the per-selector color/font rules above) so layout cards, table rows, and column accents adapt to the new palette without touching the layout block:

| Var | Controls | Neutral default in layout block |
|---|---|---|
| `--card-tint` | Background for `.compare-grid > div` and `.matrix > div` (comparison cards + matrix quadrants) | `rgba(127, 127, 127, 0.06)` |
| `--table-row-bg` | Primary table cell background (defeats Marp's default `td { background: white }`) | `transparent` (slide bg shows through) |
| `--table-row-alt-bg` | Alternating-row table cell background | `rgba(127, 127, 127, 0.05)` |
| `--compare-a-accent` | Left-column accent on `comparison` + `compare-detail-a` (cyan family) | `#A1EFFF` |
| `--compare-a-tint` | Left-column gradient fade tint for `compare-detail-a` | `rgba(161, 239, 255, 0.06)` |
| `--compare-b-accent` | Right-column accent (pink family) | `#EA6B8D` |
| `--compare-b-tint` | Right-column gradient fade tint | `rgba(234, 107, 141, 0.06)` |

A theme that sets these vars correctly will render visually-correct slides under the same source markdown as any other compliant theme — no theme-specific class names or workarounds in the deck. That is the **interchangeable-themes contract**: at the markdown level, theme switching is purely the `theme:` frontmatter line.

### Layout variants (optional)

Themes that want a structural signature beyond palette can append a small CSS override at the very end of the file, *after* the layout block. The cascade puts these last so they win without modifying the shared layout block. Existing examples:

- `high-contrast` — bordered box around `big-stat-hero .stat`
- `newspaper` — Georgia serif font + uppercase letter-spacing on section-divider with rule
- `synthwave` — neon-glow `text-shadow` on headings + big-stat numbers

Variants must target a specific layout selector (not redesign positioning broadly) and must never break the markdown contract — the same `<!-- _class: layout-name -->` directive must still work; the variant only changes how it renders.

> **Why not `@import url('./layouts.css')`?** Marp builds to a single HTML file and passes `@import url()` straight through to the browser. The browser resolves the path relative to the HTML output location, not the original CSS file location — causing a silent 404 for relative paths outside the output directory. Named `@import 'themeName'` works, but requires registering `layouts.css` as a full theme in `themeSet`. The self-contained single-file approach avoids both pitfalls.

### Palette override points

When creating a new theme, provide palette overrides for these selectors (layout structure defaults use neutral whites/grays at low opacity as fallbacks):

| Selector | What it controls | Notes |
|---|---|---|
| `section :is(h1, h2, h3, h4, h5, h6)` | Heading text + tag-style background per level | The "kicker" tag color is the primary brand accent |
| `section blockquote` | Default blockquote color + border | |
| `section em` / `section strong` / `section a` | Inline emphasis colors | |
| `section :not(pre) > code` | Inline code text + background | |
| `section pre`, `section .hljs-*` | Code block colors and syntax tokens | |
| `section table th` / `td` text + header bg | Table header background, text colors. Row backgrounds set via `--table-row-bg` / `--table-row-alt-bg` vars (see "To create a new theme" below). | |
| `section.title-cover h1`, `section.title-cover p` | Cover slide hero color + supporting text | |
| `section.section-divider :is(h1, h2, h3)` | Chapter-divider title color + bg | |
| `section.prose-with-tldr blockquote` | TL;DR kicker bg + border + text + `strong` color | |
| `section.big-stat-hero :is(h1, h2, h3)`, `.stat`, `section.big-stat-hero p` | Hero label, the big number, and caption colors | |
| `section.pull-quote blockquote::before`, `blockquote p`, `> p` | Giant opening quote glyph color, quote text, attribution | |
| `section.process-flow ol li::before` / `::after` | Step circle border + connector line color | |
| `.compare-grid > div:first-child` / `:last-child` | Comparison column accent borders (typically two contrasting hues). Card fill is shared with `.matrix > div` via `--card-tint` | |
| `section.compare-detail-a` / `compare-detail-b` | Uses `--compare-a-accent` / `--compare-a-tint` (and `-b-` variants) — set these in the palette `section { ... }` block | |
| `section ol li::marker` | Numbered list marker color | |

See `themes/README.md` for the supported starter-theme policy and historical color-token references.

### `.marprc.yml`

Register the theme files you want available. **Do not** set a `theme:` field at the config level — it behaves like `--theme` on the CLI and *overrides* the per-deck frontmatter `theme:`, which silently breaks per-deck theme selection (every deck will render with the config theme regardless of what its frontmatter says).

```yaml
# Register themes only — let each deck's frontmatter pick which one to use.
themeSet:
  - /Users/me/.marp/dark.css
  - /Users/me/.marp/light.css
```

### Frontmatter for every slide deck:
```markdown
---
marp: true
theme: dark   # or light, etc. — must match a registered theme's @theme name
paginate: true
---
```

The frontmatter `theme:` is what controls theme selection. The `themeSet` in `.marprc.yml` only registers files; the lookup is by the `@theme <name>` directive at the top of each CSS file.

## Layout taxonomy (13)

| Layout | Class | When |
|---|---|---|
| Title cover | `title-cover` | Deck or chapter opener |
| Section divider | `section-divider` | Heading-only chapter break |
| Prose | `prose` | 1–3 short paragraphs where the heading already carries the takeaway |
| Prose with TL;DR | `prose-with-tldr` | Dense paragraph-form text where a one-sentence kicker adds value |
| Bullet list | (default, no class) | 3–6 short parallel items |
| Two-column list | `two-col-list` | 7–10 parallel items |
| Comparison (VS) | `comparison` | Exactly 2 things contrasted |
| Matrix 2×2 | `matrix-2x2` | 4 items on two categorical axes |
| Table | (default, no class) | Tabular data, ≥2 cols × 3–6 rows |
| Big stat hero | `big-stat-hero` | One number/percentage dominates |
| Pull quote | `pull-quote` | Single attributed quote stands alone |
| Process flow | `process-flow` | 3–7 ordered steps with verb/temporal cues |
| Image led | `image-led` | Image dominates, ≤30 word caption |
| Code showcase | `code-showcase` | Code block + brief framing |

## Decision rubric (priority order — first match wins)

Process each content block (heading + body — heading at any level) through this list top-to-bottom:

1. **Heading only, no body** → `section-divider`
2. **Body is a single blockquote with attribution** → `pull-quote`
3. **First sentence contains a number/percentage AND total body ≤25 words** → `big-stat-hero`
4. **Body is a fenced code block + ≤60 words prose** → `code-showcase`
5. **Body is exactly 2 sub-sections with parallel structure, OR contains "vs"/"versus"/"before/after"** → `comparison`
6. **Body is a table ≥2 cols × ≥3 rows** → table (default). If 4 items on two binary axes, consider `matrix-2x2`. If >6 rows, split across slides.
7. **Body is an ordered list of 3–7 items AND items start with verbs/temporal markers ("first," "then," "next," verb-led actions)** → `process-flow`
8. **Body is a bullet list, 3–6 items, ≤12 words each** → bullet list (default)
9. **Body is a bullet list, 7–10 items, parallel structure** → `two-col-list`
10. **Body is image + ≤30 word caption** → `image-led`
11. **Body is prose, 1–3 short paragraphs, and the heading already states the claim** → `prose`. Do not add a TL;DR just to fill the layout. If adjacent short prose blocks are closely related, merge them into one denser prose slide or reshape them into bullets/comparison/table rather than producing several sparse slides.
12. **Body is dense prose ≥80 words (paragraph-form, no list), or the heading is descriptive rather than claim-like** → `prose-with-tldr`. If >180 words, split across two slides at a paragraph boundary.
13. **Fallback** → bullet list, after extracting topic sentences from the prose

## Markdown patterns per layout

### title-cover
```markdown
<!-- _class: title-cover -->

# Deck Title

**Subtitle or tagline**

Optional date / author / context line
```

### section-divider
```markdown
<!-- _class: section-divider -->

## Part 2: The Mechanics
```
Heading-only. No body content.

### prose
```markdown
<!-- _class: prose -->

## The Heading That Already Carries the Claim

One to three short paragraphs, kept as prose rather than converted into bullets. Use this when adding a TL;DR would repeat the heading or restate the only body sentence.

A second paragraph is fine when it extends the first point rather than introducing a separate sub-topic.
```
Use `prose` for short connective explanation. Avoid it for dense source blocks that need a kicker sentence to orient the reader.

### prose-with-tldr
```markdown
<!-- _class: prose-with-tldr -->

## The Heading

> **TL;DR:** The single sentence that captures the argument.

The supporting prose, kept as paragraphs (not bullets). Aim for 100–180 words. The TL;DR is a `>` blockquote so the theme can style it as a kicker; the prose below stays in paragraph form to preserve connective tissue.
```
Use `prose-with-tldr` only when the kicker adds orientation. If the heading already says the claim and the body is only 2–3 sentences, use `prose` instead.

### bullet list (default)
```markdown
## The Heading

- Item one
- Item two
- Item three
```
3–6 items max, each ≤12 words. No class needed.

### two-col-list
```markdown
<!-- _class: two-col-list -->

## The Heading

Optional one-line intro.

1. Item one
2. Item two
3. Item three
4. Item four
5. Item five
6. Item six
7. Item seven
8. Item eight
```
The `column-count: 2` CSS splits the list automatically.

### comparison
```markdown
<!-- _class: comparison -->

## A vs B

<div class="compare-grid">
<div>

**Option A**
- Strength one
- Strength two
- Tradeoff

</div>
<div>

**Option B**
- Strength one
- Strength two
- Tradeoff

</div>
</div>
```

### compare-detail-a / compare-detail-b
```markdown
<!-- _class: compare-detail-a -->

## Topic — Why Option A Wins

- Detailed point 1 (expanding on the concise label from the comparison slide)
- Detailed point 2
- Detailed point 3

---

<!-- _class: compare-detail-b -->

## Topic — Why Option B Wins

- Detailed point 1
- Detailed point 2
```
Companions to a `comparison` slide. The cyan (left) and pink (right) accents and side-fade tints come automatically. Stack with any inner layout — `compare-detail-a` is a modifier, not a standalone layout: combine with `prose compare-detail-a` for short prose, `prose-with-tldr compare-detail-a` for denser prose, or use bare on a default bullet-list slide.

### matrix-2x2
```markdown
<!-- _class: matrix-2x2 -->

## Decision Matrix

<div class="matrix">
<div><strong>High X / Low Y</strong><br>Item A</div>
<div><strong>High X / High Y</strong><br>Item B</div>
<div><strong>Low X / Low Y</strong><br>Item C</div>
<div><strong>Low X / High Y</strong><br>Item D</div>
</div>
```

### table (default) / wide-table
```markdown
## The Heading

| Col A | Col B | Col C |
|---|---|---|
| ... | ... | ... |
```
Cap at ~6 rows per slide. If more, split.

For data tables that should fill the slide width (most "key statistics" / reference tables), add the `wide-table` modifier:

```markdown
<!-- _class: wide-table -->

## Key Statistics

| Finding | Number | Source |
|---|---|---|
| ... | ... | ... |
```

Why opt-in: Marp imports GitHub markdown CSS, which sets `table { display: block; width: max-content }`. That leaves the table at content width and right-aligned-feeling on most slides. `wide-table` overrides this to `display: table; width: 100%` and tightens cell padding. Scoped so it doesn't change tables on other slides.

### big-stat-hero
```markdown
<!-- _class: big-stat-hero -->

## The Heading

<div class="stat">58%</div>

Of weekly Pro allowance burned in two design sessions
```

### pull-quote
```markdown
<!-- _class: pull-quote -->

> The single biggest determinant of output quality is not the prompt — it is the structured style context you feed the tool *before* you ever type a request.

— Muzli, one-week retrospective
```
No heading. Quote stands alone.

### process-flow
```markdown
<!-- _class: process-flow -->

## The Workflow

1. Drop assets in folder
2. Synthesize design system
3. Save as DESIGN.md
4. Feed to the agent
```
Items are auto-numbered with large step indicators by the CSS.

### image-led
```markdown
<!-- _class: image-led -->

## The Heading

![alt](path/to/image.png)

Caption — keep under 30 words
```

### code-showcase
```markdown
<!-- _class: code-showcase -->

## The Pattern

```yaml
themeSet:
  - .marp/monokai-glow.css
  - .marp/monokai-glow-light.css
```

Brief framing — what this does, why it works.
```

## Heavy-text guidance

The instinct to bullet-ify dense prose is the **#1 failure mode**. Resist it:
- A 150-word paragraph distilled into 5 bullets loses the connective reasoning. The slide looks generic and any reader who knows the source material can tell it was AI-converted.
- Use `prose` for short paragraph-form explanation where the heading already carries the claim.
- Avoid sparse standalone prose slides. A `prose` slide with only 1–2 short sentences is usually underfilled unless it is an intentional pause, transition, or key takeaway. Merge it with neighboring related content or reshape the local sequence into a denser layout.
- Use `prose-with-tldr` for denser prose: extract a single-sentence TL;DR as the kicker, keep the original prose below.
- Do not add a TL;DR that merely repeats an action-title heading ("X beats Y because Z"). In that case, the heading is already doing the TL;DR job.
- If `prose-with-tldr` needs `b-90`, re-check the slide by eye. If it feels crowded, reduce content, remove a redundant TL;DR, switch to `prose`, or split the slide.
- Split prose-heavy blocks across multiple slides when the paragraph exceeds ~180 words, or sooner when the rendered slide feels crowded at `b-90`.

**Short-prose vertical centering is automatic.** When a `prose` or `prose-with-tldr` slide has fewer than 3 paragraphs of body (the common case — 1–2 short paragraphs after the heading, with or without a TL;DR), the layout block vertically centers the content via a `:has()` rule so the slide reads balanced rather than top-heavy. Don't try to compensate by padding the body, inflating bullet counts to "fill space," or repeating the TL;DR — short prose is meant to look short. Dense prose (3+ paragraphs, or anything auto-fit had to shrink with `b-95`/`b-90`) still renders top-anchored, where the reading rhythm of a heading followed by a flowing column of paragraphs is correct.

## Cross-deck variety

Don't repeat the same layout 4+ times in a row, even if every block matches the same rubric rule. If you have ten consecutive 5-bullet slides, alternate at least one with prose, prose-with-tldr, or pull-quote to break the rhythm. Variety is a tiebreaker, not a primary rule — never override the rubric just for variety.

## Quality checklist (run before finishing)

1. **Title slide uses `title-cover`.**
2. **Every slide has either a heading or is intentionally heading-less** (pull-quote, big-stat-hero).
3. **No slide has more than 6 bullets** (use `two-col-list` if more).
4. **No table has more than 6 rows** (split otherwise).
5. **No paragraph wider than ~180 words on a single slide** (split otherwise).
6. **First slide of every major section is either `section-divider` or has a clear chapter feel.**
7. **No layout repeats 4+ times consecutively** without an intentional break.
8. **Headings are action-titles where possible** ("X beats Y" not just "X"). This is the McKinsey/BCG convention and it dramatically improves scanability.
9. **Placeholder copy rewritten** — AI-generated microcopy is the #1 AI-slop tell. If anything reads like template filler, rewrite it.
10. **Preview the deck** with `marp --preview <file>.md` before declaring done. Layout problems (overflow, white-on-white tables, tight headers) only show up in render.

## Suggesting the right setup

If the user has a deck they want styled but no theme yet, ask:
- "Do you want a base theme I can adapt, or should I create one?"
- For a new theme, default to a dark-mode terminal-style aesthetic unless they specify otherwise — it's the most forgiving for AI-generated content because dense text reads better on dark backgrounds.

If the user already has a theme, **don't replace it.** Add the layout classes from `layouts.css` into their existing theme, preserving their colors/fonts.

## Common pitfalls and fixes

- **Tables render with white rows in dark themes** — Marp imports GitHub markdown CSS via `@import 'default'`, which sets `td { background-color: white }` and also `table { display: block; width: max-content }`. To get a full-width readable table on a dark theme, override both: `display: table; width: 100%` on the table, and `background-color` on `td`.
- **Long lists / dense slides overflow** — don't reach for a class by hand. Run `auto-fit.mjs --apply`; it'll either pick `b-90` or flag a split. Manual density tuning is the workflow this skill replaced.
- **`auto-fit` stays at split after a split was already applied** — if you split a slide and the half *still* overflows at `b-90`, the answer isn't a third split. Shorten the content (drop a sentence from a TL;DR, trim a bullet, condense prose). The floor is set deliberately at the smallest readable size, so anything that doesn't fit there is the slide carrying too much.
- **Marp preview doesn't reload after CSS edits** — the preview process watches the markdown file, not the theme CSS. After editing the theme, kill and restart `marp --preview`. Browser refresh alone won't help; it just refetches the same stale HTML.
- **`.marprc.yml theme:` / CLI `--theme` override frontmatter** — both behave as the same input and *win* over the deck's frontmatter `theme:` field. If a deck's frontmatter says `theme: light` but `.marprc.yml` has `theme: dark`, the deck renders dark. To make frontmatter authoritative (the only way the interchangeable-themes contract works per-deck), do **not** set `theme:` at the config level — only register files via `themeSet:`. Verified with marp-cli v4.2.3.
- **Light deck renders with dark theme even though frontmatter says `theme: light`** — almost always the same root cause as above. Check `.marprc.yml` for a `theme:` line and remove it. Symptom: rendered HTML has `section{background-color:#<dark-color>}` even though the deck's frontmatter is correct.
- **`@theme name` collisions across CSS files** — two theme files in `.marp/` declaring the same `@theme monokai-glow` will clobber each other in `themeSet`. Each theme file needs a unique `@theme` name.
- **Overflow checks based on `scrollHeight`/`clientHeight` always read equal** — Marp puts `overflow: hidden` on `<section>`, so the section never reports overflow scrollheight. To detect overflow you must walk children and compare each one's `getBoundingClientRect().bottom` to the section's bottom. `auto-fit.mjs` and `check-slides.mjs` already do this; if you write a new geometric check, mirror that pattern.
- **Markdown table looks like literal pipes in preview** — the user's preview tool probably doesn't render tables; confirm the file has `marp: true` frontmatter and that the preview is `marp --preview`, not a generic markdown viewer.

## When to reach for an existing theme vs. write one

The user's `.marp/` directory may already have a theme (e.g., `monokai-glow.css`). Read it first; if it has the visual style they want, just append the layout classes from this skill's `layouts.css` to it. Don't write a new theme unless the user asks for one.
