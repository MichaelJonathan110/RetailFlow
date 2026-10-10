# RetailFlow — Design Law

**Direction:** Colourful Neo-Brutalism, palette sampled from the Tuckii reference pin
(`https://pin.it/5V7teaHUJ`). Bold colour blocks, 2px ink borders, hard offset shadow,
zero gradients. High contrast, honest data, no decoration without a job.

## Palette (sampled from the reference image, not invented)

| Token | Hex | Job it does |
|---|---|---|
| `--rf-bg` paper | `#FEFBF7` | canvas; keeps colour blocks loud |
| `--rf-ink` / `--rf-border` | `#0E0D0F` | text + every 2px border + shadow |
| `--rf-yellow` | `#FED01A` | **primary signal** — actions, active nav, attention |
| `--rf-peri` periwinkle | `#7B6FC9` | **secondary signal** — data / volume / flow |
| `--rf-mauve` | `#A15584` | **tertiary signal** — quality, risk, quarantined |
| `--rf-cream` | `#EAE3C1` | soft fill — headers, quiet panels |
| `--rf-khaki` | `#BEAF7E` | soft fill alt — table headers, toolbars |

Why multi-colour here and not a single accent: this is a data console where the blocks are
**status channels** — revenue, pipeline, quality read as different colours on purpose, so a
scan finds the risk block before reading a label. Each colour has one job (above), so the
palette is a system, not a scatter. The pin's own yellow/periwinkle/mauve trio is the source.

## Geometry (unchanged)
- Radius set: `0 / 2 / 4px` only. Borders: `2px solid var(--rf-border)`.
- ONE elevation rule: hard offset shadow `4px 4px 0 #0E0D0F` (`--rf-shadow-pop`), written once, reused.
- Mono + tabular figures for every number (`--rf-mono`, `rf-num`).

## Components
- **KPI cards** rotate the four signal colours across the row (yellow / periwinkle / mauve / cream).
- **Buttons** yellow primary (ink text), cream secondary; hover inverts to ink.
- **Panels/cards** paper body, cream header band, ink border + hard shadow.
- **Tables** khaki header band, zebra rows, ink rules, wrapped in a bordered box.
- **Badges** yellow by default, periwinkle for ok, mauve for danger/error.
- **Nav** active item is a solid yellow block (marks real state).
- **Segmented range picker** active segment is yellow.
- **Insights** mauve mark + paper body.

## Motion — dial 2
Hover and press only. No endless loops, no scroll-jank, no parallax. `rf-rise`/`rf-stagger`
stay as the single entrance gesture.

## Anti-slop checklist
- Palette from the reference (sampled), not the default blue-purple gradient set. ✅
- One accent per meaning; colours are status channels, not page-wide decoration. ✅
- No decorative emoji in UI copy. ✅
- No glass, no glow, no gradient, no blurred orbs. ✅
- Shadow is a single documented elevation rule, not on every element. ✅
- Motion follows dial 2; nothing animates on a loop. ✅
- Radius is a small deliberate set (0/2/4), not uniform pills. ✅

## Why this is not slop
Colour is doing an informational job: each block's hue maps to a metric family, and the
geometry (2px ink, hard shadow, mono figures) is one coherent system across all 14 routes.
Nothing here is a template shape wearing a colour; the colour is the data.
