# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Rust Wipe Hub
**Generated:** 2026-07-01 (auto) — **Reconciled:** 2026-07-01 (manual)
**Category:** Gaming / Survival companion tool

> **Reconciliation note:** The auto-generated system recommended a neon-purple
> palette and a "Newsletter / Content First" page pattern. Both conflict with the
> explicit product brief (Rust: dark, industrial, metal/rust, orange-red accent;
> multi-tab content-dense tool — not a newsletter). Per the ui-ux-pro-max color
> DB, the palette below is the **"Operation orange on dark"** result (warm
> charcoal + rust orange), which matches the brief. Typography (Orbitron /
> JetBrains Mono — "tactical, hud, sci-fi, dark") and the 3D / Three.js direction
> are kept from the auto-generated system.

---

## Global Rules

### Color Palette

Warm-charcoal industrial base + rust/fire accents. **Use tokens only — no raw hex in markup.**

| Role | Hex | CSS Variable | Notes |
|------|-----|--------------|-------|
| Primary (rust orange) | `#EA580C` | `--color-primary` | Buttons, active nav, headings accent |
| Primary Hover | `#C2410C` | `--color-primary-hover` | Darker rust |
| On Primary | `#FFFFFF` | `--color-on-primary` | Text on primary |
| Secondary (ember) | `#F97316` | `--color-secondary` | Highlights, secondary accents |
| Accent / Danger CTA (fire red) | `#DC2626` | `--color-accent` | Raid/wipe/danger emphasis |
| Background | `#1C1917` | `--color-bg` | Warm near-black (stone-900-ish) |
| Surface / Card | `#262321` | `--color-surface` | Cards, panels |
| Surface Raised | `#2E2A27` | `--color-surface-2` | Hover / nested panels |
| Foreground | `#F5F5F4` | `--color-fg` | Primary text (contrast ~15:1) |
| Muted BG | `#2C1E16` | `--color-muted` | Subtle warm fill |
| Muted Foreground | `#A8A29E` | `--color-fg-muted` | Secondary text (contrast ~5:1) |
| Border | `#44403C` | `--color-border` | Visible in dark (stone-700) |
| Ring (focus) | `#F97316` | `--color-ring` | Focus outline (bright, 3:1+) |
| Destructive | `#DC2626` | `--color-destructive` | Errors |

**Semantic status / tier colors** (game data — meaning must NOT rely on color alone; always pair with text/icon):

| Meaning | Hex | CSS Variable |
|---------|-----|--------------|
| Safe / green card / tier 1 | `#22C55E` | `--color-tier-green` |
| Blue card / tier 2 | `#3B82F6` | `--color-tier-blue` |
| Red card / tier 3 / high radiation | `#EF4444` | `--color-tier-red` |
| Safe zone / neutral | `#A8A29E` | `--color-tier-safe` |

**Color Notes:** Operation orange on warm dark. Rust/metal/ember feel.

### Typography

- **Heading / Display Font:** Orbitron (700, 900) — tactical HUD, sci-fi
- **Body / Data Font:** JetBrains Mono (400, 500) — mono suits timers, tables, stats
- **Mood:** tactical, hud, sci-fi, dark, industrial
- **Numbers:** use tabular figures (mono already tabular) for timers & data columns

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Orbitron:wght@700;900&display=swap');
```

Type scale (rem): `0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 / 3`. Body base 16px, line-height 1.6.

### Spacing Variables (4/8px rhythm)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | Tight gaps |
| `--space-sm` | `8px` | Icon gaps, inline |
| `--space-md` | `16px` | Standard padding |
| `--space-lg` | `24px` | Section padding |
| `--space-xl` | `32px` | Large gaps |
| `--space-2xl` | `48px` | Section margins |
| `--space-3xl` | `64px` | Hero padding |

Radius: `--radius-sm 6px`, `--radius-md 10px`, `--radius-lg 16px`.

### Shadow Depths (dark-tuned, deeper alpha)

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.4)` | Subtle lift |
| `--shadow-md` | `0 4px 10px rgba(0,0,0,0.5)` | Cards, buttons |
| `--shadow-lg` | `0 12px 28px rgba(0,0,0,0.6)` | Modals, dropdowns |
| `--shadow-glow` | `0 0 0 1px rgba(234,88,12,0.4), 0 8px 24px rgba(234,88,12,0.15)` | Active/hero rust glow |

---

## Component Specs (token-driven)

### Buttons
```css
.btn-primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
  padding: 12px 24px;
  border-radius: var(--radius-md);
  font-weight: 700;
  transition: background 200ms ease, box-shadow 200ms ease;
  cursor: pointer;
}
.btn-primary:hover { background: var(--color-primary-hover); box-shadow: var(--shadow-glow); }
.btn-primary:focus-visible { outline: 3px solid var(--color-ring); outline-offset: 2px; }
```

### Cards
```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  box-shadow: var(--shadow-md);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-lg); }
```

### Inputs
```css
.input {
  background: var(--color-muted);
  color: var(--color-fg);
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 16px; /* avoids iOS auto-zoom */
}
.input:focus-visible { border-color: var(--color-primary); outline: none; box-shadow: 0 0 0 3px var(--color-ring); }
```

---

## Style Guidelines

**Style:** Industrial / 3D accents (kept from auto system, tuned dark)

**Keywords:** metal, rust, ember, tactical HUD, depth, riveted panels, warm dark

**Key Effects:** Three.js 3D island map, subtle layered shadows, rust glow on active
elements, smooth transitions (150–300ms). Respect `prefers-reduced-motion`.

### Page Pattern (replaces auto "Newsletter")

**Pattern Name:** Content-dense tabbed tool hub

- **Navigation:** Persistent top tab bar (5 tabs), active tab highlighted with rust
  color + underline indicator; SPA section switching, no reload; deep-link via `#hash`.
- **Home hero:** Live wipe countdown as the focal element (large tabular timer).
- **Data pages:** Card grids + data tables, filters where useful.
- **Section order (Home):** 1. Countdown hero, 2. Next-wipe details (local + UTC),
  3. Upcoming wipes table.

---

## Anti-Patterns (Do NOT Use)

- ❌ Neon purple / rose (off-brief — this is Rust: rust-orange + fire-red)
- ❌ Newsletter/email-capture framing (this is a tool, not a newsletter)
- ❌ Emojis as icons — use inline SVG (Lucide/Heroicons style)
- ❌ Missing `cursor:pointer` on clickable elements
- ❌ Layout-shifting hovers (animate color/shadow/opacity/transform, not width/height)
- ❌ Low contrast text (< 4.5:1 body)
- ❌ Instant state changes (always 150–300ms transitions)
- ❌ Invisible focus states
- ❌ Conveying tier/radiation by color alone (always add text/icon)

---

## Pre-Delivery Checklist

- [ ] No emojis used as icons (inline SVG instead)
- [ ] Consistent icon set (Lucide-style stroke 2px)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Text contrast 4.5:1 minimum (verified on `#1C1917` bg)
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected (timer + Three.js)
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbar (scroll padding)
- [ ] No horizontal scroll on mobile; tables scroll within container
- [ ] Timer/data use tabular figures (no layout shift per tick)
- [ ] Tier/radiation info paired with text label, not color-only
