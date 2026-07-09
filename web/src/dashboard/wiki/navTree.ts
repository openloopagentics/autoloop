import type { Page } from "../types";

/** A node in the wiki nav tree. `pageId` is set for real pages; directory nodes
 *  (synthesised from path segments) leave it undefined. */
export interface NavNode {
  key: string;            // full path prefix, e.g. "auth" or "auth/passkeys.md"
  title: string;          // page title, or the directory segment for synthetic nodes
  pageId?: string;        // present only on page (leaf) nodes
  page?: Page;            // the source page, for page nodes
  order: number;          // sort key among siblings
  children: NavNode[];
}

/**
 * Build a nav tree from pages keyed by their `path` segments: "auth/passkeys.md"
 * nests the page under a synthetic "auth" directory node; missing intermediate
 * directories get synthetic nodes too. Siblings are sorted by `order` (missing =
 * 0) then title. Directory order/title derive from the segment name.
 */
export function buildNavTree(pages: Page[]): NavNode[] {
  const roots: NavNode[] = [];
  // dirKey → node, so intermediate directories are created once and reused.
  const dirs = new Map<string, NavNode>();

  const childrenOf = (parentKey: string | null): NavNode[] =>
    parentKey === null ? roots : dirs.get(parentKey)!.children;

  for (const page of pages) {
    const path = page.path ?? `${page.id}.md`;
    const segments = path.split("/");
    let parentKey: string | null = null;
    // Walk directory segments (all but the last), materialising synthetic nodes.
    for (let i = 0; i < segments.length - 1; i++) {
      const dirKey = segments.slice(0, i + 1).join("/");
      if (!dirs.has(dirKey)) {
        const node: NavNode = { key: dirKey, title: segments[i], order: 0, children: [] };
        dirs.set(dirKey, node);
        childrenOf(parentKey).push(node);
      }
      parentKey = dirKey;
    }
    childrenOf(parentKey).push({
      key: path,
      title: page.title ?? page.id,
      pageId: page.id,
      page,
      order: page.order ?? 0,
      children: [],
    });
  }

  const sortRec = (nodes: NavNode[]): NavNode[] => {
    nodes.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    for (const n of nodes) sortRec(n.children);
    return nodes;
  };
  return sortRec(roots);
}
