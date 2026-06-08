# Marp starter themes

Five supported starter themes for the marp-slides skill. Each is self-contained: palette + layout structure merged into a single CSS file, no external dependencies (some themes import a Google Font).

All themes share the **var-based theming contract**: layouts and structure live in a common layout block driven by CSS custom properties; the palette section above the `═══ Layout classes` separator declares the vars that paint cards, tables, compare accents, etc. A deck written for one theme renders correctly under any other — only the frontmatter `theme:` line changes.

Some themes also ship a **layout variant** — an additional CSS rule appended after the layout block to give the theme a structural signature beyond color (e.g., uppercase section dividers, neon glow on hero stats). Variants override layout-block defaults via cascade order; the markdown contract is unchanged.

## Install

Pick the themes you want and copy them to your project's `.marp/` directory:

```bash
cp <skills-dir>/marp-slides/themes/dark.css .marp/
cp <skills-dir>/marp-slides/themes/light.css .marp/
# ...and any others you want available
```

Register them in `.marprc.yml` — **do not** set `theme:` at the config level (it overrides the per-deck frontmatter):

```yaml
themeSet:
  - .marp/dark.css
  - .marp/light.css
  - .marp/high-contrast.css
  - .marp/newspaper.css
  - .marp/synthwave.css
```

Frontmatter on every slide deck:

```markdown
---
marp: true
theme: dark   # or any registered theme slug
paginate: true
---
```

## Theme catalog

| Theme | Bg | Fg | Headline accent | Layout variant |
|---|---|---|---|---|
| `dark` | `#1E1E1E` | `#D0D0D0` | `#00AFFF` cyan | — (canonical) |
| `light` | `#FAFAFA` | `#1E1E1E` | `#0066CC` blue | — |
| `high-contrast` | `#000000` | `#FFFFFF` | `#FFFF00` yellow | bordered-box big-stat |
| `newspaper` | `#F4ECD8` | `#1A1A1A` | `#1A1A1A` black | serif font (Georgia) + uppercase rule on section-divider |
| `synthwave` † | `#1A0033` | `#F0F0FF` | `#FF10F0` pink | neon-glow text-shadow on headings + big-stat |

† **Synthwave a11y note:** the defining cyan (`#00FFFF`) + magenta (`#FF10F0`) accent pair collapses to indistinguishable yellow-grey under deuteranopia and protanopia simulation. The colors are kept as-is because they are the theme's identity. Recommend Synthwave for **stylistic / non-critical contexts** (covers, attract loops, decorative decks). For information-critical decks where the compare-A vs compare-B encoding must read for color-blind viewers, pick a CVD-safe theme such as `high-contrast` or `newspaper`.

## Layout variants

A theme that wants a structural signature beyond palette can append CSS at the very end of its file (after the layout block). The cascade puts these overrides last, so they win without modifying the shared layout block.

**Conventions:**
- Variants should target a single layout selector (e.g., `section.process-flow ol li::before`) — don't rewrite layout structure broadly.
- Variants must not break the markdown contract. The same `<!-- _class: process-flow -->` directive must still work; the variant only changes how it renders.
- If a variant fundamentally redesigns a layout (e.g., totally different process-flow shape), it should override `border-radius`, `clip-path`, `text-shadow`, etc. — not `display`, `flex-direction`, or positioning rules.

## Creating a new theme

1. Pick a scaffold by background brightness:
   - Dark bg → start from `dark.css`
   - Light bg → start from `light.css`
2. Copy: `cp themes/dark.css themes/<your-slug>.css`
3. Change the `@theme` directive (line 1) — must be unique across all registered themes
4. Replace palette colors slot-by-slot. The key var declarations on `section { ... }` are:
   - `--card-tint` — fill for `.compare-grid > div` and `.matrix > div`
   - `--table-row-bg` / `--table-row-alt-bg` — table cell backgrounds
   - `--compare-a-accent` / `--compare-a-tint` / `--compare-b-accent` / `--compare-b-tint` — comparison/compare-detail column accents
5. Optionally append a layout variant CSS rule at the very end of the file.
6. Smoke-test by rendering an existing deck against your theme.
