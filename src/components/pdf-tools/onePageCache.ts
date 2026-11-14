/**
 * Keeps the one page the page-number preview draws, copied out of its file. Copying it means
 * reading the whole file, which takes a noticeable time on a large scan, so it is done once per
 * file and page, not on every change of the options. A failed copy is not kept.
 */
export function createOnePageCache(extract: (file: Uint8Array, indices: number[]) => Promise<Uint8Array>) {
  let entry: { file: Uint8Array; pageIndex: number; page: Promise<Uint8Array> } | null = null;
  return {
    get(file: Uint8Array, pageIndex: number): Promise<Uint8Array> {
      if (entry && entry.file === file && entry.pageIndex === pageIndex) return entry.page;
      const mine = { file, pageIndex, page: extract(file, [pageIndex]) };
      entry = mine;
      mine.page.catch(() => {
        if (entry === mine) entry = null;
      });
      return mine.page;
    },
  };
}
