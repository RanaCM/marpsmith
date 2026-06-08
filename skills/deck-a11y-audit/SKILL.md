---
name: deck-a11y-audit
description: Audit a Marp slide deck or theme CSS for accessibility — WCAG 2.1 AA/AAA contrast ratios, APCA Lc (WCAG 3 draft), color-blind safety under deuteranopia/protanopia/tritanopia simulation, presentation-distance text-size legibility, heading-hierarchy correctness, and reliance on color alone to encode meaning. Output is a structured markdown report ranking issues by severity with suggested palette fixes. Use when the user asks to "audit this deck for accessibility", "check the theme's color contrast", "is this deck colorblind-safe", "run a WCAG audit on this deck", or "is this readable for low-vision users".
---

# Deck a11y audit

Audit a Marp deck and/or its theme CSS for accessibility issues. Output is a markdown report; the user decides what to fix.

## Related skills

Part of the **marpsmith** bundle — composes with:
- **marp-slides** — builds the decks and themes this audits.
- **theme-generator** — generate a theme, then audit it here before shipping.

> Script paths below use `<skills-dir>` — the skills directory configured by the active agent harness; the marpsmith skills live there together.

## Scope

This skill checks:

1. **WCAG 2.1 contrast** — `(L1+0.05)/(L2+0.05)` on sRGB relative luminance. AA/AAA pass/fail per pair.
2. **APCA Lc** — WCAG 3 draft, perception-tuned. Catches dark-mode cases where WCAG 2 passes a thin-stroke cyan-on-dark pair that looks washed-out at body size.
3. **Color-blind safety** — RGB→RGB Brettel/Viénot matrices for the three dichromacy types; flags pairs that look fine to trichromats but collapse for ~5% of viewers.
4. **Text size at presentation distance** — body text in pt-equivalent vs. expected venue size; flags decks that will fail at >20ft viewing.
5. **Heading hierarchy** — `h1 → h2 → h3` order in slide markdown; flags skipped levels.
6. **Reliance on color alone** — comparison/matrix/process-flow slides where the only differentiator is hue (e.g., cyan column vs. pink column with identical iconography).
7. **Motion / animation** — Marp itself doesn't animate much, but flag any inline `<style>` with `@keyframes` or transitions that should respect `prefers-reduced-motion`.

This skill **defers** to:

- `marp-slides/scripts/check-slides.mjs` for geometric overflow.
- `deck-review` for editorial issues (tone, citations, terminology).
- `deck-visual-review` for eye-flow / aesthetic judgments.

If the user asks for "everything," recommend running all four in sequence.

## Workflow

1. **Identify inputs.** You need either a theme CSS path, a Marp deck markdown path (theme inferred from frontmatter), or both. If neither, ask.
2. **Run the theme contrast script.** `scripts/audit-theme.mjs <theme.css> --md > <report.md>`. This handles checks 1–3 mechanically. It's fast (<200ms, no npm deps). Always run this first when a theme is available.
3. **Check text size at presentation distance** (manual — script doesn't measure this). See "Presentation-distance heuristic" below.
4. **Check heading hierarchy** (manual on the deck markdown). Walk `#`/`##`/`###` per slide and flag skipped levels.
5. **Check color-as-only-signal slides.** Read each `comparison`, `matrix-2x2`, `process-flow` slide. If A vs. B is distinguished only by hue (no labels, no icons, no position semantics), flag it.
6. **Check motion concerns.** Grep the deck markdown + theme CSS for `@keyframes`, `transition:`, `animation:`. Default Marp themes have none — but custom slide-level `<style>` blocks sometimes do.
7. **Compose the final report.** Merge the script's markdown output with the manual findings into one structured report. Use the template in "Report structure" below.

Do **not** edit the deck or theme. The report is the deliverable.

## Thresholds and rubric

### WCAG 2.1 contrast (the well-established standard)

Formula: `(Llight + 0.05) / (Ldark + 0.05)` where `L = 0.2126 R' + 0.7152 G' + 0.0722 B'` after sRGB linearization (`c/12.92` if `c ≤ 0.03928`, else `((c+0.055)/1.055)^2.4`).

| Text size                              | AA  | AAA |
|----------------------------------------|-----|-----|
| Normal (<18pt, or <14pt bold)          | 4.5 | 7.0 |
| Large (≥18pt, or ≥14pt bold)           | 3.0 | 4.5 |

For Marp default theme at 28px / 1.5 line-height, body text is "normal" — require ≥4.5:1.

### APCA Lc (WCAG 3 draft — useful for dark-mode decks)

WCAG 2 is calibrated mostly for dark-on-light print contrast. APCA's perceptual model handles light-on-dark better and is sensitive to font weight. Use APCA as a **secondary** check, not a replacement, until WCAG 3 ships.

| Use                                            | Min |Lc| | Preferred |
|------------------------------------------------|-----------|-----------|
| Body text (≥14px/400 or ≥18px/300)             | 75        | 90        |
| Large headings (≥24px bold or ≥36px normal)    | 60        | 75        |
| Spot/non-essential text                        | 30        | 45        |

A pair that passes WCAG AA but fails APCA Lc 75 is **borderline** — readable but tiring at body size. Cyan-on-dark-purple is the canonical example: 15:1 WCAG, ~91 Lc — actually fine. But `#00AFFF` on `#1E1E1E` is 6.8:1 WCAG (passes AAA-large) but Lc 53 (FAIL for body) — feels thin at body size and should be reserved for headings.

### Color-vision-deficiency safety

Apply these RGB→RGB simulation matrices, then re-run WCAG on the simulated colors:

```
Protanopia    [ 0.567 0.433 0.000 ; 0.558 0.442 0.000 ; 0.000 0.242 0.758 ]
Deuteranopia  [ 0.625 0.375 0.000 ; 0.700 0.300 0.000 ; 0.000 0.300 0.700 ]
Tritanopia    [ 0.950 0.050 0.000 ; 0.000 0.433 0.567 ; 0.000 0.475 0.525 ]
```

A pair is **CVD-collapsed** when:

- Nominal WCAG ≥ 4.5 (would pass for trichromats), AND
- At least one simulated WCAG ratio drops below 4.5 AND below 75% of nominal.

Even when CVD-simulated text-on-bg contrast holds, the bigger risk is *encoding-by-hue*: comparison slides where "the cyan one is good" and "the pink one is bad" become indistinguishable. The script doesn't catch this — you do, in step 5 of the workflow.

### Presentation-distance text size

The "8H rule": last-row distance ≤ 8 × screen height, and text height ≥ screen height / 50. For a typical 1080p projector at 6m distance:

| Setting                                    | Min body | Min heading |
|--------------------------------------------|----------|-------------|
| Laptop / 1:1 demo (≤1m)                    | 16pt     | 22pt        |
| Conference room (≤4m)                      | 20pt     | 32pt        |
| Auditorium / projector (≤10m)              | 28pt     | 40pt        |
| Large hall (>10m)                          | 32pt+    | 48pt+       |

Marp default body is 28px ≈ 21pt. That's auditorium-borderline; safe for conference rooms and explicit auditoriums where the projector is large. A theme that drops to 24px or applies `b-90` autoshrink (~25.2px ≈ 19pt) is **conference-room only** — flag it if the user intends a larger room.

When the deck has explicit `b-95` / `b-90` autoshrink classes, note those slides specifically: shrinking is the marp-slides skill's last-resort overflow fix and degrades legibility at distance.

### Heading hierarchy

Walk the deck slide-by-slide. For each slide, list the heading levels in order. Flag:

- A slide that opens with `##` or `###` and has no preceding `#` ancestor in the deck (or in the title-cover).
- A jump from `h1` straight to `h3` (skipping `h2`).
- A `section-divider` that uses `h3` while normal content slides use `h1` (inverted).

For Marp specifically: title-cover slides use `h1`, section-divider slides use `h2`, content slides use `h1` (most themes) or `h2`. Pick one convention and flag deviations. The marp-slides skill's default is content `h1`.

### Reliance on color alone

For each comparison/matrix/contrast slide:

- ✅ OK if both columns have **labels** in the heading or first line ("✓ Pros" / "✗ Cons", "Before" / "After", "Option A: Buy" / "Option B: Build").
- ✅ OK if both columns use distinguishing **icons** in the bullet markers.
- ❌ FAIL if the only signal is the column color (e.g., theme paints left column cyan and right column pink, but the user wrote `Pros\n- foo\n- bar` and `Cons\n- baz\n- qux` with no other cue and relies on column position alone).

Column position alone is borderline — works for the audience but only if the convention is established earlier. If the deck uses 2-column comparisons in 4+ slides and they all follow the same left=positive/right=negative convention, that's an established convention and OK. If it's inconsistent, flag it.

## Report structure

```markdown
# Deck a11y audit — <deck-or-theme-name>

**Source:** /path/to/deck.md or /path/to/theme.css
**Audited:** YYYY-MM-DD
**Pairs audited:** N (script) + M (manual)

## Summary

- HIGH failures: N
- MED failures: N
- LOW failures: N
- CVD-collapsed pairs: N
- Heading-hierarchy issues: N slides
- Color-only-signal slides: N
- Presentation-distance concerns: N slides

## Contrast findings (from audit-theme.mjs)

<paste script's markdown output here, lightly edited if needed>

## Heading hierarchy

<list of slides + observed level sequence + flag>

## Color-only signal

<list of comparison/matrix slides flagged>

## Presentation distance

<assessment + which slides shrink to b-90 etc.>

## Motion

<flag any @keyframes / transitions, or "none found">

## Recommended next actions

1. **Replace link color #008787 with #2EB8B8** — passes AA at 4.6:1 (5 min).
2. **Add explicit ✓/✗ icons to compare-grid bullets in slides 6, 11, 14** — removes hue dependency for CVD viewers (15 min).
3. **Raise heading h2 on slide 4 to h1** — fixes hierarchy (1 min).
```

## What NOT to do

- **Don't edit the deck or theme.** Output recommendations. Theme palette changes ripple across every deck using that theme — the user owns that call.
- **Don't conflate "passes WCAG 2" with "looks good in dark mode".** APCA exists because WCAG 2 over-credits saturated colors against dark backgrounds. Report both.
- **Don't flag every CVD warning as HIGH.** A pure-decoration CVD-collapsed accent (e.g., the underline beneath a heading) is LOW. A CVD-collapsed *signal-bearing* color (the comparison column accent) is HIGH.
- **Don't recommend specific exotic colors as fixes.** Suggest a *target lightness* and tell the user to pick the nearest palette color. The script's `Suggested fix:` field gives a neutral-axis target; that's a floor, not a recommendation to actually use neutral gray.
- **Don't audit themes you don't have the path to.** Marp's `theme:` frontmatter directive can resolve to a global theme registered via `.marprc.yml`. If you can't read the CSS, say so and audit only the deck-level concerns (hierarchy, color-only signals).
- **Don't extrapolate from CSS to render.** The script reads colors from CSS but doesn't render. If a theme uses `text-shadow: 0 0 8px currentColor` (synthwave does), the *rendered* contrast is higher than CSS-pair contrast. Note this caveat for any glow-effect theme.

## Pitfalls

- **rgba() alpha-blending.** The script alpha-composites foreground tints over the slide background. But it does *not* composite over a *card tint background* — e.g., `--card-tint: rgba(255,255,255,0.04)` inside a `comparison` cell. For cards, manually do the composite and re-audit if a finding is borderline. (Concretely: a `comparison` body text pair is `body-color` over `card-tint blended over slide-bg`, not `body-color over slide-bg`.)
- **CSS imports.** Themes `@import 'default';` from Marp's default theme. Anything not overridden in the theme file falls back to Marp default (black text on white). The script doesn't follow imports — it reports what's *explicitly* defined. If a key pair is missing from the script output, the theme inherits Marp default for that selector; treat it as a separate finding.
- **`color: inherit` and `currentColor`.** The script treats these as unparseable and skips. That's intentional — they don't have a fixed contrast pair until resolved against an ancestor.
- **Heading hierarchy in Marp.** Slide separators (`---`) reset visual hierarchy but **not** the markdown's `#` semantics. A deck with 30 slides each starting with `#` produces 30 `h1`s — that's normal for Marp and not a hierarchy violation.
- **CVD matrices are approximations.** Brettel/Viénot is a widely-used dichromacy model; real-world CVD is anomalous trichromacy (partial cone loss) in most cases. The simulation is conservative — if it passes, real users very likely pass; if it fails, real users *might* still be OK. Don't promise 100% safety.
- **APCA is in draft.** WCAG 3 is not finalized. Treat APCA as advisory until W3C lands the spec. The Lc thresholds here match the v0.0.98G-4g constants used by `apca-w3` on npm.

## Quality checklist

Before declaring done:

1. **Script ran without errors and reported a non-empty pair list.** If the script returned an empty list, the theme is non-Marp or uses a CSS structure the extractor doesn't understand — fall back to a manual color audit instead.
2. **Report covers all seven scope items** (contrast, APCA, CVD, distance, hierarchy, color-only, motion). Even if a section is "no concerns," explicitly state it.
3. **HIGH findings have a concrete suggested fix** with a target color or specific markdown change.
4. **CVD findings distinguish text-readability from signal-encoding.** A cyan heading that's CVD-collapsed for trichromacy-vs-deuteranopia is fine (it's still high-contrast in luminance), but a cyan-vs-pink comparison column is a signal-encoding failure.
5. **Presentation-distance recommendation is venue-tagged.** "OK for conference rooms; borderline for auditoriums" beats "body text might be small."

## Script usage

```bash
# Text summary (quick scan):
node <skills-dir>/deck-a11y-audit/scripts/audit-theme.mjs <theme.css>

# Markdown report (for merging into the final audit):
node <skills-dir>/deck-a11y-audit/scripts/audit-theme.mjs <theme.css> --md
```

The script has no external dependencies — pure Node. It implements WCAG, APCA, and CVD inline (no `apca-w3` / `chroma-js` needed). If you find yourself wanting hsl()/lab()/named-color support beyond the tiny built-in set, swap in `culori` — but that's a future-pass improvement, not a current need for Marp themes (which use hex everywhere).
