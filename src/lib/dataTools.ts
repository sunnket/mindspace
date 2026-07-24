/* ------------------------------------------------------------------
   Data tools — the search / sort / filter / hide behaviour shared by
   every block on the canvas that shows rows of data.

   The roadmap, the table, the chart and the live metric all hold their
   data differently, so none of them can share a component. What they
   CAN share is the meaning of "sorted by this column, descending" and
   "only rows matching this", which is what lives here: pure functions
   over a normalised { id, cells } row, plus the small serialisable
   view-state that a block stores in `style` so a sort survives a
   reload and reaches collaborators.

   Nothing here touches React or the store on purpose — it is all
   testable in isolation and reusable by whatever block comes next.
   ------------------------------------------------------------------ */

/** How a column's values compare and render. */
export type ColumnKind = 'text' | 'number' | 'select' | 'person' | 'date' | 'check';

export interface DataColumn {
  id: string;
  name: string;
  kind: ColumnKind;
  /** Allowed values for select/person columns, with their pill colour. */
  options?: { label: string; color: string }[];
  width?: number;
}

/** One row, normalised: values keyed by column id. */
export interface DataRow {
  id: string;
  cells: Record<string, string>;
}

export type SortDir = 'asc' | 'desc';

export interface SortRule {
  columnId: string;
  dir: SortDir;
}

export type FilterOp = 'is' | 'is-not' | 'contains' | 'not-empty' | 'empty' | 'gt' | 'lt';

export interface FilterRule {
  columnId: string;
  op: FilterOp;
  value: string;
}

/** Everything a block remembers about how it is being LOOKED at. */
export interface ViewState {
  search: string;
  sort: SortRule | null;
  filters: FilterRule[];
  /** Column ids the user has hidden. */
  hidden: string[];
}

export const EMPTY_VIEW: ViewState = { search: '', sort: null, filters: [], hidden: [] };

/** Read a view out of an object's `style`, tolerating anything malformed. */
export function readView(raw: unknown): ViewState {
  const v = (raw || {}) as Partial<ViewState>;
  const sort =
    v.sort && typeof v.sort === 'object' && typeof (v.sort as SortRule).columnId === 'string'
      ? { columnId: (v.sort as SortRule).columnId, dir: (v.sort as SortRule).dir === 'desc' ? 'desc' as const : 'asc' as const }
      : null;
  return {
    search: typeof v.search === 'string' ? v.search : '',
    sort,
    filters: Array.isArray(v.filters)
      ? v.filters.filter((f): f is FilterRule => !!f && typeof f.columnId === 'string' && typeof f.op === 'string')
      : [],
    hidden: Array.isArray(v.hidden) ? v.hidden.filter((h): h is string => typeof h === 'string') : [],
  };
}

/** True when a view is doing nothing — used to decide whether to shout about it. */
export function viewIsActive(v: ViewState): boolean {
  return v.search.trim() !== '' || v.sort !== null || v.filters.length > 0 || v.hidden.length > 0;
}

/* ----------------------------- comparing ----------------------------- */

/** Numbers sort as numbers, dates as dates, everything else as text. */
function compareValues(a: string, b: string, kind: ColumnKind): number {
  const ea = a.trim() === '';
  const eb = b.trim() === '';
  // Blanks always sink, in both directions — an empty cell is not a small
  // value, it's a missing one, and burying it is what people expect.
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;

  if (kind === 'number' || kind === 'check') {
    const na = parseFloat(a.replace(/[^0-9.eE+-]/g, ''));
    const nb = parseFloat(b.replace(/[^0-9.eE+-]/g, ''));
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
  }
  if (kind === 'date') {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (!isNaN(da) && !isNaN(db)) return da - db;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * A select column sorts by the ORDER ITS OPTIONS ARE DEFINED IN, not
 * alphabetically. "High, Medium, Low" is the whole point of a priority
 * column; sorting it to "High, Low, Medium" would be technically correct
 * and completely useless.
 */
function optionRank(col: DataColumn, value: string): number {
  if (!col.options) return -1;
  const i = col.options.findIndex((o) => o.label.toLowerCase() === value.trim().toLowerCase());
  return i === -1 ? col.options.length : i;
}

export function compareRows(a: DataRow, b: DataRow, col: DataColumn, dir: SortDir): number {
  const av = a.cells[col.id] ?? '';
  const bv = b.cells[col.id] ?? '';
  let n: number;
  if ((col.kind === 'select' || col.kind === 'person') && col.options?.length) {
    const ra = optionRank(col, av);
    const rb = optionRank(col, bv);
    n = ra === rb ? compareValues(av, bv, col.kind) : ra - rb;
  } else {
    n = compareValues(av, bv, col.kind);
  }
  return dir === 'desc' ? -n : n;
}

/* ----------------------------- filtering ----------------------------- */

export function rowMatchesFilter(row: DataRow, rule: FilterRule): boolean {
  const v = (row.cells[rule.columnId] ?? '').trim();
  const target = rule.value.trim();
  switch (rule.op) {
    case 'is': return v.toLowerCase() === target.toLowerCase();
    case 'is-not': return v.toLowerCase() !== target.toLowerCase();
    case 'contains': return v.toLowerCase().includes(target.toLowerCase());
    case 'not-empty': return v !== '';
    case 'empty': return v === '';
    // Numeric comparisons. A cell that isn't a number can't satisfy one —
    // dropping it beats silently treating "n/a" as zero.
    case 'gt':
    case 'lt': {
      const a = parseFloat(v.replace(/[^0-9.eE+-]/g, ''));
      const b = parseFloat(target.replace(/[^0-9.eE+-]/g, ''));
      if (isNaN(a) || isNaN(b)) return false;
      return rule.op === 'gt' ? a > b : a < b;
    }
    default: return true;
  }
}

/** Free-text search across every visible cell of a row. */
export function rowMatchesSearch(row: DataRow, q: string, cols: DataColumn[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return cols.some((c) => (row.cells[c.id] ?? '').toLowerCase().includes(needle));
}

/**
 * Apply a whole view to a row set.
 *
 * Returns the rows WITH their original index attached, because a block still
 * has to write back to the underlying array when you edit a cell — a filtered,
 * sorted view is a lens, never a reordering of the stored data. Losing that
 * mapping is how a sorted table edits the wrong row.
 */
export function applyView(
  rows: DataRow[],
  cols: DataColumn[],
  view: ViewState
): { row: DataRow; index: number }[] {
  const visibleCols = cols.filter((c) => !view.hidden.includes(c.id));
  const byId = new Map(cols.map((c) => [c.id, c]));

  let out = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => rowMatchesSearch(row, view.search, visibleCols))
    .filter(({ row }) => view.filters.every((f) => rowMatchesFilter(row, f)));

  if (view.sort) {
    const col = byId.get(view.sort.columnId);
    if (col) {
      const dir = view.sort.dir;
      // Stable: equal rows keep the order the user put them in.
      out = out
        .map((e, i) => ({ e, i }))
        .sort((p, q) => compareRows(p.e.row, q.e.row, col, dir) || p.i - q.i)
        .map(({ e }) => e);
    }
  }
  return out;
}

/* ------------------------- roadmap presets ------------------------- */

/** Colour ramp reused by status/priority pills so every board reads the same. */
export const PILL_COLORS = {
  slate: '#8A8F98',
  blue: '#4C7DF0',
  amber: '#D99026',
  red: '#DC5A4B',
  green: '#2F9E6E',
  violet: '#8B5FBF',
  pink: '#D9539B',
  teal: '#2FA3A3',
} as const;

export const STATUS_OPTIONS = [
  { label: 'To do', color: PILL_COLORS.slate },
  { label: 'In progress', color: PILL_COLORS.blue },
  { label: 'In review', color: PILL_COLORS.violet },
  { label: 'Blocked', color: PILL_COLORS.red },
  { label: 'Done', color: PILL_COLORS.green },
];

export const PRIORITY_OPTIONS = [
  { label: 'Urgent', color: PILL_COLORS.red },
  { label: 'High', color: PILL_COLORS.amber },
  { label: 'Medium', color: PILL_COLORS.blue },
  { label: 'Low', color: PILL_COLORS.slate },
];

/** Deterministic avatar colour, so the same person is the same colour forever. */
export function personColor(name: string): string {
  const ramp = Object.values(PILL_COLORS);
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ramp[(h >>> 0) % ramp.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** A fresh roadmap: the columns from the reference, with sensible rows. */
export function newRoadmapColumns(): DataColumn[] {
  return [
    { id: 'title', name: 'Title', kind: 'text', width: 270 },
    { id: 'status', name: 'Status', kind: 'select', options: STATUS_OPTIONS, width: 130 },
    { id: 'priority', name: 'Priority', kind: 'select', options: PRIORITY_OPTIONS, width: 120 },
    { id: 'assignee', name: 'Assignee', kind: 'person', options: [], width: 150 },
    { id: 'estimate', name: 'Estimate', kind: 'number', width: 110 },
  ];
}

export function newRoadmapRows(): DataRow[] {
  return Array.from({ length: 3 }, (_, i) => ({
    id: `r${Date.now().toString(36)}${i}`,
    cells: { title: '', status: 'To do', priority: 'Medium', assignee: '', estimate: '' },
  }));
}

export function makeRowId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
