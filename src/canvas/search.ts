/** Find-on-board (Ctrl+F): which elements match, in reading order. */

export interface SearchItem { id: string; label: string; x: number; y: number }

const fold = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export function findMatches<T extends SearchItem>(items: T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return [];
  return items
    .filter((it) => fold(it.label).includes(q) || fold(it.id).includes(q))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Next / previous match index, wrapping; -1 when there are none. */
export function stepIndex(cur: number, count: number, dir: 1 | -1): number {
  return count === 0 ? -1 : (cur + dir + count) % count;
}
