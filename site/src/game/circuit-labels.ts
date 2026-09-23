// ============================================================================
// CIRCUIT LABELS — the display-name table + the collision ladder + the
// aspect-aware render canvas
// (design/circuit-map-layout-spec.md §1–§3; amends
//  design/circuit-fullscreen-page.md §2.1/§2.3).
//
// WHY THIS MODULE EXISTS (the two defects it fixes):
//   D1 — the old renderer derived the mid-tier label by splitting the published
//        name on spaces and keeping the FIRST WORD. 20 of the 30 zone names
//        start with "The", so every one of them collapsed to the article. The
//        fix is a TABLE (a display name is a distinct thing from the published
//        catalog name) plus a geometry ladder — never a string split.
//   D2 — the authored 560×760 portrait canvas on a wide desktop stage left 52%
//        of the map area dead and squeezed the labels into the remainder. The
//        fix is a render canvas derived from the STAGE aspect (authored
//        geography untouched — map.ts is read-only here).
//
// PURE MODULE: no React, no DOM, no colour, no hex literals (wcag-tests §8
// asserts that). Every number below is spec-ratified; the atlas harness
// (atlas-tests §12) machine-checks the whole table and every law.
//
// THE TWO LAWS IN ONE LINE EACH:
//   · labels never render below 11px CSS — below that they HIDE, never shrink;
//   · a node has exactly TWO display strings, `full` and `compact`, and no
//     string ever starts with an article (see DISPLAY_NAMES).
// ============================================================================

/** §1.2 — the 30-node display-name table. `node.name` / the Sheet title /
 *  `aria-label` / tooltips keep the PUBLISHED catalog name (zones.ts); these
 *  are *display names*, a distinct thing, used only by the map label layer.
 *
 *  Laws (machine-asserted in atlas-tests §12):
 *   1. no string begins with an article — a leading "The " is DROPPED;
 *   2. no two DISTINCT nodes share a string in either form (`compact === full`
 *      is lawful when the full name is already minimal);
 *   3. `full` === published name minus /^The /, except the three documented
 *      overrides marked ⟡ below;
 *   4. `compact === full` is allowed when the full name is already minimal.
 *
 *  The ⟡ overrides (the only three places full ≠ published-minus-"The"):
 *   · dark-matter-observatory → "Chorus-Held Heart": the node's MAP identity is
 *     its role (the legend reads "THE CHORUS-HELD HEART"); its published name
 *     stays in the Sheet, aria-label and tooltip.
 *   · observatories → "Observatories": the published tail ("of the Still Dark")
 *     is ~234 viewBox units at 11px — wider than any row gap on the map. The
 *     poetic name lives in the Sheet, tooltip and expedition list.
 *   · cradle → "Cradle" (published "The Cradle").
 *
 *  Head-noun traps resolved (§1.3): Wailing vs Watchtower (never "Tower");
 *  Chorus Heart vs Hearth (never "Heart" — one letter apart at 11px);
 *  Shard vs Academies (never "Sh…" twins). */
export const DISPLAY_NAMES: Record<string, { full: string; compact: string }> = {
  // ---- Burning Rim — outer (T1) ----
  "forge-valleys": { full: "Forge Valleys", compact: "Forge" },
  "rust-gardens": { full: "Rust Gardens", compact: "Rust" },
  "ash-columns": { full: "Ash Columns", compact: "Ash" },
  "quarry-edge": { full: "Quarry-Edge Works", compact: "Quarry" },
  "shard-fields": { full: "Shard Fields", compact: "Shard" },
  boneyard: { full: "Boneyard Ranges", compact: "Boneyard" },
  // ---- Burning Rim — mid (T2) ----
  "shattered-academies": { full: "Shattered Academies", compact: "Academies" },
  "murmur-sumps": { full: "Murmur Sumps", compact: "Murmur" },
  "titan-breaks": { full: "Titan Breaks", compact: "Titan" },
  "glass-harbor": { full: "Glass Harbor", compact: "Glass" },
  "wailing-towers": { full: "Wailing Towers", compact: "Wailing" },
  "quantum-facility": { full: "Quantum Research Facility", compact: "Quantum" },
  // ---- Burning Rim — deep (T3) ----
  "deep-vaults": { full: "Deep Vaults", compact: "Vaults" },
  "null-engine": { full: "Null Engine", compact: "Null" },
  "starfall-core": { full: "Starfall Core", compact: "Starfall" },
  "collider-ruins": { full: "Super-Collider Ruins", compact: "Collider" },
  // ⟡ the heart: its map identity is its role, not its published name
  "dark-matter-observatory": { full: "Chorus-Held Heart", compact: "Chorus Heart" },
  // ---- Near Ring — home-protected ----
  "hollow-warrens": { full: "Hollow Warrens", compact: "Hollow" },
  "lantern-reach": { full: "Lantern Reach", compact: "Lantern" },
  "tram-yards": { full: "Tram Yards", compact: "Tram" },
  observatories: { full: "Observatories", compact: "Observatories" }, // ⟡ shortened
  "relay-spires": { full: "Relay Spires", compact: "Relay" },
  "outer-ruins": { full: "Outer Ruins", compact: "Outer" },
  "cinder-farms": { full: "Cinder Farms", compact: "Cinder" },
  "pump-stations": { full: "Pump Stations", compact: "Pumps" },
  "sigil-plaza": { full: "Sigil Plaza", compact: "Sigil" },
  "hearth-lanes": { full: "Hearth Lanes", compact: "Hearth" },
  "grain-silos": { full: "Grain Silos", compact: "Grain" },
  "watchtower-row": { full: "Watchtower Row", compact: "Watchtower" },
  // ---- Home edge ----
  cradle: { full: "Cradle", compact: "Cradle" }, // ⟡ published "The Cradle"
};

/** §2.1 — the authored label drop below each node kind (unchanged from the
 *  live renderer: heart 42 · cradle 30 · rim 30 · near 26 viewBox units). */
export const LABEL_DY: Record<"heart" | "rim" | "near" | "cradle", number> = {
  heart: 42,
  cradle: 30,
  rim: 30,
  near: 26,
};

/** §2.1 — node circle radii (viewBox units) per kind. Single source for both
 *  the renderer's circles and the label ladder's circle-box test. */
export const LABEL_NODE_RADIUS: Record<"heart" | "rim" | "near" | "cradle", number> = {
  heart: 26,
  rim: 16,
  near: 12,
  cradle: 18,
};

/** §2.1 — the collision constants. K_CHAR is deliberately ~8% over-generous
 *  for Title Case at weight 500 in 'Segoe UI',system-ui: the width estimate
 *  over-states the real advance, so glyphs can never overlap in practice. */
export const K_CHAR = 0.58;
export const LABEL_PAD = 6; // min horizontal gap between two placed labels
export const EDGE_PAD = 4; // min gap from the canvas edge

/** §3.2 — the aspect law. BASE_* are ATLAS_CONFIG.viewBox (READ ONLY: the
 *  authored canvas is never edited; atlas-tests §11 states its layout law on
 *  these numbers). ASPECT_MAX = 1.60 is the only tunable: beyond it the web's
 *  diagonals flatten toward a straight line and stop reading as a circuit.
 *  Fallback if the wide web is disliked: ASPECT_MAX = 1.0. */
export const BASE_CANVAS = { w: 560, h: 760 } as const;
export const CENTER_X = BASE_CANVAS.w / 2;
export const ASPECT_MIN = BASE_CANVAS.w / BASE_CANVAS.h;
export const ASPECT_MAX = 1.6;

/** §3.2 — the render canvas for a stage. Inside the aspect band
 *  `canvasW = 760·stageW/stageH`, so `fit_x === fit_y` and the canvas fills
 *  the stage on both axes; outside it (ultra-wide) the aspect clamps and the
 *  map is height-fit and centred. */
export function canvasFor(stageW: number, stageH: number): { w: number; h: number; kx: number } {
  const aspectStage = stageW / Math.max(stageH, 1e-6);
  const aspect = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspectStage));
  const w = Math.round(BASE_CANVAS.h * aspect);
  return { w, h: BASE_CANVAS.h, kx: w / BASE_CANVAS.w };
}

/** §3.2 — the one affine, monotone, centre-anchored x map. `y`, every radius
 *  and every font size stay in authored units; only x is transformed, so
 *  circles stay circles and glyphs stay unstretched. */
export function canvasX(x: number, canvasW: number, kx: number): number {
  return canvasW / 2 + (x - CENTER_X) * kx;
}

/** §1.4 — the zoom tier. The tier sets TYPE SIZE and VISIBILITY only; the
 *  name string comes from the table above (a CSS class cannot know that
 *  "The Quarry-Edge Works" differs from "The Cradle"). */
export function labelTier(scale: number): "full" | "mid" | "low" {
  if (scale >= 1) return "full";
  if (scale >= 0.55) return "mid";
  return "low";
}

/** §1.4 — font size in viewBox units. At mid we keep the type AT the 11px
 *  floor (`11/scale`) and buy the room from the wide canvas + the ladder;
 *  nothing is ever rendered below 11px — below 0.55 the tier is `low` and the
 *  text is hidden, never shrunk. */
export function labelFontUnits(tier: "full" | "mid" | "low", scale: number): number {
  if (tier === "low") return 0;
  if (tier === "full") return 11;
  return Math.min(20, Math.max(11, 11 / (scale || 1)));
}

export type LabelKind = "heart" | "rim" | "near" | "cradle";

export interface LabelNode {
  id: string;
  x: number;
  y: number;
  kind: LabelKind;
  /** rim/heart nodes carry the published importance tier (map.ts). */
  importance?: { tier: 1 | 2 | 3 } | null;
  /** circle radius override (defaults to LABEL_NODE_RADIUS[kind]). */
  r?: number;
}

export interface LabelPlacement {
  text: string;
  /** label centre in canvas units (x already through canvasX). */
  cx: number;
  cy: number;
}

export interface ResolveLabelsOptions {
  tier: "full" | "mid" | "low";
  fontUnits: number;
  canvasW: number;
  kx: number;
  selectedId?: string | null;
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function widthOf(text: string, fontUnits: number): number {
  return text.length * K_CHAR * fontUnits;
}

/** Label rect in canvas units (§2.1) — shared with atlas-tests §12 so the
 *  "no two visible labels overlap" proof measures exactly what renders. */
export function labelRect(node: LabelNode, text: string, canvasW: number, kx: number, fontUnits: number): Rect {
  const cx = canvasX(node.x, canvasW, kx);
  const dy = LABEL_DY[node.kind];
  const w = widthOf(text, fontUnits);
  return {
    x0: cx - w / 2,
    x1: cx + w / 2,
    y0: node.y + dy - fontUnits,
    y1: node.y + dy + 0.25 * fontUnits,
  };
}

function priorityRank(n: LabelNode): number {
  if (n.kind === "heart") return 1;
  if (n.kind === "cradle") return 2;
  if (n.kind === "rim") return n.importance?.tier === 3 ? 3 : n.importance?.tier === 2 ? 4 : 5;
  return 6; // near
}

/**
 * §2.1 — the collision rule: a deterministic priority ladder with a per-node
 * two-string ladder, `full` → `compact` → hidden. No offsets, no text below
 * 11px.
 *
 *   1. `tier === "low"` → no labels at all.
 *   2. Priority: selected → heart → cradle → rim T3 → rim T2 → rim T1 → near;
 *      ties broken by (y, canvasX, id) — deterministic, no ties.
 *   3. Pass 1 walks that order trying `full`; pass 2 retries the still-unplaced
 *      with `compact`. Two passes (not "try compact immediately") so a
 *      low-priority long name can never block a high-priority neighbour that
 *      would have fitted had the first taken its compact form.
 *   4. A label places only if: its rect is inside [EDGE_PAD, canvasW−EDGE_PAD];
 *      it clears every PLACED rect on a vertically-overlapping band (inflated
 *      horizontally by LABEL_PAD); and it clears every other node's circle box
 *      (inflated by 2).
 *   5. Still unplaced → no label. The node keeps its circle, ring, pip, ★,
 *      aria-label, tooltip and Sheet — nothing else changes.
 */
export function resolveLabels(
  nodes: readonly LabelNode[],
  opts: ResolveLabelsOptions,
): Map<string, LabelPlacement> {
  const out = new Map<string, LabelPlacement>();
  const { tier, fontUnits, canvasW, kx, selectedId } = opts;
  if (tier === "low" || fontUnits <= 0) return out;

  const order = [...nodes].sort((a, b) => {
    const sa = (a.id === selectedId ? 0 : 1) - (b.id === selectedId ? 0 : 1);
    const ra = priorityRank(a) - priorityRank(b);
    const ta = a.y - b.y;
    const xa = canvasX(a.x, canvasW, kx) - canvasX(b.x, canvasW, kx);
    return sa || ra || ta || xa || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  const placed: Rect[] = [];
  const circleBoxes = nodes.map((n) => {
    const r = n.r ?? LABEL_NODE_RADIUS[n.kind];
    const cx = canvasX(n.x, canvasW, kx);
    return { id: n.id, x0: cx - r - 2, x1: cx + r + 2, y0: n.y - r - 2, y1: n.y + r + 2 };
  });

  const fits = (n: LabelNode, text: string): Rect | null => {
    const rect = labelRect(n, text, canvasW, kx, fontUnits);
    if (rect.x0 < EDGE_PAD || rect.x1 > canvasW - EDGE_PAD) return null;
    for (const p of placed) {
      const yOverlap = rect.y0 < p.y1 && p.y0 < rect.y1;
      if (!yOverlap) continue;
      // inflate horizontally by LABEL_PAD: the gap between two placed labels
      const xClear = rect.x0 - LABEL_PAD >= p.x1 || p.x0 - LABEL_PAD >= rect.x1;
      if (!xClear) return null;
    }
    for (const c of circleBoxes) {
      if (c.id === n.id) continue; // a label never has to clear its own node
      const hit = rect.x0 < c.x1 && c.x0 < rect.x1 && rect.y0 < c.y1 && c.y0 < rect.y1;
      if (hit) return null;
    }
    return rect;
  };

  const tryPass = (which: "full" | "compact") => {
    for (const n of order) {
      if (out.has(n.id)) continue;
      const names = DISPLAY_NAMES[n.id];
      if (!names) continue;
      const text = names[which];
      const rect = fits(n, text);
      if (!rect) continue;
      placed.push(rect);
      out.set(n.id, { text, cx: (rect.x0 + rect.x1) / 2, cy: (rect.y0 + rect.y1) / 2 });
    }
  };
  tryPass("full");
  tryPass("compact");
  return out;
}
