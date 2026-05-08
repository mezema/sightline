# Sightline Web App — Design Plan

This document is the design plan for `apps/web` (Next.js 16, App Router, React 19, Tailwind 4, Clerk, Drizzle). It assumes [`product-spec.md`](product-spec.md) and [`ui-design.md`](ui-design.md) as inputs and does not restate them. It defers schema, infra, and analyzer decisions to those docs and focuses on *how the user experience is structured* — routes, screens, components, tokens, and interaction model.

The plan is opinionated. Each opinion names the bottleneck it removes and the trade-off it accepts.

---

## 1. First Principles

**The user's mental model:**
> "Here is what's wrong. Check these things. Tell me which ones look like that."

**The product's only real noun:** `Inspection`. Everything else (results, detections, feedback, retries) is a property of an inspection. The library is a list of inspections; an inspection page is one inspection.

**The bottleneck during review:** when results come back, the user has to scan many targets, judge each one against the reference defect, and trust or correct what the analyzer claims. The fastest review keeps the reference *visible while scanning* — never make the reviewer hold the defect in working memory.

**The bottleneck during async wait:** slow analyzer calls kill attention. Progress must be *visible and spatially stable*. A user who refreshes mid-run must land on the same view, not a different one.

**The bottleneck during failure:** failed targets that disappear into a hidden menu erode trust. Failures must be visible in the same grid as successes, retryable in place.

**The bottleneck on return visits (home):** the user comes back asking "what now?" If home shows a flat list of records, they have to scan to reconstruct context. If home surfaces *what's happening right now* and *what was checked recently* in their own visual language, the answer is given before the question is fully formed.

**The trade-off accepted:** denser pages, fewer routes, less marketing-page polish. The product is an inspection bench, not a website.

---

## 2. The Core Move: One Canvas, Three States

An `Inspection` lives at one URL. That URL renders one canvas that *transforms* through three states:

```
empty       →   running         →   reviewed
compose         processing          filtered, correctable
```

The reference image and description are pinned at the top in *every* state. The grid below changes meaning:

- **empty:** the grid shows file thumbnails the user just selected.
- **running:** the grid shows shimmering placeholders for queued targets, scanning bars on running targets, and filled tiles for completed ones.
- **reviewed:** the grid shows all targets with bounding-box overlays, filterable by bucket.

**Why this collapses the spec's 5 screens into 2:**

| Spec screen | This plan |
| --- | --- |
| Inspection library | `/` (home, three sub-states) |
| New inspection | `/i/new` (inspection in `empty` state) |
| Inspection running | `/i/[id]` in `running` state |
| Result review | `/i/[id]` in `reviewed` state |
| Image detail | overlay sheet over `/i/[id]` |

A refresh on `/i/[id]` returns to the same canvas in whatever state the inspection is now in. No redirect logic. No "are we in compose mode?" branches. State is a property of the data, not the page.

---

## 3. Routing (Next.js App Router)

### Route table

| Path | Renders | RSC? | Notes |
| --- | --- | --- | --- |
| `/sign-in`, `/sign-up` | Clerk-hosted | n/a | Default Clerk sign-in pages, themed via tokens. |
| `/` | Home (library + optional running band) | Server | Reads inspections for current user from DB. Adapts to three states. |
| `/i/new` | Inspection in `empty` state | Server shell + Client form | Creates the row on submit, then `redirect()` to `/i/[id]`. |
| `/i/[id]` | Inspection (state derived from data) | Server | Server-renders dossier; live polling is a child Client Component. |
| `/i/[id]/t/[index]` | Detail (deep link) | Server | Full-page detail. Refresh/share-safe URL. |
| `/i/[id]/@modal/(.)t/[index]` | Detail (intercepted as overlay) | Server | Same content rendered as a sheet over the dossier. |

`@modal` + `(.)` are Next.js parallel + intercepting routes. From the dossier, clicking a target intercepts the navigation and opens the detail as a sheet. Direct navigation to `/i/[id]/t/[index]` shows the same content as a full page. Both are addressable.

**Why this matters:** the user can open a detail in a new tab, share a link to a specific target with a teammate, or reload at the exact target they were reviewing. The URL is the truth.

Auth: Clerk middleware redirects unauthenticated traffic to `/sign-in` for everything except the sign-in/up routes. There is no marketing landing page; the product begins after auth.

### Server vs Client split

| Concern | Component kind |
| --- | --- |
| Library list, "Now running" band | Server. Reads DB directly, no `fetch`. |
| Compose form (file inputs, drag-drop, validation) | Client. |
| Dossier shell (reference, description, counts) | Server. |
| Live polling, optimistic feedback, retry | Client (mounted inside server shell). |
| Detail sheet | Server for image + detections; Client for action buttons. |
| Filter tabs (bucket switching) | Client (URL search param `?b=defect`). |

**Server Actions vs API routes:** start with API routes for the upload flow (need multipart streaming), and use Server Actions for feedback/retry (small JSON, type-safe). The existing `app/api/inspections/...` routes stay; `feedback` and `retry` migrate to Server Actions when convenient.

### URL is the state

| What | Where it lives |
| --- | --- |
| Active inspection | path `/i/[id]` |
| Active filter | search `?b=all|defect|clean|failed` |
| Active detail target | path `/i/[id]/t/[index]` |
| Compose form values | local React state until submit (then path `/i/[id]`) |

No global store. No `setActiveInspection` in client memory. Refresh is a no-op for state.

---

## 4. Screen Designs

### 4.0 App shell (topbar)

```
┌────────────────────────────────────────────────────────────────┐
│  ◻ Sightline              + New inspection      [user avatar]  │
└────────────────────────────────────────────────────────────────┘
```

Sticky, hairline below, paper background. Three slots only:

- **Left:** brand (`◻ Sightline`). Click → `/`.
- **Center-right:** `+ New inspection` button. Always visible except in `/i/new` where it disables itself (you're already creating one).
- **Right:** Clerk `<UserButton />`. Account/sign-out lives behind it.

No nav items. No search. No help link. No theme toggle. The bench has one tool counter.

---

### 4.1 Home — `/`

Home has three distinct states, chosen by the data. Same route, different layouts. The three states cover *every* visit a user can make to `/`.

#### State A: zero inspections (first-time user)

```
┌──────────────────────────────────────────────┐
│ ◻ Sightline                  + New inspection│
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│             No inspections yet               │
│                                              │
│      Define a defect, drop in target         │
│      images, and Sightline will check        │
│      them.                                   │
│                                              │
│      [+ Start your first inspection]         │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

- Centered, vertically near the top third.
- Single CTA — sends to `/i/new`.
- One sentence of explanation, declarative, no marketing voice.
- No hero illustration, no welcome banner.
- The topbar's `+ New inspection` is also live; the empty CTA is the same destination, just made unmissable.

#### State B: at least one inspection, none currently running

```
┌──────────────────────────────────────────────┐
│ ◻ Sightline                  + New inspection│
├──────────────────────────────────────────────┤
│                                              │
│  Inspections                                 │
│                                              │
│  ╭───────────╮ ╭───────────╮ ╭───────────╮  │
│  │           │ │           │ │           │  │
│  │  ref img  │ │  ref img  │ │  ref img  │  │
│  │           │ │           │ │           │  │
│  │ ▌▌▌▌▌░░░░░│ │ ▌▌░░░░░░░░│ │ ▌░░░░░░░░░│  │
│  ├───────────┤ ├───────────┤ ├───────────┤  │
│  │ Crack at  │ │ Missing   │ │ Bracket   │  │
│  │ seam      │ │ screw     │ │ damage    │  │
│  │ ● done    │ │ ● done    │ │ ● done    │  │
│  │ 4h ago    │ │ yesterday │ │ Mar 12    │  │
│  ╰───────────╯ ╰───────────╯ ╰───────────╯  │
│                                              │
│  ╭───────────╮ ╭───────────╮                │
│  │  ref img  │ │  ref img  │                │
│  │ ...       │ │ ...       │                │
│  ╰───────────╯ ╰───────────╯                │
└──────────────────────────────────────────────┘
```

Pure card grid, reverse-chronological. Most recent first. No section headers, no buckets — the list is the answer.

#### State C: at least one inspection currently running

```
┌──────────────────────────────────────────────┐
│ ◻ Sightline                  + New inspection│
├──────────────────────────────────────────────┤
│                                              │
│  Now running ●                               │
│  ╭──────────────────────────────────────╮   │
│  │ [ref]  Missing screw on left bracket │   │
│  │        ▌▌▌▌▌░░░░░░░░░░░░░░░░         │   │
│  │        4 of 12 inspected · 1 found   │   │
│  ╰──────────────────────────────────────╯   │
│                                              │
│  ─────────────────────────────────────────   │
│                                              │
│  Inspections                                 │
│  ╭───────────╮ ╭───────────╮ ╭───────────╮  │
│  │  ref img  │ │  ref img  │ │  ref img  │  │
│  │ ...       │ │ ...       │ │ ...       │  │
│  ╰───────────╯ ╰───────────╯ ╰───────────╯  │
└──────────────────────────────────────────────┘
```

The "Now running" band:

- Wide single card pinned above the grid.
- Reference thumbnail on the left (~64×64).
- Description, a thin progress bar (amber over hairline), and a count line.
- Pulsing dot in the section heading; not in the card itself (avoid double-pulse).
- Click anywhere on the card → opens the inspection.
- Multiple running inspections are stacked in the band (rare; max 2-3 before the design needs to be revisited).

The card's polling cadence on home is **5 seconds** (slower than the inspection page itself, which polls at 1.5s). The user isn't focused here; it just needs to feel alive on glance.

**Critical:** the band is conditional. When nothing is running, the entire `Now running` block is *gone* — not an empty placeholder, not a "0 running" label. Don't reserve space for absence.

The running inspection ALSO appears in the chronological grid below in its normal position. Slight redundancy is acceptable for findability — the band is "happening now," the grid is "here in your timeline."

#### Library card (used in states B and C)

```
╭───────────────────╮
│                   │
│                   │
│    REFERENCE      │
│      IMAGE        │
│                   │  ← 16:10 aspect, ~280px wide on desktop
│                   │
│                   │
│ ▌▌▌▌▌░░░░░░░░░░░  │  ← result strip: 4px stacked bar
├───────────────────┤
│ Hairline crack    │
│ at the seam       │  ← description, 2-line clamp
│ ● complete        │  ← status pill
│ 4h ago            │  ← relative date
╰───────────────────╯
```

**Why image-as-primary:** the reference image is the strongest recognition signal. A user thinks "the cracked weld one," not "the third one I made yesterday." Description text often repeats across inspections of the same product type.

**The result strip** is a 4px stacked bar at the bottom of the image, communicating outcome proportions visually:

| Segment | Color | Meaning |
| --- | --- | --- |
| Amber | `--accent` | Targets where defect was found |
| Ink | `--ink-2` | Targets clean |
| Alert | `--alert` | Targets that failed processing |
| Hairline | `--hairline` | Targets not yet inspected (running) |

You read proportions, not numbers: "mostly amber" vs "mostly clean" vs "still half empty." Counts as text are gone from the card surface. If exact numbers matter, hover/focus reveals a tooltip.

**Caption rules:**
- Description: 14px, weight 500, ink color, max 2 lines (clamp).
- Status pill + relative date on one line.
- Relative dates: `2m ago`, `4h ago`, `yesterday`, then `Mar 12` after a week, then `Mar 12, 2026` after a year.

**Grid:**
- Desktop: `repeat(auto-fill, minmax(260px, 1fr))`, gap `24px`.
- Tablet: 2 columns naturally.
- Mobile: 1 column. The grid becomes a list. No code change needed.

---

### 4.2 New Inspection — `/i/new` (inspection in `empty` state)

The hero (reference + description + status) is identical across all three inspection states. Only what's *below* the divider changes.

```
┌────────────────────────────────────────────────────────────────┐
│ ◻ Sightline                                                    │
├────────────────────────────────────────────────────────────────┤
│ ← Inspections                                                  │
│                                                                │
│ ╭───────────╮   What defect should Sightline find?             │
│ │  + ref    │   ┃                                              │
│ │  image    │                                                  │
│ ╰───────────╯   ● draft                                        │
│ ─────────────────────────────────────────────────────────      │
│                                                                │
│ ╭────────────────────────────────────────────────────────────╮ │
│ │              Add target images                             │ │
│ │      Drop here or click to choose. Up to 25.               │ │
│ ╰────────────────────────────────────────────────────────────╯ │
│                                                                │
│ Add a reference image to begin.       [ Start inspection ]     │
└────────────────────────────────────────────────────────────────┘
```

- Reference is a dashed-border square dropzone. Click or drop to upload one image.
- Description is a textarea with placeholder doubling as the future title. As the user types, the page header "becomes" their description.
- Targets dropzone is below the divider. Drop or click adds targets; tiles render in the grid below as previews while still in compose mode.
- The footer helper line tells the user *exactly* what's missing. The button is disabled until ready, never sneaky.
- Hard limit at 25; extras silently truncated with an inline note.

**Order of completion is up to the user.** No wizard, no steps, no modal. All inputs visible at once.

---

### 4.3 Running Inspection — `/i/[id]` in `running` state

```
│ ╭───────────╮   surface crack like the reference image         │
│ │ ref image │                                                  │
│ ╰───────────╯   ● running   3 of 25 inspected   1 found        │
│ ─────────────────────────────────────────────────────────      │
│                                                                │
│  INSPECTING · 3/25                                             │
│                                                                │
│  ╭─────╮ ╭─────╮ ╭─────╮ ╭─────╮ ╭─────╮ ╭─────╮               │
│  │ img │ │ img │ │ img │ │░░░░░│ │░░░░░│ │░░░░░│              │
│  │  ⬚  │ │     │ │     │ │ que │ │ que │ │ que │              │
│  ╰─────╯ ╰─────╯ ╰─────╯ ╰─────╯ ╰─────╯ ╰─────╯               │
│  defect   clean   clean   queued  queued  queued               │
│  ...                                                           │
└────────────────────────────────────────────────────────────────┘
```

- Tiles never move as state changes. Position is stable. State changes in place.
- Tile states:
  - `queued`: shimmer animation, dashed border, image hidden until ready.
  - `running`: image visible, scanning-line animation across the bottom edge.
  - `clean`: image visible, no overlay, no badge.
  - `defect`: image visible with bounding-box overlay; tile border picks up the accent.
  - `failed`: image visible, grayscale, dashed border, "Could not inspect" label.
- No standalone progress bar. The grid IS the progress bar at higher resolution.
- Hero pill is amber and pulses gently while `running`.
- Polling cadence: **1.5 seconds** while the user is on this page (faster than the home band's 5s). The poller is a Client Component; on each tick it calls `router.refresh()` so the Server Component re-fetches and re-renders.

---

### 4.4 Reviewed Inspection — `/i/[id]` in `reviewed` state

```
│ ╭───────────╮   surface crack like the reference image         │
│ │ ref image │                                                  │
│ ╰───────────╯   ● complete   25 of 25 inspected · 7 found      │
│ ─────────────────────────────────────────────────────────      │
│                                                                │
│  [All 25] [Defect 7] [Clean 17] [Failed 1]                     │
│                                                                │
│  TARGETS                                                       │
│  ╭─────╮ ╭─────╮ ╭─────╮ ╭─────╮ ╭─────╮                       │
│  │ img │ │ img⬚│ │ img │ │ img │ │ img │                       │
│  ╰─────╯ ╰─────╯ ╰─────╯ ╰─────╯ ╰─────╯                       │
│  ...                                                           │
└────────────────────────────────────────────────────────────────┘
```

- Filter pills above the section label: `All / Defect / Clean / Failed`. Active filter is solid black; inactive are quiet text. Counts beside each label use tabular numerals.
- Filter changes are URL changes (`?b=defect`), so back/forward works.
- The grid renders all targets that match the active filter. Tiles in stable order by upload position.
- Click any tile → opens the detail sheet over the page.

---

### 4.5 Detail — sheet over `/i/[id]`

```
┌────────────────────────────────────────────────────────────────┐
│ ← Prev   3 / 25   Next →              Close [Esc]              │
├────────────────────────────────────────────────────────────────┤
│                                            │ RESULT            │
│                                            │ Defect found      │
│         ╭──────────────────────╮           │                   │
│         │                      │           │ FILE              │
│         │       target         │           │ target-03.jpg     │
│         │       image          │           │                   │
│         │       with           │           │ LATENCY           │
│         │       bounding       │           │ 10.5s             │
│         │       box            │           │                   │
│         │                      │           │ DETECTIONS        │
│         ╰──────────────────────╯           │ ▌ surface crack   │
│                                            │ ▌ A prominent...  │
│                                            │                   │
│                                            │ [✓ Correct]       │
│                                            │ [✕ Wrong]         │
│                                            │ [Retry]           │
└────────────────────────────────────────────────────────────────┘
```

- Sheet slides up from the bottom over the dossier. Backdrop dims the page.
- Image fills the left side, scaled to fit; bounding boxes are SVG overlays drawn from stored pixel coordinates.
- Right pane: result status, file name (mono), latency (numerals), detection list (each with a left-rule accent line), action row.
- Keyboard: `←` / `→` step through targets, `Esc` closes.
- Prev/Next disabled at boundaries; both rotate URL via `replaceState`.
- Failed variant: same layout, image is grayscale, no detections list. The reason text appears under "REASON". Only `Retry` action is visible (Correct/Wrong don't apply to failures).

**Why a sheet, not a separate page:** the user reviews *batches*. Closing should drop them back exactly where they were in the grid (scroll position, filter, hover state). A modal preserves that. The intercepting route gives the URL durability without losing the context.

---

## 5. Visual System (Hard-to-Vary)

These values are defined once in `app/globals.css` and used everywhere. *Never compute colors or sizes on the fly.*

### Color tokens

```css
:root {
  /* Surface */
  --paper:    #fafaf7;   /* Page background — warm off-white */
  --surface:  #ffffff;   /* Cards, sheets, dropzones */
  --hairline: #e7e3d6;   /* Dividers, low-emphasis borders */
  --line:     #d8d3c4;   /* Borders, button outlines */

  /* Text */
  --ink:      #14150f;   /* Primary text */
  --ink-2:    #3a3a32;   /* Numbers, body emphasis, "clean" segment */
  --muted:    #6e6c64;   /* Secondary text, helpers */

  /* Accent — the only "found something" color */
  --accent:        #b78b1e;   /* Bounding boxes, "defect" pills, found segment */
  --accent-soft:   #fcf3d4;
  --accent-line:   #d9b34a;

  /* Alert — reserved for system failures only, NEVER for "defect" */
  --alert:        #a8362a;
  --alert-soft:   #f7e4e0;

  /* Confirm — only for user-confirmed-correct feedback */
  --confirm:      #2f6b35;
  --confirm-soft: #dcebd9;
}
```

**Why amber for the accent:** finding a defect is the *goal*, not an error. Red implies "this is bad," but the user is *looking for* defects — finding one is success. Amber reads as forensic-marker yellow: "look here, this is a finding." Red is reserved for real failures (analyzer crashed, target couldn't be inspected).

### Typography

Single typeface: **Inter** via `rsms.me/inter/inter.css`. Weight does the work, not size.

| Token | Size | Weight | Use |
| --- | ---: | ---: | --- |
| `display` | 28 | 500 | Page title (`Inspections`, hero description) |
| `title`   | 20 | 500 | Section heading |
| `body-strong` | 14 | 500 | Counts, tile name, button |
| `body`    | 14 | 400 | Default |
| `caption` | 12 | 400 | Helper, timestamp, status text |
| `label`   | 11 | 500 | Field labels (UPPERCASE, tracked) |
| `mono`    | 12 | 400 | Filenames, IDs, latency |

Mono stack: `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace`.

**No clamp scaling.** Headers do not grow with viewport width. Hierarchy comes from weight and color contrast first, size second.

### Spacing

Use only these values: `4, 8, 12, 16, 24, 32, 48, 64, 96`. Encoded as Tailwind theme spacing or CSS custom properties.

### Border radii

`4px` (small), `6px` (default), `12px` (large surfaces). No 50% pill radii except for status dots.

### Bounding boxes

- Stroke: `1.5px`, color: `var(--accent)`, `vector-effect: non-scaling-stroke` so stroke width is constant regardless of zoom.
- Fill: `rgba(183, 139, 30, 0.08)` — barely tinted, image is the subject.
- Label: detection label inside top-left corner of the box, in 11px UI weight, with a soft cream outline for legibility on busy images.
- Coordinates stored as pixel coordinates against post-EXIF-rotation image dimensions, normalized in the analyzer adapter.
- Confidence: hidden in V1. The analyzer is not calibrated.

### Result strip (a recurring primitive)

The 4px stacked bar appears in two places:
- Bottom edge of every library card.
- Bottom edge of the running-band card, where the strip extends as targets complete.

Composition rule (left-to-right, in order of segment width):

```
amber : ink-2 : alert : hairline
found : clean : failed : remaining
```

When all targets are unprocessed, the strip is 100% hairline (almost invisible). As targets complete, segments grow from the left. No animation on segment changes — just a re-render. The eye reads proportions immediately.

### Status communication

Color is never the only differentiator. Every status uses **shape + label**:

| State | Pill color | Pill icon | Tile treatment |
| --- | --- | --- | --- |
| draft | muted | `●` (gray dot) | n/a |
| queued | muted | `●` | dashed border, shimmer |
| running | accent | `●` (pulsing) | scanning bar |
| complete | ink-2 | `●` | normal |
| processing | accent | `●` (pulsing) | n/a (for inspection) |
| partially_failed | alert | `●` | n/a (for inspection) |
| failed | alert | `●` | dashed border, grayscale image |
| defect (target) | accent | n/a | accent border |
| clean (target) | n/a | n/a | normal, no badge |

---

## 6. Component Inventory

| Component | Source | Notes |
| --- | --- | --- |
| `Topbar` | custom | Brand + `+ New` button + Clerk `<UserButton />`. Sticky, 16px y padding, hairline below. |
| `LibraryCard` | custom | Server Component. Reference image + result strip + caption. The unit of the home grid. |
| `NowRunningBand` | custom | Server Component (with Client poller child). Conditional pinned card on home for running inspections. |
| `EmptyHome` | custom | Centered first-run state with single CTA. |
| `InspectionHero` | custom | Server Component. Reference image + description + status pill + summary. |
| `InspectionGrid` | custom | Reorderable grid; tiles in stable position. |
| `Tile` | custom | Image + overlay + name + status text. State driven by `data-state` attribute. |
| `BoundingBoxOverlay` | `@sightline/ui` | SVG overlay, already exists in `packages/ui`. Reuse. |
| `ResultStrip` | custom | The 4px stacked bar, reused on cards and band. |
| `FilterTabs` | custom | URL-driven filter pills. Client. |
| `DetailSheet` | shadcn `Sheet` themed | Side pane on desktop, full-height drawer on mobile. |
| `ComposeReference` | custom | Dropzone, click-to-pick, EXIF-rotation preview. Client. |
| `ComposeTargets` | custom | Multi-file dropzone, count display. Client. |
| `LivePoller` | custom | `usePolling(id, intervalMs)` hook + invisible component that calls `router.refresh()`. |
| `Pill` | custom | Status indicator with dot. Color tied to `data-state`. |
| `EmptyState` | custom | Centered prompt + single CTA (used by `EmptyHome` and "no targets in this filter"). |

**shadcn/ui usage:** `Sheet`, `Button`, `Input`, `Tabs` (for filter tabs), `Dialog` (for confirm-cancel of inspection). Themed via the CSS tokens above; do not import shadcn's default theme.

**State libraries:** none. URL + React state + `useFormState` for compose. Polling via the `LivePoller` component.

**Image component:** `next/image` with `unoptimized` only when serving from local `/uploads/` in dev. In production, signed URLs from object storage; fetch images with the standard component for AVIF/WebP optimization.

---

## 7. Interaction Patterns

### Polling

```
Home: poll every 5s when at least one inspection is processing.
Inspection page: poll every 1.5s when status === "processing".
Stop polling on terminal status (completed | failed | partially_failed | cancelled).
```

Polling is implemented as a small Client Component (`<LivePoller intervalMs={n} />`) that calls `router.refresh()` on each tick. The Server Component re-renders with fresh data. No client-side data store, no race conditions.

### Optimistic feedback (mark correct/wrong)

When the user clicks `✓ Correct` in the detail sheet:

1. Immediately update the local sheet state to show "Marked correct" and disable the buttons.
2. Submit the Server Action.
3. On success: server returns updated inspection; `revalidatePath("/i/[id]")` re-renders the dossier with the new feedback record.
4. On failure: revert the sheet state, surface the error message inline (no toast).

### Optimistic retry

Click `Retry` on a failed target → POST to `/api/inspections/[id]/retry` → server creates a new attempt, marks the inspection as `processing` → router refreshes → tile transitions from `failed` to `running` in place. Live poller picks back up automatically.

### Transitions

- Tile state changes (`queued → running → defect|clean|failed`): 240ms ease for opacity/border, 1.4s shimmer animation for `queued`, 1.6s scan-bar animation for `running`.
- Sheet open: 240ms cubic-bezier(0.2, 0.8, 0.2, 1) translateY + 200ms opacity for backdrop.
- Hover lift on cards: 80ms ease, `translateY(-2px)`.
- *No layout-shifting animations.* Tiles stay where they are.

### Animation rules

- Animate state transitions, never decoration.
- Don't animate things on first paint; use transitions, not entrance animations.
- Respect `prefers-reduced-motion`: turn shimmer/scan into a static accent border.

### Keyboard shortcuts (V1)

| Key | Where | Action |
| --- | --- | --- |
| `n` | `/` | Navigate to `/i/new` |
| `←` / `→` | Detail sheet open | Step prev/next target |
| `Esc` | Detail sheet open | Close sheet |
| `Cmd+Enter` | Compose | Submit when ready |

Document these in a `?` overlay later. Don't add a help menu in V1.

---

## 8. State Coverage Matrix

A screen is not done until each state has explicit visual handling.

| State | Home | Inspection (empty) | Inspection (running) | Inspection (reviewed) | Detail |
| --- | --- | --- | --- | --- | --- |
| Loading | RSC suspense: 6 skeleton cards | n/a | RSC fallback: hero + 6 tile shimmer | RSC fallback | Image loading shimmer |
| Empty | "No inspections yet" + CTA | Initial form | n/a | "No targets in this filter" | n/a |
| One running, others done | Band visible, grid below | n/a | n/a | n/a | n/a |
| All running, none done yet | Band only, grid empty | n/a | grid full of running/queued tiles | n/a | n/a |
| Partial success | n/a | n/a | mix of states in grid | bucket counts + filtered grid | n/a |
| All failed | row in grid shows alert strip | n/a | grid full of failed tiles | bucket `Failed` exhaustive | failed variant of sheet |
| Refresh | RSC re-renders from DB | form values lost (acceptable) | resumes polling | resumes filter | resumes target index |
| Disconnected polling | retry on next interval | n/a | retry on next interval | n/a | n/a |
| Slow upload | spinner on "Start inspection" button | n/a | n/a | n/a | n/a |
| Auth missing | redirect to /sign-in | redirect | redirect | redirect | redirect |

A state must never tell the user they did something wrong when the system failed.

---

## 9. Out of V1

These are good ideas, just not first.

- Manual box drawing.
- Confidence threshold slider.
- Low-confidence bucket.
- "Needs review" bucket / to-do queue model.
- PDF/report export.
- Saved defect templates.
- Multi-tenant org admin.
- Provider comparison UI.
- Realtime via SSE/WebSocket (polling is enough).
- Animated SVG box drawing on first appearance (could feel game-y).
- Drag-to-reorder targets.
- Inspection-level search/filter on home.
- Pinned/favorite inspections.
- Recently-viewed (separate from chronological).
- Compose-form persistence to localStorage.
- Help overlay / keyboard cheatsheet UI.
- Dark mode.
- Inline reference dropzone on home.

Each earns its place through observed usage.

---

## 10. Implementation Sequence

This sequence reflects the spec's Phase 1 / Phase 2 boundaries and prioritizes shipping the workflow before polishing.

1. **Tokens & layout shell** — write `globals.css` tokens, root layout with Clerk `<ClerkProvider>`, topbar with brand + `+ New` + `<UserButton />`, empty-state primitives. Verify with one screenshot.
2. **Home (state A & B)** — `/` as Server Component. DB query → render `<EmptyHome />` if zero inspections, otherwise `<LibraryCard />` grid. No running band yet.
3. **Compose route** — `/i/new` with Server Action that creates the inspection row and `redirect()`s to `/i/[id]`. Multipart upload happens via API route during submit.
4. **Inspection dossier (empty + running)** — `/i/[id]` Server Component renders hero. Mount `<LivePoller intervalMs={1500} />` if running. Tile templates with all five states.
5. **Home (state C)** — add `<NowRunningBand />`. Wire to the same DB query, conditional render.
6. **Inspection dossier (reviewed)** — filter tabs (URL search params), exhaustive buckets, tiles open detail.
7. **Detail sheet** — parallel/intercepting route at `@modal/(.)t/[index]` with shadcn `Sheet`. Direct route at `t/[index]` for deep-link.
8. **Feedback & retry** — Server Actions, optimistic UI, error states.
9. **Polish & state coverage** — empty/loading/error variants for every screen, prefers-reduced-motion fallbacks, Playwright tests for the 8 acceptance flows in `product-spec.md` §16.

Each step ends in a working build deployable to Vercel preview. No step bundles UI, data, and infra changes together.

---

## 11. Copy & Vocabulary

Use these words exactly. Never substitute.

| Concept | UI word | Don't use |
| --- | --- | --- |
| One durable job | inspection | scan, analysis, run, prediction |
| Example image | reference | sample, exemplar |
| Reference + description | defect spec | filter, query |
| Images being inspected | targets | inputs, items |
| One bounding box | detection | finding, prediction |
| Per-target outcome | result | answer, output |
| User correction | feedback | label, annotation |
| Restart one target | retry | re-run, re-process |

**Provider names (Gemini, OpenAI, etc.) never appear in product UI.** They live behind a `?debug=1` query that exposes a small panel with provider, prompt version, latency, and raw response. The user buys "an inspection," not "a Gemini call."

**Tone:** declarative, present tense, no exclamation points, no emoji in core flows, no marketing voice. Helpers and empty states are short instructions, not paragraphs.

Examples of correct copy:

- `Drop images here or click to choose. Up to 25.`
- `Add a reference image to begin.`
- `25 of 25 inspected · 7 found`
- `Could not inspect this target. Retry?`
- `Marked correct. The result is unchanged; your judgment is recorded.`
- `No inspections yet`
- `Now running ●`

Examples to avoid:

- ~~`Whoops! Looks like something went wrong 😬`~~
- ~~`AI Analysis Complete!`~~
- ~~`Powered by Gemini`~~
- ~~`Welcome back to Sightline 👋`~~

---

## 12. Acceptance

The web app design is right when:

1. A new user with one sentence (`inspect these for the kind of defect in this reference image`) can complete `product-spec.md` §16's acceptance test without explanation.
2. A refresh in any state lands on the same view, with the same tile order and the same filter.
3. Failed targets are visible in the same grid as successes, with a one-click retry.
4. The reference image is visible while reviewing every target.
5. No screen requires the user to know which analyzer is running.
6. The visual system is "hard to vary": changing a token in `globals.css` propagates everywhere, and no code computes a color or spacing value at runtime.
7. The home state adapts to the user's situation — empty for first-timers, library for returners, band-then-library when something is running — without the user having to choose a view or click a tab.
8. A user who left a tab open with a running inspection comes back ten minutes later and sees the band has moved on (more amber, fewer hairline) without any interaction.

If any of these fails, the design is wrong, not the user.
