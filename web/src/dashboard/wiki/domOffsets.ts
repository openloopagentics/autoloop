/**
 * Map a DOM position (node + offset within it) to a character offset into the
 * container's flattened `textContent`, by walking text nodes in document order and
 * summing their lengths. Used to turn a user selection Range into the [start, end)
 * offsets an Anchor is built from. Returns null if the position isn't in the container.
 *
 * A Range endpoint is either a text node (offset = char index within it) or an
 * element (offset = child index, i.e. the boundary before child N). We resolve the
 * element case by summing every text node that lies strictly before that boundary.
 */
export function offsetInContainer(container: Node, node: Node, offsetInNode: number): number | null {
  if (!container.contains(node) && node !== container) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    return sumTextBefore(container, node) + offsetInNode;
  }

  // Element endpoint: the boundary sits before child index `offsetInNode`.
  const boundary = node.childNodes[offsetInNode] ?? null;
  if (boundary === null) {
    // Boundary is after the element's last child → count all text within the element,
    // plus everything before the element itself.
    return sumTextBefore(container, node) + textLength(node);
  }
  return sumTextBefore(container, boundary);
}

/** Total text length of all text nodes that appear before `node` in `container`. */
function sumTextBefore(container: Node, node: Node): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
    const pos = node.compareDocumentPosition(tn);
    // tn is before `node`, or `node` contains tn (tn is a descendant, so it precedes
    // `node`'s own boundary only when node is an element — but a text `node` never
    // contains anything, so CONTAINED_BY handles the element-descendant case).
    const before =
      (pos & Node.DOCUMENT_POSITION_PRECEDING) !== 0 &&
      (pos & Node.DOCUMENT_POSITION_CONTAINS) === 0;
    if (tn === node || before) {
      if (tn === node) return total;
      total += (tn.textContent ?? "").length;
    }
  }
  return total;
}

/** Total text length inside `node` (0 for an empty element). */
function textLength(node: Node): number {
  return (node.textContent ?? "").length;
}
