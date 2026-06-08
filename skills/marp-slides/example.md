---
marp: true
theme: dark
paginate: true
---

<!-- _class: title-cover -->

# Marp Layout Reference

**One slide per layout class**

A visual catalog for the marp-slides skill

---

<!-- _class: section-divider -->

## Part 1: Foundation Layouts

---

## Default Bullet List

Ideal for 3–6 short parallel items.

- Item one — keep it under 12 words
- Item two
- Item three
- Item four

---

<!-- _class: two-col-list -->

## Two-Column List

When parallel items run 7–10:

1. First item
2. Second item
3. Third item
4. Fourth item
5. Fifth item
6. Sixth item
7. Seventh item
8. Eighth item

---

<!-- _class: prose-with-tldr -->

## Heavy Text Done Right

> **TL;DR:** Don't bullet-ify dense prose — extract a one-sentence claim as the kicker, keep the original paragraph below.

A 150-word paragraph distilled into 5 bullets loses the connective reasoning. The slide looks generic and any reader who knows the source material can tell it was AI-converted. The TL;DR pattern preserves the author's argument while adding a scannable entry point — Duarte's slidedoc model adapted for projection. Cap a single slide at ~180 words; split if longer.

---

<!-- _class: section-divider -->

## Part 2: Comparison Layouts

---

<!-- _class: comparison -->

## Option A vs. Option B

<div class="compare-grid">
<div>

**Option A**
- Strength one
- Strength two
- Tradeoff to know

</div>
<div>

**Option B**
- Strength one
- Strength two
- Tradeoff to know

</div>
</div>

---

<!-- _class: matrix-2x2 -->

## Decision Matrix

<div class="matrix">
<div><strong>High Impact / Low Effort</strong><br>Do first</div>
<div><strong>High Impact / High Effort</strong><br>Plan carefully</div>
<div><strong>Low Impact / Low Effort</strong><br>Do if time</div>
<div><strong>Low Impact / High Effort</strong><br>Skip</div>
</div>

---

## Default Table

| Plan | Price | Best for |
|---|---|---|
| Starter | Free | Trying it out |
| Pro | $12 / mo | Daily use |
| Team | $40 / mo | Small teams |

Cap at ~6 rows per slide.

---

<!-- _class: section-divider -->

## Part 3: Emphasis Layouts

---

<!-- _class: big-stat-hero -->

## One Number, Center Stage

<div class="stat">73%</div>

Of an audience recalls a single bold figure far longer than a bulleted list

---

<!-- _class: pull-quote -->

> A slide should land its one point before you finish saying it. If the audience has to stop and read, you have already lost them.

— a presentation-design maxim

---

<!-- _class: section-divider -->

## Part 4: Sequential & Visual

---

<!-- _class: process-flow -->

## From Draft to Deck

1. Write the content as plain markdown
2. Pick a layout for each section
3. Run auto-fit to size the text
4. Render the deck with Marp

---

<!-- _class: image-led -->

## Let the Visual Lead

![a slide where one image carries the message](placeholder.png)

One strong image and a caption under 30 words, for when a picture does the work

---

<!-- _class: code-showcase -->

## Marp Config Pattern

```yaml
themeSet:
  - .marp/your-theme.css
  - .marp/your-theme-light.css
```

Registers available themes; each deck chooses one with its frontmatter `theme:` key.
