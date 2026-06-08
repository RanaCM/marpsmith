---
name: theme-generator
description: Generate a new Marp slide theme CSS file from 1–3 input brand colors, following the var-based palette contract used by the marp-slides skill. Picks an appropriate color scheme (complementary, split-complementary, triadic, analogous, mono, or scheme-from-inputs), generates every palette slot (bg/fg/heading/em/links/code/tables/cards/compare-A-B/TL;DR/process-flow badge/cover title/section divider/hljs tokens), validates WCAG-2 contrast on critical pairs and iterates L until they pass, then writes a drop-in theme CSS with the layouts.css block appended. Use when the user says "make a theme from this brand color", "generate a marp theme for our brand", "I want a new theme based on #X", "convert these brand colors to a slide theme", or asks to extend the theme catalog.
---

# Theme generator for Marp slide decks

Given 1–3 brand colors, produce a complete Marp theme CSS file that drops into `~/.marp/` (or any project's `.marp/`) and conforms to the **var-based palette contract** used by the starter themes in the marp-slides skill. Output is a single self-contained CSS file with palette + appended layouts block.

## Related skills

Part of the **marpsmith** bundle — composes with:
- **marp-slides** — the themes you generate plug into its decks (interchangeable-theme contract).
- **deck-a11y-audit** — audit the generated theme for WCAG contrast before using it.

> Script paths below use `<skills-dir>` — the skills directory configured by the active agent harness; the marpsmith skills live there together.

## Scope

This skill **owns**:
- Mapping 1–3 brand hex inputs to every palette slot the marp-slides contract expects.
- Deciding a color scheme (complementary / split-complementary / triadic / analogous / mono / scheme-from-inputs) based on input count + accent-style hint.
- Validating contrast on critical foreground-vs-background pairs (WCAG 2.1 AA), iterating L until pairs pass.
- Suggesting an optional **layout variant** (glow / rounded / uppercase-divider / circle-badges / square-badges) when the palette mood implies one.
- Writing a complete theme CSS file that includes the layouts.css block, ready for `themeSet:` registration.

This skill **defers**:
- Building slide decks → `marp-slides` skill.
- Critiquing colour-blindness / APCA / vision impairment beyond WCAG AA → `deck-a11y-audit` skill.
- Re-running auto-fit / split passes after theme swap → `marp-slides` skill (theme swap shouldn't trigger them since the layout block is identical).

## Workflow

1. **Collect inputs** from the user:
   - **Required:** at least one brand hex (e.g. `#E63946`). Accept 1, 2, or 3 brand colors.
   - **Required:** a `--slug` for the theme (kebab-case; becomes both the filename and the `@theme` directive).
   - **Optional:** `--bg dark|light` — bg-tone hint. If omitted, heuristic uses brand L: very dark (< 0.35 L) → dark theme; very pale (> 0.78 L, low S) → light theme; otherwise dark (default — most brand palettes pop better on dark).
   - **Optional:** `--accent vivid|muted|pastel` — saturation/L tuning. Default `vivid`.
   - **Optional:** `--scheme auto|complementary|split|triadic|analogous|mono` — override the auto-pick.
   - **Optional:** `--variant auto|none|glow|rounded|uppercase-divider|circle-badges|square-badges`.
   - **Optional:** `--out <path>` — defaults to `<skills-dir>/marp-slides/themes/<slug>.css`. For a project-local theme, use `<project>/.marp/<slug>.css`.

2. **Run the generator script:**
   ```bash
   node <skills-dir>/theme-generator/scripts/generate-theme.mjs \
     --brand "#E63946" \
     --slug crimson-night \
     --bg dark \
     --accent vivid \
     --variant glow
   ```
   It writes the CSS file, prints a contrast report to stderr, and exits non-zero only on argument errors.

3. **Inspect the contrast report.** Every critical pair should pass `OK` (≥ 4.5:1, WCAG AA normal text). If anything reports `LARGE-ONLY` or `FAIL`, see "Troubleshooting" below.

4. **Register the theme** in the user's `.marprc.yml`:
   ```yaml
   themeSet:
     - .marp/<slug>.css
   ```
   Or, if writing to `<skills-dir>/marp-slides/themes/`, the user's existing `themeSet` entry pattern probably already covers it — confirm with the user before adding/removing entries.

5. **Smoke-test by rendering an existing deck.** Pick the user's most-recent deck or a canonical one (`lemborexant-drug-interaction.slides-dark.md` or any of the workspace's `*.slides-*.md` files), copy it to a tmp path, swap the `theme:` line in frontmatter to the new slug, and render with `marp`:
   ```bash
   marp --config-file ./.marprc.yml --html --allow-local-files -o ./<deck>.html ./<deck>.md
   marp --config-file ./.marprc.yml --images png ./<deck>.md
   ```
   Then `Read` slides 1 (title-cover) and a comparison/matrix slide to visually confirm:
   - Heading colour reads against the bg.
   - Compare A / B columns have distinct accents that aren't muddy.
   - TL;DR callouts (if any) have legible text against their own bg.
   - Process-flow badges contrast against the bg.

6. **Report** to the user: scheme used, bg-tone, variant applied, contrast ratios, any iterations needed, and the file path. Mention which existing themes are similar in mood (so the user knows where it fits).

## Decision rubric: which color scheme?

When `--scheme` is `auto` (the default):

| Inputs | Scheme chosen | Rationale |
|---|---|---|
| 3 brand colors | `triadic-from-input` | Honour what the user gave; treat as triadic anchors. |
| 2 brand colors | `dual-input` | Use both inputs; synthesize a 3rd anchor at midpoint + 60° hue shift so it doesn't compete. |
| 1 brand color, no hint | `split` (split-complementary) | Default. Two accents 150°/210° away — high contrast without straight-complement tension. |

You can force a different scheme via `--scheme`:

- **`complementary`** — primary + 180° opposite. Maximum contrast, but two-tone palettes can feel rigid (e.g. brand-only-red themes that want a strict identity).
- **`triadic`** — primary + 120° + 240°. Three roughly-equal anchors. Good when the brand wants playful balance across the spectrum.
- **`analogous`** — primary + ±30°. Harmonious, low-tension. Best for themes that should feel calm/editorial.
- **`mono`** — primary + low-S/high-L tint + low-S/low-L shade. Minimal aesthetic. Best when brand identity is a single recognisable hue and you don't want competing accents.
- **`split`** — primary + 150° + 210°. The default for a reason: gives heading + Compare-A from primary, em/Compare-B from one split anchor, highlight (numbered-list markers, big-stat) from the other. The three roles always have distinct identities without harshness.

The scheme math is deliberately simple HSL plus WCAG-2 contrast iteration. Smoke-render the result before treating it as finished; contrast math catches readability problems, but it does not replace visual judgment.

## Decision rubric: which layout variant?

When `--variant` is `auto`:

| Condition | Variant suggested | Why |
|---|---|---|
| bg = dark + accent = vivid + heading S > 0.75 | `glow` | Neon palettes look great with text-shadow glow on headings + big-stat. |
| accent = pastel | `rounded` | Soft palette + soft corners reinforces the calm aesthetic. |
| accent = muted | `uppercase-divider` | Editorial muted palette pairs with a typographic section-divider treatment. |
| otherwise | `none` | Minimal-signature themes are also valid — `dark.css` itself ships no variant. |

You can also force one explicitly:

- **`glow`** — text-shadow on headings + heavy glow on `.big-stat-hero .stat`. Reads as 80s/synthwave/neon.
- **`rounded`** — 16px `border-radius` on `.compare-grid > div` and `.matrix > div`. Reads as friendly/modern.
- **`uppercase-divider`** — uppercase + 0.08em letter-spacing + bottom border on `section.section-divider` headings. Reads as editorial.
- **`circle-badges`** — `border-radius: 50%` on `.process-flow ol li::before`. Reads as soft/approachable.
- **`square-badges`** — `border-radius: 0; clip-path: none` on the same. Reads as utilitarian/blockish.

Variants must remain single-selector overrides. Do not let a variant change positioning, flex direction, or grid templates — that breaks the layout contract that lets a deck render under any theme.

## Palette slots the generator fills

The contract from `<skills-dir>/marp-slides/themes/README.md`. The script generates every slot below; do not hand-edit unless contrast iteration produced a colour you actively dislike.

Root vars on `section`:
- `background-color`, `color`
- `--card-tint` — fill for `.compare-grid > div`, `.matrix > div`
- `--table-row-bg` / `--table-row-alt-bg`
- `--compare-a-accent` / `--compare-a-tint`
- `--compare-b-accent` / `--compare-b-tint`

Type slots: heading, em, strong (= body fg), link, inline code fg/bg, code-block fg/bg.

hljs token slots: comment, keyword, string, number, function, built-in, attr, operator, punctuation.

Tables: th bg, th fg (= heading), td fg (= body), border colour.

Layout overrides:
- `section.title-cover h1` colour (the "cover title" — typically the most attention-getting accent).
- `section.section-divider :is(h1, h2, h3)` colour.
- `section.prose-with-tldr blockquote` border + bg + text + strong colour.
- `section.big-stat-hero` heading + `.stat` colour.
- `section.pull-quote` glyph + body + h1-inside + attribution colours.
- `section.process-flow ol li::before` bg + fg.
- `section.comparison .compare-grid > div:first-child / :last-child` border + border-left.

## Contrast validation

The generator enforces these minimums (WCAG 2.1 AA normal text = 4.5:1):

| Pair | Threshold | Iteration behaviour |
|---|---|---|
| heading vs bg | 4.5:1 | Walk L by 0.025 in the direction that increases contrast (up if bg-L < 0.5, down otherwise). Max 25 steps. |
| body fg vs bg | 7:1 (AAA) | Body is the most-read text — go for AAA. |
| em vs bg | 4.5:1 | Iterate L. |
| link vs bg | 4.5:1 | Iterate L. |
| highlight vs bg | 4.5:1 | Iterate L. |
| inline code fg vs code-block bg | 4.5:1 | Iterate L (against the code bg, not slide bg). |
| TL;DR text vs TL;DR bg | 4.5:1 | Iterate L. On light themes the TL;DR has its own pale-yellow-ish bg; on dark it uses the slide bg. |

**Why iterate L, not S or H?** Hue is the brand identity — never change it. Saturation changes look like "we picked a different brand colour". Lightness is the lever every palette tool actually pulls. If iteration can't reach threshold within 25 steps, the script ships the best-effort colour and flags the issue in the report (the user can then choose to lower expectations or pick a different scheme).

## Output anatomy

The CSS file written by the script has this shape:

```
/* @theme <slug> */
@import 'default';

section { ...palette + var declarations... }
section :is(h1...h6) { color: ... }
section p, ul, ol, li { ... }
section blockquote { ... }
section em, strong, a { ... }
section :not(pre) > code { ...inline code... }
section pre { ...code block... }
section .hljs-* { ...token colours... }
section table { ... }
section hr, dt, dd, header, footer { ... }

/* Layout palette overrides */
section.title-cover h1 { ... }
section.section-divider :is(h1, h2, h3) { ... }
section.prose-with-tldr blockquote { ... }
section.big-stat-hero { ... }
section.pull-quote { ... }
section.process-flow ol li::before { ... }
section.comparison .compare-grid > div:first-child / :last-child { ... }

/* Layout classes — appended from layouts.css (byte-identical to other themes) */
... ~360 lines of layout block ...

/* Optional variant override at the very end */
section :is(h1...h6) { text-shadow: ... }   /* or rounded / uppercase-divider / etc. */
```

## What NOT to do

- **Do not** modify the layout block in the middle of the file. The layout block is byte-identical across all themes — that's what lets one deck render under any theme. If a structural change is genuinely needed, it belongs in `<skills-dir>/marp-slides/layouts.css` (and propagates to every theme), not in one theme.
- **Do not** generate themes that override layout structure broadly in their variant block. Variants must target a single layout selector (heading text-shadow, process-flow badge shape, section-divider typography, card border-radius). Anything that rewrites `display`, `flex-direction`, `grid-template-columns`, or positioning belongs in the shared layout block.
- **Do not** add `theme:` at the project's `.marprc.yml` config level — that overrides per-deck frontmatter and breaks theme selection across decks. Only add to `themeSet:`.
- **Do not** invent new palette slots. If a slot doesn't exist in the contract, the layout block won't read it and nothing will render. Extend the contract in `layouts.css` first if you genuinely need a new slot.
- **Do not** skip the smoke render. Contrast math is necessary but not sufficient — the only way to catch a "technically passes WCAG but looks muddy/garish/clashy" theme is to render an actual slide and look at it.
- **Do not** silently change the brand hue. Saturation/L are fair game; hue is identity. If a brand colour fundamentally won't work on the chosen bg-tone (e.g. pure #FFFF00 yellow on light bg), report back and ask whether the user wants to flip bg-tone instead.

## Troubleshooting

**Contrast report shows `FAIL` for heading vs bg.**
The script ran 25 L-iterations and still couldn't reach 4.5:1. Almost always means the brand hue has a saturation ceiling that caps achievable contrast (e.g. pure red on near-black, or pure yellow on white). Options:
1. Flip `--bg` to the opposite tone.
2. Try `--accent muted` — the script lowers saturation, which on yellow/cyan/magenta makes L-iteration more effective.
3. Pick `--scheme mono` — uses a hue-locked palette where the script can tweak only L freely.

**TL;DR text reports low contrast on a light theme.**
TL;DR uses a tinted yellow-family bg. If the highlight colour is already yellow, contrast against a yellow-tinted bg collapses. The script picks a desaturated dark variant of the highlight for the text — if it's still failing, the highlight base is probably yellow-on-light-bg which is structurally hard. Try `--scheme split` to push highlight to a non-yellow anchor.

**Variant `glow` looks blurry on a high-contrast or pastel theme.**
Glow needs a saturated heading colour on a dark bg — `text-shadow: 0 0 8px currentColor` reads as fuzz when the heading is desaturated. Either drop the variant or use `--accent vivid` and `--bg dark`.

**The compare-A border on a light theme is hard to see.**
The script picks compare-A-border at L ≈ 0.85 (light) so it reads as a faint card edge, not a competing accent — this is intentional. If the user wants a bolder card edge, they can hand-edit `--compare-a-tint` to use the accent at higher alpha.

## Quality checklist

Before declaring done:
- [ ] CSS file exists at `--out` path and starts with `/* @theme <slug> */`.
- [ ] Contrast report shows `OK` on every critical pair (heading, body, em, link, highlight, inline-code, TL;DR).
- [ ] At least one smoke render produced — open slides 1 and a comparison slide and read the PNG.
- [ ] Title-cover h1 is the most-saturated/most-attention-getting colour in the palette, not the heading colour.
- [ ] Compare-A and Compare-B accents are visually distinct (not both in the same hue range).
- [ ] No emoji in the CSS file unless the user explicitly asked.
- [ ] Theme registered in the appropriate `.marprc.yml` (project-local or user-global, depending on `--out`).

## Pitfalls

- **Light themes are harder than dark themes.** Yellow, cyan, and magenta all sit at high L by default — pushing them down to meet 4.5:1 against white may shift them visibly toward olive, teal, or burgundy. That's not a bug, that's WCAG. If brand fidelity is more important than accessibility for a particular slot, the user has to make that trade-off explicitly.
- **The script reads `<skills-dir>/marp-slides/layouts.css` at run time.** If that file is missing (e.g. the user runs the script in an isolated checkout), the CSS will be palette-only and won't render layout classes correctly. The script warns to stderr and proceeds.
- **HSL is not perceptually uniform.** The iteration loop is mathematically correct for WCAG-2 contrast, but equal HSL lightness does not always look equally bright across hues. Smoke-render the result and adjust by hand if a brand-critical colour looks wrong.
- **Variant + scheme interaction matters.** `glow` on `mono` looks weak (low saturation = weak shadow). `uppercase-divider` on `triadic` competes with already-loud accents. `auto` variant picks try to honour these but the user can always override.
- **Smoke render is the only catch for muddy palettes.** A theme can pass all contrast checks and still look bad if Compare-A and Compare-B are too close in hue. Single-input split-complementary schemes usually work; analogous schemes can read as one-tone.
