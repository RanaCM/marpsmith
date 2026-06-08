# marp-slides verification scripts

Three scripts that run during deck generation:

- **`lint-deck.mjs`** — fast, render-free pre-flight linter. Parses the markdown and flags layout-shape and structural issues before any expensive render step. No Puppeteer required.
- **`auto-fit.mjs`** — measures rendered geometry in headless Chrome, picks the smallest discrete body scale class that fits, writes it back into the markdown. Flags slides that can't fit at the body floor for splitting.
- **`check-slides.mjs`** — sanity backstop in headless Chrome. Emits a JSON report of remaining geometric issues (overflow, header collision, asymmetric columns, etc.).

## Install (once)

```bash
cd <skills-dir>/marp-slides/scripts
npm install
```

This installs Puppeteer with its bundled Chromium (~300 MB). To save space, swap `puppeteer` for `puppeteer-core` in `package.json` and the scripts will auto-detect system Chrome at the standard macOS / Linux paths.

`lint-deck.mjs` requires **no dependencies** — runs on bare Node 18+.

---

## lint-deck.mjs

Pre-flight markdown linter. Runs **before** auto-fit. Catches issues that don't require a browser render — usually in under 100 ms on a 50-slide deck.

```bash
# Default: colorized human-readable summary (uses ANSI if stdout is a TTY)
node lint-deck.mjs path/to/deck.md

# Machine-readable JSON
node lint-deck.mjs path/to/deck.md --json

# CI gate: filter findings (and exit code) to HIGH severity only
node lint-deck.mjs path/to/deck.md --severity high
```

Flags:
- `--severity high|med|low` — minimum severity to report (default: `low`, i.e. everything)
- `--json` — machine-readable output

Exit codes: `0` = clean at the chosen threshold; `1` = findings present; `2` = script error.

### Checks

| Rule | Severity | What it flags |
|---|---|---|
| `frontmatter-missing` | HIGH | No YAML frontmatter |
| `frontmatter-no-marp` | HIGH | Frontmatter missing `marp: true` |
| `frontmatter-no-theme` | HIGH | Frontmatter missing `theme: <name>` |
| `duplicate-class-directive` | HIGH | Multiple `<!-- _class: ... -->` on a single slide |
| `layout-repetition` | MED | Same `_class:` on 4+ consecutive slides |
| `asymmetric-comparison` | MED | `comparison` columns with word ratio > 3:1 |
| `heading-wrap-risk` | MED | Heading > 60 chars (content) or > 40 chars (cover-like) |
| `bullet-list-too-many` | MED | Default bullet slide with > 6 items |
| `two-col-list-too-many` | MED | `two-col-list` with > 10 items |
| `table-too-many-rows` | MED | Table with > 6 data rows |
| `sparse-prose` | LOW | `prose` slide with < 30 body words and no TL;DR |
| `pull-quote-no-attribution` | LOW | `pull-quote` missing trailing `— Attribution` |
| `process-flow-no-verbs` | LOW | `process-flow` with < 50% verb/temporal cued items |

### JSON output schema

```json
{
  "deck": "/abs/path/deck.md",
  "slide_count": 27,
  "summary": { "high": 0, "med": 2, "low": 3 },
  "findings": [
    {
      "severity": "med",
      "rule": "layout-repetition",
      "slides": [12, 13, 14, 15],
      "message": "4 consecutive prose slides — consider reshape or section-divider break (Cross-deck variety rule)"
    }
  ]
}
```

Findings with `slides: []` are deck-level (e.g., frontmatter rules).

---

## auto-fit.mjs

```bash
# Dry run: emit JSON report, no writes.
node auto-fit.mjs path/to/deck.md --theme path/to/theme.css

# Apply: rewrite markdown with recommended classes; surface splits to stderr.
node auto-fit.mjs path/to/deck.md --theme path/to/theme.css --apply
```

Flags:
- `--theme path/to/theme.css` — register a local CSS theme file with Marp's `themeSet` so deck frontmatter remains authoritative
- `--theme theme-name` — use Marp's named theme override
- `--config path/to/.marprc.yml` — use a specific marp config
- `--viewport WxH` — defaults to `1280x720` (Marp 16:9)
- `--apply` — rewrite the markdown source in place (default is dry-run)

### How it works (per slide)

1. Force the rendered section to native dimensions (1280×720 by default).
2. Strip any prior `b-XX` class from the section (idempotent).
3. **Body fit.** If non-heading content overflows the section's content area, probe `[0.95, 0.9]`. If 0.9 still overflows, emit a split recommendation and reset the body scale.
4. **Headings are never scaled.** If a heading wraps to multiple lines, the agent must shorten the heading text rather than apply a font-size class. The script never writes `h-XX` classes back into the markdown.
5. Emit a per-slide decision record. In `--apply` mode, rewrite the `_class` directive in the markdown source.

### Discrete steps

| Scope | Steps | Floor behavior |
|---|---|---|
| Body (`b-XX`) | 1.00, 0.95, 0.90 | Below 0.90 → split |

Below `b-90` the script splits the slide instead of shrinking further. The body floor is a deliberate readability guarantee.

### Output

```json
{
  "deck": "/abs/path/deck.md",
  "viewport": { "w": 1280, "h": 720 },
  "mode": "apply",
  "slide_count": 89,
  "summary": { "rescale": 23, "splits": 0, "no_change": 66 },
  "decisions": [
    {
      "index": 60,
      "previous_scale_classes": [],
      "action": "rescale",
      "h_scale": 1,
      "b_scale": 0.9,
      "recommended": ["b-90"],
      "evidence": { "h_lines_at_1": 1, "overflow_at_1": 12 },
      "cover_like": false
    }
  ]
}
```

`action` values:
- `rescale` — fits at the recommended `h-XX` / `b-XX` classes.
- `split-list-midpoint` — pure single-list slide (≥4 items); split items at midpoint.
- `split-paragraph-midpoint` — multi-paragraph prose only; split at paragraph midpoint.
- `split-table-midpoint` — single-table slide (≥4 data rows); split rows at midpoint, repeat the header row.
- `split-comparison-detail` — overflowing `comparison` slide; condense the original to a side-by-side overview, then add `compare-detail-a` (cyan) and `compare-detail-b` (pink) detail slides.
- `split-restructure` — mixed content not matching any pattern above; content judgment required.

`--apply` only auto-edits `rescale` actions. `split-*` actions are listed on stderr for the agent to handle. Exit code is `1` if any split recommendations remain, `0` otherwise.

### Idempotency

Re-running `--apply` on the same deck is safe: the script strips any existing `h-XX` / `b-XX` from each section's class list before computing fresh values. After content edits, just re-run.

---

## check-slides.mjs

Backstop sanity check. Run after `auto-fit.mjs --apply` and any manual splits to confirm nothing's left unfit.

```bash
node check-slides.mjs path/to/deck.md --theme path/to/theme.css
```

Same flags as `auto-fit.mjs`. Exit code `1` if any HIGH-severity issue is found, `0` otherwise.

### Output

```json
{
  "deck": "/abs/path/deck.md",
  "viewport": { "w": 1280, "h": 720 },
  "slide_count": 89,
  "slides": [
    {
      "index": 12,
      "class": "prose-with-tldr b-90",
      "issues": [
        {
          "type": "vertical-overflow",
          "severity": "high",
          "evidence": { "overflow_px": 18 },
          "suggested_fix": "run auto-fit.mjs (recomputes b-XX or recommends split)"
        }
      ]
    }
  ],
  "summary": { "high": 0, "med": 0, "low": 0 }
}
```

Only slides with at least one issue appear in `slides[]`. A clean deck returns an empty array.

### Issue types

| Type | Severity | Meaning |
|---|---|---|
| `vertical-overflow` | high | Body content extends past the slide's bottom edge |
| `horizontal-overflow` | high | Content extends past the slide's right edge |
| `header-collision` | high | Absolutely-positioned heading overlaps body content (rare with current flow-based heading layout) |
| `heading-orphan-word` | low | Heading wraps to ≥3 lines with a short last line |
| `heading-too-long` | med | Heading wraps to 3+ lines on a non-cover layout |
| `near-overflow` | med | Last content element sits within 4% of the slide's bottom edge |
| `sparse` | low | Content uses <40% of slide height (cover-like layouts excluded) |
| `asymmetric-columns` | low | One column in `comparison`/`matrix` is >1.6× taller than the other |
| `image-too-tall` | med | An `<img>` exceeds 70% of slide height |
| `code-too-tall` | med | A `<pre>` exceeds 70% of slide height |

### Important: Marp clips its sections

Marp's `<section>` has `overflow: hidden`, so `scrollHeight === clientHeight` even when content overflows. `check-slides.mjs` detects overflow by walking children and comparing each child's bounding-rect bottom to the section's bottom — `getBoundingClientRect()` returns the layout rect, not the clipped one. Naive scroll-height checks will silently return false negatives.

---

## How the agent uses these

The marp-slides skill workflow runs these in order after generating a deck:

1. `lint-deck.mjs` — fast pre-flight check; fix HIGH/MED findings in source.
2. `auto-fit.mjs --apply` — sets scale classes, surfaces splits.
3. Agent applies any `split-*` recommendations by editing the markdown.
4. `auto-fit.mjs --apply` again — assigns scale classes to the new halves.
5. `check-slides.mjs` — backstop.

See `<skills-dir>/marp-slides/SKILL.md` for the full loop.
