# Frontend design plan — sqld/admin

**Direction:** Record Bench  
**Status:** Implemented and verified (Phase 4 complete)  
**Scope:** `public/index.html`, `public/style.css`, `public/app.js`, plus a small static-asset route in `server.js` for a self-hosted font.  
**Out of scope:** API changes, new data-editing features, a build step, a component framework, a theme switcher, SQL syntax highlighting.

---

## 1. The brief

`sqld/admin` is a self-hosted operator console for a libSQL `sqld` server running in namespace mode. Its users are developers and operators who are already close to the server: they use it to find a database, inspect its tables and rows, check a schema, run a statement, and perform lifecycle actions such as rename, duplicate, delete, and drop.

The interface has one job: **make a record set easy to read and act on without getting in the way**.

Constraints that matter for the design:

- Vanilla HTML, CSS, and JavaScript. No framework, bundler, or compile step.
- `Content-Security-Policy: default-src 'self'` — no CDN fonts, no external assets, no inline styles or scripts.
- The static server currently allowlists only `/`, `/app.js`, and `/style.css`; adding a font means extending that allowlist.
- All user data is rendered with `textContent`. That safety property must not change.
- Light and dark mode via `prefers-color-scheme`.
- Must work at 390 px wide and at 200% zoom.

Non-goals: a database browser with inline row editing, a query builder, a schema diagram, a marketing-style landing page, or decorative dashboard metrics.

---

## 2. What the current UI gets wrong

The current screen is functional but reads as an early scaffold. The problems are structural, not just cosmetic.

| Issue | Why it matters |
| --- | --- |
| System UI font everywhere, default browser buttons for row actions, generic Bootstrap-like blue/grey/red | The app has no identity and no visual hierarchy. It looks like unstyled CRUD. |
| `.btn-small` has no background or border, so Open / Rename / Duplicate render as inconsistent browser default buttons | Actions look unfinished and their priority is unclear. |
| Destructive actions are solid red on every row | Alarm fatigue. Delete and Drop compete with the primary work instead of sitting quietly until needed. |
| Page title and app title are both large; back buttons float below headings | Orientation is weak. The user has to reconstruct where they are from the page contents. |
| Tables have no sticky header, no row numbers, no numeric alignment, and no column types | Wide tables lose their context while scrolling. Numbers are harder to compare. |
| Wide tables scroll the whole page rather than a contained grid | The toolbar and pagination disappear; the page feels broken at laptop widths. |
| Dialogs are plain forms with placeholder-only labels in the new-table column rows | Accessibility and scanability suffer, especially for the most complex form. |
| No pending states, no inline confirmation feedback, no loading states | Double submits are possible, and slow requests look like nothing happened. |
| Dark mode is partial: disabled buttons stay light grey, links and error banners are not re-tuned | Dark mode looks like an afterthought. |
| Error banner has no `role="alert"`, no dismiss control, and auto-hides quickly | Screen readers may miss it, and users cannot re-read a server error. |
| Empty states are italic placeholder text with no action | A dead end instead of an invitation to do the next thing. |
| No `:focus-visible` treatment, no table captions or `scope`, no `aria-current` | Keyboard and assistive-technology use is weaker than it should be. |

---

## 3. Design direction: Record Bench

**One sentence:** an operator's register, not a dashboard — ruled surfaces, dense records, petrol ink, and a single oxide accent reserved for destruction.

The data grid is the hero. There is no decorative hero panel, no oversized metric, no gradient wash, no card kit. On the Databases page the register itself is the first thing; on a table page the records are the first thing; in an empty state the next action is the first thing.

### Why this fits the subject

A database admin is a place where work happens. Its native materials are names, types, ordinals, rows, constraints, and byte counts. Those materials are already visually interesting when set with care. The design should expose their structure rather than wrap every screen in generic containers.

### Signature moves

1. **The record gutter.** Every data grid gets a left-hand row-number gutter, and every schema column gets its ordinal. These numbers are not decoration: they encode position in a record set and in a table definition, and they keep the user oriented across pages and wide horizontal scrolls.
2. **Rules, not cards.** Surfaces are separated by 1 px rules. There are no card shadows on lists or tables. The only elevation in the app is a modal dialog.
3. **One type family, two modes.** Recursive is used proportionally for language and in monospace mode for machine data. This gives the UI a coherent voice without a decorative font pairing.
4. **Petrol ink, oxide warning.** Deep petrol is used for primary actions, links, active tabs, and focus. Oxide red is used only for destructive actions and errors. Everything else is ink, muted text, and rules.
5. **The path line.** A monospaced breadcrumb (`Databases / my-db / users`) replaces floating back buttons and makes location part of the page header.

### Deliberately avoided

- Warm cream + high-contrast serif + terracotta: the most recognizable generated-design cluster, and the wrong mood for a server tool.
- Near-black + acid green: the second recognizable cluster, and tiring for dense tables.
- Rounded SaaS cards with identical radii and the same soft shadow on every surface.
- Tracked-out ALL-CAPS eyebrow labels and meta strings joined with middle dots.
- Numbered markers used as decoration. Numbers appear here only because row and column order are real information.
- Hover lifts, scattered fade-ins, and shimmer skeletons.

---

## 4. Design tokens

### 4.1 Color

The palette is a cool chalk-green canvas, deep petrol ink, and a restrained oxide red. Values are chosen for contrast, not for mood alone.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#EDF0EB` | `#0E1513` | Page canvas |
| `--surface` | `#FAFBF8` | `#151E1B` | Tables, dialogs, inputs |
| `--surface-2` | `#F4F6F2` | `#1B2622` | Hover rows, dialog footer, subtle fills |
| `--ink` | `#13201C` | `#E3EAE5` | Primary text |
| `--muted` | `#5A6862` | `#93A39B` | Secondary text, metadata |
| `--faint` | `#7C8982` | `#6F7E76` | Decorative marks, disabled text |
| `--line` | `#D2DAD4` | `#27332E` | Default rules and borders |
| `--line-strong` | `#AEB9B1` | `#3A4A43` | Input borders, header rules |
| `--accent` | `#0B5D56` | `#4FB3A4` | Primary actions, links, active tab |
| `--accent-hover` | `#084741` | `#6FC7BA` | Hover state for accent |
| `--accent-soft` | `#E3EFEA` | `#1D2E29` | PK chip, selected/active wash |
| `--on-accent` | `#FFFFFF` | `#08110F` | Text on accent |
| `--danger` | `#A83226` | `#E8A79E` | Destructive text, error text |
| `--danger-solid` | `#A83226` | `#B3453A` | Destructive confirm button |
| `--on-danger` | `#FFFFFF` | `#FFFFFF` | Text on destructive confirm |
| `--danger-soft` | `#FBEDEA` | `#2E1B18` | Error banner and danger hover |
| `--danger-line` | `#E7C4BE` | `#5A2E28` | Error banner border |
| `--warn` | `#7A5300` | `#E0B15A` | SQL warning text |
| `--warn-soft` | `#F6EEDB` | `#2A2416` | SQL warning background |
| `--warn-line` | `#E4D3A8` | `#4A3D22` | SQL warning rule |
| `--focus` | `#0B5D56` | `#6FC7BA` | Focus ring |

Contrast checks for the main light-mode pairs:

- `--accent` on `--surface`: **7.45:1**
- `--muted` on `--surface`: **5.63:1**
- `--danger` on `--surface`: **6.42:1**
- `--warn` on `--warn-soft`: **5.93:1**
- `--ink` on `--bg`: **14.60:1**

Dark mode:

- `--accent` on `--surface`: **8.56:1**
- `--muted` on `--surface`: **6.45:1**
- `--danger` on `--surface`: **8.47:1**
- `--on-danger` on `--danger-solid`: **5.48:1**
- `--ink` on `--bg`: **15.12:1**

Use `color-scheme: light dark` and a `meta` tag so native controls, scrollbars, and dialogs follow the chosen scheme.

### 4.2 Typography

**Family:** [Recursive](https://www.recursive.design/), a variable font with `MONO`, `CASL`, `wght`, and `slnt` axes. It is self-hosted under the SIL Open Font License.

Why one family: the app has two kinds of text — human language (labels, titles, help) and machine data (names, types, numbers, SQL). Recursive can be both without the usual "sans + mono" pairing looking like every developer tool. `CASL` stays at `0` for a neutral, workmanlike voice.

```css
:root {
  --font-ui: "Recursive", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Recursive", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  font-family: var(--font-ui);
  font-variation-settings: "MONO" 0, "CASL" 0;
}

.mono,
code,
kbd,
th,
.row-num,
.null-cell,
.blob-cell {
  font-family: var(--font-mono);
  font-variation-settings: "MONO" 1, "CASL" 0;
}
```

| Role | Size / line-height | Weight | Treatment |
| --- | --- | --- | --- |
| Wordmark | 15 / 1.2 | 650 | Mono mode, slash in accent |
| Page title (`h1`) | `clamp(24px, 3vw, 30px)` / 1.15 | 650 | Proportional, `-0.02em` tracking |
| Section title (`h2`) | 18 / 1.3 | 600 | Proportional |
| Dialog title | 18 / 1.25 | 650 | Proportional |
| Body | 14 / 1.5 | 400 | Proportional |
| Dense UI / table | 13 / 1.45 | 400–500 | Proportional |
| Meta / labels | 11–12 / 1.35 | 450 | Mono mode, `0.01em` tracking |
| Code / numbers | 12–13 / 1.55 | 400 | Mono mode, `font-variant-numeric: tabular-nums` |

Rules:

- Sentence case everywhere. No all-caps labels.
- No letter-spacing above `0.04em`.
- Body copy should stay under about 75 characters per line. Table content is exempt.
- Use tabular numerals for all numbers, counts, and row ordinals.
- The wordmark may use mono mode; it is a mark, not body text.

**Font delivery:** add `public/fonts/recursive-latin-var.woff2` and `public/fonts/OFL.txt`. Extend `server.js` to serve `/fonts/*.woff2` and `/fonts/OFL.txt` with the correct MIME type. Preload the font from `index.html`:

```html
<link rel="preload" href="/fonts/recursive-latin-var.woff2"
      as="font" type="font/woff2" crossorigin>
```

If binary assets are not acceptable, keep the entire design and let the fallback stacks take over. The layout must not depend on the font loading.

### 4.3 Space, size, shape

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --gutter: clamp(16px, 3vw, 32px);
  --content-max: 1440px;
  --measure: 68ch;
  --radius-control: 4px;
  --radius-dialog: 6px;
  --radius-chip: 2px;
  --shadow-dialog: 0 24px 64px rgba(8, 17, 15, 0.24);
}
```

- Base unit is 4 px; the layout uses an 8 px rhythm.
- Tables and list surfaces have no radius and no shadow.
- Controls use `4px`; dialogs use `6px`. Chips use `2px`.
- A 1 px rule is the default separator. A 2 px accent bar marks active navigation and tabs. A 3 px oxide left border marks errors and warnings.
- Only the dialog has elevation.

### 4.4 Motion

- `--ease: cubic-bezier(0.2, 0.7, 0.2, 1)`; control transitions are 120–160 ms.
- One page-load moment: the page content settles in with an 8 px rise and fade over 220 ms.
- Dialogs open with a 140 ms fade/rise; the backdrop fades.
- No hover transforms on rows or buttons. No per-section reveal animations.
- Skeletons are static, not shimmering.
- `@media (prefers-reduced-motion: reduce)` removes all non-essential animation and transition.

---

## 5. Layout

### 5.1 App shell

```
┌────────────────────────────────────────────────────────────────────────────┐
│  sqld/admin        Databases                                                │  masthead, 56px, sticky
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Databases / my-db                                    [New table] [SQL]     │  breadcrumb + page header
│  my-db                                                                     │
│  3 tables                                                                  │
│                                                                            │
│  Name                                             Actions                  │  register header
│  ────────────────────────────────────────────────────────────────────────  │
│  users                                            Open  Rename  Drop        │
│  sessions                                         Open  Rename  Drop        │
│                                                                            │
│  1–25 of 1,204 rows                                    [Previous] [Next]   │  table footer
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

- `main` is centered with `max-width: var(--content-max)` and `padding-inline: var(--gutter)`.
- The masthead is sticky, with a bottom rule. It never carries page actions; those live in the page header.
- The page header is a two-column grid: heading block on the left, actions on the right, aligned to the bottom of the heading block.
- No back buttons. The breadcrumb is the way back.
- Content alignment is left-aligned throughout. Nothing is centered except dialog contents.

### 5.2 Databases and Tables pages

Use the same register pattern for both:

```
breadcrumb
H1: Databases
meta: 4 databases                                      [New database] [Add existing]
─────────────────────────────────────────────────────────────────────────────────
Name                                                    Actions
─────────────────────────────────────────────────────────────────────────────────
analytics                                               Open  Rename  Duplicate  Delete
manager-registry                                        Open  Rename  Duplicate  Delete
─────────────────────────────────────────────────────────────────────────────────
```

- The database/table name is a real link (`href="#/db/..."`), so middle-click and copy-link work.
- Name column fills remaining width; actions column is `width: 1%`, no-wrap, right-aligned.
- Actions are ghost buttons. Delete/Drop is a danger-ghost button: quiet by default, clearly red on hover.
- Empty state replaces the table body with a short invitation and the primary action.

### 5.3 Table view

```
breadcrumb
H1: users                                               1,204 rows
[Data] [Schema]
─────────────────────────────────────────────────────────────────────────────────
Rows [25 ▾]
┌────┬──────────────┬──────────────────────┬──────────────────────┐
│  # │ id           │ email                │ created_at           │   sticky header
│    │ INTEGER      │ TEXT                 │ TEXT                 │
├────┼──────────────┼──────────────────────┼──────────────────────┤
│  1 │          101 │ ada@example.com      │ 2026-01-14 09:12:03  │
│  2 │          102 │ lin@example.com      │ 2026-01-14 09:14:55  │
│  3 │       NULL   │ grace@example.com     │ 2026-01-14 09:15:10  │
└────┴──────────────┴──────────────────────┴──────────────────────┘
1–25 of 1,204 rows                                          [Previous] [Next]
```

- The data grid scrolls horizontally inside its frame, never the page.
- The row-number gutter is sticky left. The header is sticky top. The gutter has a right rule, which makes the register structure visible even during horizontal scroll.
- Column headers show the column name and, underneath, its SQLite type in small mono type. The type is real schema data, not a label.
- Numeric columns are right-aligned and use mono/tabular numerals. Text stays proportional and left-aligned.
- `NULL` is rendered as a quiet mono token, not italic prose. Blobs render as a compact chip: `blob 128 B`.

### 5.4 SQL console

```
breadcrumb
H1: SQL console

┌─ Careful ──────────────────────────────────────────────────────────────────┐
│ SQL runs as written. There is no confirmation and no undo.                 │
└────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────────┐
│ Query                                             Ctrl + Enter to run      │
│                                                                            │
│  SELECT * FROM users LIMIT 100;                                            │
│                                                                            │
│ Row limit [100]                                             [Run query]    │
└────────────────────────────────────────────────────────────────────────────┘
Results                                                              12 rows
┌────┬──────────────┬──────────────────────┐
│  # │ id           │ email                │
...
```

- The warning is a note block, not a banner with an emoji.
- The editor is a bordered code surface with a header bar and a footer toolbar. The textarea itself is borderless.
- The keyboard shortcut is shown because it already works.
- Results use the same grid component as table data, including the gutter.
- No fake syntax highlighting. A plain textarea is honest and works.

### 5.5 Dialogs

```
┌────────────────────────────────────────────────┐
│  Delete database                           [×] │
│                                                │
│  This permanently deletes "analytics" and      │
│  every table in it.                            │
│                                                │
│  Database name                                 │
│  [__________________________________]          │
│  Type "analytics" exactly.                     │
│                                                │
│                        [Cancel] [Delete database] │
└────────────────────────────────────────────────┘
```

- Dialog width `min(540px, calc(100vw - 32px))`; the new-table dialog gets `720px`.
- Header, body, footer. Footer has a top rule and a subtle `--surface-2` fill.
- A close button in the header, in addition to Escape and Cancel.
- Destructive dialogs add a danger note block and use a solid danger confirm button.
- The confirm button stays disabled until the typed name matches exactly. This replaces the current global error-banner mismatch message.
- On mobile, the dialog becomes full-width, `max-height: 90dvh`, and its body scrolls.

### 5.6 Mobile

At 390 px:

- Masthead stays one row if it fits; otherwise the nav drops below the wordmark.
- Page header becomes one column: breadcrumb, title, meta, actions.
- Actions wrap and stretch to available width; primary action stays first.
- Tables keep their minimum width and scroll horizontally. The sticky row gutter preserves orientation.
- Pagination footer stacks: range on one line, Previous/Next below.
- The new-table column rows become bordered groups with visible labels; no six-column squeeze.
- Dialog buttons become full-width, stacked with the primary action last.

---

## 6. Component specifications

### 6.1 Masthead

- Height 56 px, sticky at top, `background: var(--surface)`, bottom 1 px `--line`, z-index 20.
- Wordmark: `sqld/admin`, 15 px mono 650. `sqld` in ink; `/` in accent; `admin` in muted. Hover turns the whole mark ink. No underline.
- Nav: one link, `Databases`, 13 px/500 muted. Active state uses ink text and a 2 px accent underline. `aria-current="page"` on the active section.
- Right side intentionally empty. No fake connection dot, uptime chip, or user avatar.

### 6.2 Breadcrumb and page header

- Breadcrumb: `<nav aria-label="Breadcrumb"><ol>…</ol></nav>`, 12 px mono, muted. Separator is `/` in `--line-strong` with `8px` horizontal space.
- Current crumb is ink and not a link. Ancestors are links.
- Long names truncate at `24ch` with a `title` attribute; the H1 wraps with `overflow-wrap: anywhere`.
- H1 is the page's primary identifier. On a table page, the H1 is `users`, not `my-db.users`; the database is already in the breadcrumb.
- Meta line is a single real fact: `4 databases`, `3 tables`, `1,204 rows`, or `my-db` for the SQL console. Do not concatenate facts with middle dots.
- Actions right-aligned, 8 px gap, wrap on narrow screens.

### 6.3 Buttons

Base:

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  font: 600 13px/1 var(--font-ui);
  cursor: pointer;
  transition: background-color 120ms var(--ease),
              border-color 120ms var(--ease),
              color 120ms var(--ease);
}
```

Variants:

| Variant | Default | Hover | Notes |
| --- | --- | --- | --- |
| `.btn-primary` | accent fill, on-accent text | accent-hover | One per page region |
| `.btn-secondary` | surface fill, line-strong border, ink | surface-2 fill, stronger border | Cancel, Previous/Next |
| `.btn-ghost` | transparent, muted text | surface-2 fill, ink text | Row actions, close |
| `.btn-danger` | transparent, danger text | danger-soft fill, danger border | Row Delete/Drop |
| `.btn-danger-solid` | danger-solid fill, white text | darker solid | Dialog confirm only |
| `.btn-sm` | 28 px min-height, 12 px font, 0 8 px padding | — | Row actions |

- Focus: `outline: 2px solid var(--focus); outline-offset: 2px;`
- Disabled: `opacity: .45; cursor: not-allowed;` — never override the background with grey.
- Coarse pointers: bump row actions to 40 px min-height.
- Never put two solid danger buttons in one view. Row-level destructive actions stay ghost.

### 6.4 Register lists

- Header labels: `Name`, `Actions`; 12 px/600 mono, ink, sentence case. No uppercase tracking. Row names stay proportional, so labels and data are distinguishable at a glance.
- Row height 44 px; 1 px `--line` bottom border; hover `--surface-2`; focus-within gets a subtle accent-soft wash.
- Name is a 14 px/550 link. Hover adds an accent underline with 3 px offset.
- Action group: `display: flex; justify-content: flex-end; gap: 2px;`.
- Header and rows share the same horizontal padding (`12px`), so columns line up.
- Table `caption` is visually hidden and names the collection.

### 6.5 Data grid

Structure:

```html
<div class="table-frame">
  <div class="table-toolbar">
    <label class="select-label">Rows
      <select class="page-size-select">…</select>
    </label>
  </div>
  <div class="table-scroll" role="region" aria-label="Table data" tabindex="0">
    <table class="data-table">
      <caption class="sr-only">Rows 1–25 of 1,204</caption>
      <thead>…</thead>
      <tbody>…</tbody>
    </table>
  </div>
  <div class="table-footer">
    <span class="range">1–25 of 1,204</span>
    <div class="pagination-nav">…</div>
  </div>
</div>
```

- `.table-scroll { max-height: min(70vh, 720px); overflow: auto; overscroll-behavior: contain; }`
- `border-collapse: separate; border-spacing: 0;` so sticky cells keep their background.
- Header: sticky top, `background: var(--surface)`, `box-shadow: inset 0 -1px 0 var(--line-strong)`.
- Row gutter: 48 px wide, sticky left, mono 11 px, muted, right-aligned, `border-right: 1px solid var(--line)`. The corner header is sticky in both axes and has a higher z-index.
- Header cell: name 12 px/600 mono ink; type line 10 px mono muted, `margin-top: 2px`.
- Body cell: 9 px 12 px padding, 13 px, 1.45 line-height, `border-bottom: 1px solid var(--line)`.
- Numeric cell: right-aligned, mono 12 px, tabular numerals.
- Long text: `max-width: 60ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` with the full value in `title`.
- `NULL`: mono 10 px, muted, `opacity: .85`.
- Blob: mono 10 px chip with a 1 px line border, 2 px radius, 1 px 5 px padding, muted text.
- Empty table: one `.empty-state` inside the frame; no fake rows.
- Horizontal scrollbar should be visible on hover/focus and usable by keyboard (`tabindex="0"` on the scroll region).

### 6.6 Schema tab

- Section header: `Table schema` (h2) and `Add column` primary button.
- Table columns: `#` (40 px), `Column`, `Type`, `Constraints`, `Default`.
- Ordinals `01`, `02`, … are meaningful and use mono, muted.
- Type is 11 px mono. Constraints are compact chips:
  - `PK`: accent-soft background, accent text, 2 px radius.
  - `NOT NULL`: surface-2 background, line border, muted text.
- Default value is 12 px mono; empty default is an em dash in faint, or blank. Prefer blank to avoid inventing a value.
- No per-column action menu, because the API does not support column rename/drop. Do not imply affordances that do not exist.

### 6.7 Tabs

- `role="tablist"` on the container; `role="tab"`, `aria-selected`, `aria-controls`, and `tabindex` on the buttons; `role="tabpanel"` on the panels.
- Underline style: 1 px line under the tablist; active tab gets a 2 px accent underline that overlaps it.
- Tab labels 13 px/600, muted; active ink.
- Arrow keys move between tabs; Home/End jump to first/last. Panel has `tabindex="0"` so keyboard users can scroll it.

### 6.8 Pagination

- Page size lives in the toolbar above the grid: label `Rows`, select with `25`, `50`, `100`.
- Footer: range left (`1–25 of 1,204`), Previous/Next right.
- Range is 12 px mono muted with tabular numerals.
- Previous/Next are secondary small buttons; disabled state uses opacity only.
- Do not show page numbers for three or fewer pages; Previous/Next is enough.

### 6.9 Forms and dialogs

- Field structure:

```html
<div class="field">
  <label for="...">Database name</label>
  <input id="..." ...>
  <p class="field-hint">Lowercase letters, numbers, and hyphens. Up to 63 characters.</p>
</div>
```

- Labels 12 px/600 ink; hints 11 px muted; error 11 px danger.
- Inputs/selects: 36 px min-height, 1 px `--line-strong`, 4 px radius, surface background, 13 px text, 8 px 10 px padding. Focus uses the global focus ring.
- Required fields use the native `required` attribute; do not add a red asterisk.
- Checkboxes use `accent-color: var(--accent);` and are inline with their labels.
- New-table column rows use a grid on desktop:

```
Name          Type      PK   Not null   Default        remove
[__________]  [TEXT ▾]  [ ]  [ ]        [__________]   [×]
```

- On mobile, each column row becomes a bordered group. Each input gets a visible label or an `aria-label`; placeholders are not labels.
- Default value hint: `SQL literal: 'active', 0, or CURRENT_TIMESTAMP.` This matches how the existing new-table form builds the SQL.
- Dialog footer actions are right-aligned; Cancel first, primary last. On mobile, stack and make both full-width.
- Submit buttons enter a pending state: disabled, text changed to `Creating…`, `Renaming…`, etc. Restore on error. This prevents double submission.

### 6.10 Banners, notes, and empty states

**Error banner**

- Container in `index.html` with `role="alert"` and `aria-atomic="true"`.
- Visual: 1 px `--danger-line` border, 3 px left oxide border, `--danger-soft` background, `--danger` text, 10 px 12 px padding.
- Includes a ghost close button with `aria-label="Dismiss error"`.
- Auto-dismiss after 8 seconds, paused while hovered or focused. A new error replaces the old one and restarts the timer.
- Copy: `Couldn't load databases. {server message}` — say what failed first, then include the server text.

**SQL warning note**

- `--warn-soft` background, 3 px `--warn` left border, 1 px `--warn-line` border.
- Copy: `SQL runs as written. There is no confirmation and no undo.`
- No emoji, no icon.

**Empty states**

- Structure: headline, one sentence of direction, one primary action.
- Left-aligned, max-width `48ch`, padding `var(--space-7) 0`, top rule.
- Databases: `No databases yet` / `Create a database to start adding tables and rows.` / `New database`.
- Tables: `No tables in {db}` / `Create a table, or open the SQL console to run a statement.` / `New table` + `SQL console`.
- Table data: `This table has no rows` / `Insert rows with the SQL console, then reload this page.` / `SQL console`.
- SQL results: `No rows returned` / `The statement ran, but it didn't return any rows.` No action.
- Never use italic placeholder prose as the entire empty state.

### 6.11 Loading states

- Set `aria-busy="true"` on the content region while a list or table is loading.
- Show three static ruled placeholder rows with muted blocks. No shimmer.
- Page meta can read `Loading…` in mono.
- Keep the masthead and page header stable so the page does not jump.
- SQL run button uses the existing `Running…` text and disabled state; keep that behavior.

---

## 7. Content and microcopy

The interface should sound like a competent colleague: plain, specific, active voice, no filler.

| Current | Proposed | Why |
| --- | --- | --- |
| `Adopt Database` / `Add existing` | `Add existing database` / `Add database` | One vocabulary for the same action; "adopt" is implementation language. |
| `Database Name:` | `Database name` | Sentence case, no redundant colon. |
| `Warning: This action is irreversible!` | `This permanently deletes "analytics" and every table in it.` | Says what happens to what, instead of a generic warning. |
| `Type database name here` | `Type "analytics" exactly.` | The instruction is specific and visible. |
| `Create` (in delete dialog?) | `Delete database` | The action keeps its name through the flow. |
| `Drop` | `Drop table` in the dialog; `Drop` in the row | SQL users know the term; the dialog is explicit. |
| `Show 25` | `25` under a `Rows` label | The label supplies the meaning; the option stays short. |
| `Run SQL` | `Run query` | The page is the SQL console; the action runs a query. |
| `Limit:` | `Row limit` | Clearer than a bare limit. |
| `⚠️ Warning: Arbitrary SQL is executed as-is. Use with caution.` | `SQL runs as written. There is no confirmation and no undo.` | Direct, no emoji, states the consequence. |
| `No databases found. Create a new one!` | `No databases yet` + direction + button | An invitation, not an exclamation. |
| `Database name does not match. Type "x" exactly to confirm.` | Inline hint under the field, with the confirm button disabled until it matches | Prevent the error instead of reporting it after submit. |

Additional copy rules:

- Buttons use sentence case and no trailing period.
- Errors state what failed and, where possible, what to do next.
- Use straight quotes around identifiers in prose; render identifiers in mono where practical.
- Do not call the user "user" in the interface; the product is an admin console, not a persona.
- Avoid middle-dot meta strings (`A · B · C`) and spaced em-dash labels.

---

## 8. Accessibility and responsive quality floor

### Keyboard

- Every interactive element is reachable and has a visible `:focus-visible` ring.
- `Escape` closes dialogs; focus returns to the trigger.
- Tabs support Left/Right/Home/End.
- The table scroll region is focusable so keyboard users can scroll wide tables.
- No keyboard trap outside the native dialog behavior.

### Screen readers

- One `h1` per page; headings descend in order.
- Table `caption` plus `scope="col"` on header cells.
- Row numbers are `aria-hidden="true"`; the caption carries the row range.
- `aria-current="page"` on the active nav link.
- Error banner is a live region; loading regions set `aria-busy`.
- Icon-only close button has an accessible name.
- Dialog has `aria-labelledby` pointing at its title; destructive dialogs also use `aria-describedby` for the consequence text.

### Visual

- Text meets 4.5:1; large text and non-text UI meet 3:1.
- Color is never the only signal: destructive buttons are labeled Delete/Drop, and errors include text.
- Focus ring is visible on both light and dark surfaces.
- 200% zoom: no clipped controls; tables scroll; dialogs fit.
- 390 px: no horizontal page scroll; only the table frame scrolls.
- Reduced motion: page settle, dialog entrance, and transitions are disabled.
- Native controls follow `color-scheme`.

### Responsive breakpoints

| Width | Behavior |
| --- | --- |
| ≥ 1200 px | Full layout, 32 px gutters, table toolbar and footer on one line |
| 900–1199 px | Page header may stack actions below the title; table toolbar wraps |
| 640–899 px | Two-column dialog grids become one column; row actions wrap |
| < 640 px | 16 px gutters; H1 24 px; masthead wraps; table min-width 640 px and scrolls; dialog full-width; footer stacks |
| < 420 px | Primary page actions full-width; row action buttons may use `btn-sm` at 40 px min-height |

---

## 9. Implementation plan

### Phase 1 — Foundation and shell

1. Add design tokens, reset, typography, focus styles, and color-scheme handling to `public/style.css`.
2. Add the self-hosted Recursive variable font and license under `public/fonts/`.
3. Extend `server.js` static routing for `/fonts/*` with `font/woff2` and `text/plain`, and set a long cache header for font files.
4. Add the font preload and `meta name="color-scheme"` to `index.html`.
5. Replace the masthead markup: `sqld/admin` wordmark, `Databases` nav with `aria-current`, skip link if implemented without breaking the hash router.
6. Add the `role="alert"` error region and the dialog header/close-button structure.

### Phase 2 — Component CSS

1. Rewrite the button system (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-danger-solid`, `.btn-sm`).
2. Build the register list styles (`.register`, `.row-actions`, name links, hover/focus rows).
3. Build the data-grid frame: toolbar, scroll region, sticky header, row gutter, numeric cells, type lines, null/blob treatments, footer.
4. Build the schema table, chips, tabs, dialogs, fields, notes, banners, empty states, and loading placeholders.
5. Add responsive rules for 900 px, 640 px, and 390 px.
6. Add the single page-settle motion and reduced-motion override.
7. Remove all hardcoded colors outside the token block. Keep the stylesheet organized in this order: tokens, reset/base, layout, components, tables, dialogs, states, responsive, motion.

Target size: roughly 400–500 lines. The old "under 150 lines" guidance in `impl-plan.md` is no longer realistic for a designed interface; clarity and grouping matter more than the line count.

### Phase 3 — JavaScript rendering changes

Preserve every API call and all `textContent` usage. Add helpers rather than duplicating markup.

1. `breadcrumb(items)` — builds the `<nav>`/`<ol>` with links and a current item.
2. `pageHeader({ title, meta, actions, crumbs })` — one consistent header for all pages.
3. `emptyState({ title, copy, actions })` — used by Databases, Tables, Data, Schema, and SQL results.
4. `rowNumberCell(n)` — creates an `aria-hidden` gutter cell.
5. `isNumericType(type)` and `inferNumericColumns(rows)` — choose right-alignment for table and SQL result columns.
6. `setBusy(container, bool)` — loading state and `aria-busy`.
7. `setPending(button, label)` — dialog and SQL pending states.
8. `guardExactMatch(input, button, expected)` — enable the destructive confirm only on an exact match; show an inline hint.

Page changes:

- **DatabasesPage:** breadcrumb, H1 `Databases`, meta count; name links; grouped ghost actions; empty state with `New database`; register table; loading rows.
- **TablesPage:** breadcrumb `Databases / {db}`, H1 `{db}`, meta count; `New table` and `SQL console` actions; name links; grouped actions; empty state with two actions.
- **TableViewPage:** breadcrumb `Databases / {db} / {table}`, H1 `{table}`, meta row count; tabs with ARIA and keyboard support; toolbar/footer pagination; gutter; type lines; numeric alignment; schema ordinals and chips; empty states.
- **SQLConsolePage:** breadcrumb `Databases / {db} / SQL console`; warning note; editor bar with `Ctrl + Enter`; `Row limit`; `Run query`; results grid with gutter; empty results state.
- **Dialog handlers:** add pending states, inline exact-match validation, and restore focus on error. Keep the existing one-time binding pattern.

### Phase 4 — Verification and polish

1. Run `npm test` to confirm the API behavior is untouched.
2. Start the app against the local `sqld` stack and visit every route.
3. Check both color schemes at 1440, 1024, 768, and 390 px.
4. Keyboard-only pass: tab order, focus visibility, dialog Escape, tab arrow keys, table scroll.
5. Check the browser console for CSP violations. There should be no external requests and no inline style/script warnings.
6. Test long database/table names, NULLs, blobs, long text, zero rows, zero tables, and a SQL error.
7. Confirm all destructive actions still require exact-name confirmation and that Cancel closes without side effects.

**Verification record — 2026-11-10**

- `npm test`: 116/116 passing, 0 failures (the 113-test Phase-3 baseline plus three concurrent backend tests). `node --check public/app.js` and `node --check server.js` pass.
- Runtime: `/`, `/app.js`, `/style.css`, `/fonts/recursive-latin-var.woff2`, and `/fonts/OFL.txt` return 200 with the expected MIME types; the list/tables/schema/rows/SQL API smoke checks pass. Rows pagination was verified with `?limit=25&offset=50` and `?limit=25&offset=100` against a temporary 120-row table, which was dropped afterwards.
- Static: no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, no inline handlers or styles, no external URLs; CSP is `default-src 'self'`; all 14 API calls are present; 9 dialogs and 9 `.dialog-actions` exist with no duplicate or unresolved ids; all rendered text/UI token pairs meet 4.5:1 (the unused `--faint` token was adjusted to pass).
- Browser/visual checks at 1440, 1024, 768, and 390 px, both color schemes, 200% zoom, keyboard-only operation, reduced motion, and the console/CSP check were performed manually in Phase 4. That pass found one issue: the table-frame empty state had no left inset. It is fixed with `.table-frame > .empty-state { padding-inline: var(--space-4); }`. The schema mono styling was also corrected for the Phase-3 column order (`Type` is column 3) and the section `h2` sizing was aligned.

### File-level change map

| File | Change |
| --- | --- |
| `public/style.css` | Full rewrite around tokens and the component system above. Keep class names used by `app.js` or update both in the same pass. |
| `public/index.html` | Masthead, error live region, dialog headers/close buttons/ARIA, visible new-table column labels, font preload, color-scheme meta. |
| `public/app.js` | Render helpers and page markup updates. No API contract changes. Preserve `textContent` and CSP-safe event binding. |
| `server.js` | Allow `/fonts/*.woff2` and `/fonts/OFL.txt`; add MIME types and font cache headers. |
| `public/fonts/` | New directory with the Recursive variable font and its OFL license. |
| `frontend-design-plan.md` | This document. |

### Class migration notes

To keep the diff reviewable, keep the existing class names where they still make sense and add new ones around them:

- Keep: `.page-header`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.data-table`, `.results-table`, `.error-banner`, `.tabs`, `.tab-btn`, `.tab-content`, `.pagination-nav`, `.page-size-select`, `.sql-console`, `.sql-editor`, `.results-container`, `.column-row`, `.column-name`, `.column-type`, `.column-pk`, `.column-notnull`, `.column-default`, `.dialog-buttons`, `.cancel-btn`.
- Add: `.page-heading`, `.page-actions`, `.breadcrumb`, `.register`, `.row-actions`, `.btn-ghost`, `.btn-danger-solid`, `.btn-sm`, `.table-frame`, `.table-toolbar`, `.table-scroll`, `.table-footer`, `.row-num`, `.num`, `.col-type`, `.cell-text`, `.cell-blob`, `.cell-null`, `.empty-state`, `.note`, `.note-warn`, `.field`, `.field-hint`, `.field-error`, `.dialog-head`, `.dialog-body`, `.dialog-actions`, `.dialog-close`, `.danger-note`, `.chip`, `.chip-pk`, `.chip-null`.
- Remove after migration: `.button-row` (replaced by `.page-actions`), `.empty-message`, `.no-results`, `.warning-banner`, `.pagination` (split into toolbar/footer).

---

## 10. Review against the brief

### First idea: "paper ledger"

Cream canvas (`#F4F1EA`), a high-contrast serif for headings, terracotta accent, numbered sections, and card-like panels.

**Rejected because:** this is the most recognizable generated-design cluster right now. It would make a server tool look like an editorial site, and the paper metaphor adds nostalgia without improving scan speed. The palette also fails the "is this a choice for this subject?" test — it would be the same choice for a bakery or a law firm.

### Second idea: "terminal"

Near-black background, phosphor-green or acid-green accent, everything in monospace, window chrome, and scanline texture.

**Rejected because:** this is the second recognizable cluster. It looks dramatic in a screenshot and becomes tiring in a dense table at 2 a.m. It also turns routine maintenance into an emergency. Monospace everything makes long names and error messages harder to read, and it collapses the useful distinction between human language and machine data.

### Final direction: Record Bench

**What changed and why:**

- The canvas is a cool chalk-green rather than cream. It keeps the screen calm and makes the white data surface step forward without a card shadow.
- The accent is deep petrol rather than terracotta or acid green. It reads as ink on a technical document and gives links, focus, and primary actions one coherent signal.
- Oxide red is reserved for destruction and errors. It is not used for ordinary emphasis, so it keeps its meaning.
- Type is one family in two modes. This is specific to the app's split between human labels and machine records, and it avoids a decorative pairing.
- The register is the layout. Rules, gutters, and headers do the structural work; there are no cards to stack.
- The row and column numbers are functional, not ornamental. They encode position in a result set and in a schema, which is exactly the kind of numbering this content has.
- There is one orchestrated motion moment (the page settle), not a reveal on every section.

### The accessory removed

The current UI uses back buttons, card shadows, a colored button for every action, a warning emoji, and a page-level heading border. The redesign removes the back buttons (breadcrumbs replace them), the card shadows (rules replace them), the solid red row buttons (ghost danger replaces them), the emoji (a note block replaces it), and the extra header rule (space and type hierarchy replace it). The result should feel quieter and more precise, not emptier.

---

## 11. Acceptance criteria

- [x] All four routes render a masthead, breadcrumb, single `h1`, meta line, and right-aligned page actions.
- [x] Databases and Tables pages use the register pattern; names are links; row actions are grouped ghost buttons; destructive row actions are danger-ghost.
- [x] Empty states in Databases, Tables, Table Data, Schema, and SQL Results include direction and a relevant action where one exists.
- [x] Data tab has a sticky header, sticky row gutter, column type lines, numeric right-alignment, contained horizontal scroll, toolbar page size, and footer pagination.
- [x] Schema tab shows column ordinals, type, PK/NOT NULL chips, and default values in mono.
- [x] SQL console has a note block, editor header with shortcut hint, borderless textarea inside a bordered surface, row-limit control, and results grid with gutter.
- [x] Dialogs have a header, close button, labeled fields, hints, a pending submit state, and exact-match confirmation for destructive actions.
- [x] Error banner is a live region with a dismiss control and a readable server message.
- [x] Light and dark tokens pass contrast; no hardcoded color values remain outside the token block.
- [x] At 390 px there is no horizontal page scroll; tables scroll internally; dialogs fit the viewport.
- [x] At 200% zoom, controls remain usable and nothing is clipped.
- [x] Keyboard-only operation works: focus is always visible, dialogs close with Escape, tabs respond to arrow keys, and the table scroll region is focusable.
- [x] `prefers-reduced-motion` removes the page-settle and dialog animations.
- [x] The page makes no external network requests and produces no CSP violations.
- [x] All user data is still rendered with `textContent`; no `innerHTML` is introduced.
- [x] `npm test` passes and every existing API action still works from the UI.

---

## 12. Risks and decisions

| Risk / decision | Mitigation |
| --- | --- |
| A self-hosted font adds a binary asset and a server-route change. | Keep it to one variable font, include its OFL license, and preserve full fallback stacks. The layout must work without it. |
| Rewriting CSS can break class names that `app.js` depends on. | Update CSS and JS in the same change; use the migration list above; test every route. |
| Sticky headers and a sticky gutter can behave badly inside nested scroll containers. | Keep one scroll container (`.table-scroll`), give sticky cells opaque backgrounds, and test at 390 px and 200% zoom. |
| Disabling the destructive confirm until an exact match can feel strict. | Show the expected name in mono directly above the field and update the hint as the user types. This is safer than a post-submit error. |
| The SQL console's warning could become noise. | Keep it to one sentence, place it once above the editor, and avoid repeating it in results or buttons. |
| The design intentionally has no theme switcher. | Follow `prefers-color-scheme`; a manual toggle is a separate feature. |
| The app has no insert/edit UI, so the empty-data state points to SQL. | Say so plainly: `Insert rows with the SQL console, then reload this page.` Do not add an insert form in this design pass. |

---

## 13. Suggested visual QA set

Capture these once the implementation is ready (manually or with a future screenshot harness):

1. Databases — populated, light, 1440 px.
2. Databases — empty, light, 390 px.
3. Tables — populated, dark, 1024 px.
4. Table view — Data tab, wide table with NULL and blob, 768 px.
5. Table view — Schema tab, light, 1440 px.
6. SQL console — success with results, dark, 1440 px.
7. SQL console — error banner, light, 390 px.
8. Delete database dialog — light, desktop.
9. New table dialog — mobile, with stacked column groups.
10. Focus-visible pass on nav, row action, tab, and dialog close.
