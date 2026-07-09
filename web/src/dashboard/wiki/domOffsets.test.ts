import { describe, it, expect } from "vitest";
import { offsetInContainer } from "./domOffsets";

/** Build a container and return it; caller inspects nodes. */
function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("offsetInContainer", () => {
  it("maps a text-node position to a flat offset", () => {
    const el = container("Hello world");
    const text = el.firstChild!;
    expect(offsetInContainer(el, text, 6)).toBe(6);
  });

  it("accumulates across sibling elements", () => {
    const el = container("<p>abc</p><p>defg</p>");
    const second = el.children[1].firstChild!; // "defg"
    // textContent = "abcdefg"; offset 2 into "defg" → 3 + 2 = 5
    expect(offsetInContainer(el, second, 2)).toBe(5);
  });

  it("handles an element endpoint (child index)", () => {
    const el = container("<p>abc</p><p>defg</p>");
    // Boundary before child index 1 of the container → after "abc" = 3.
    expect(offsetInContainer(el, el, 1)).toBe(3);
  });

  it("handles an endpoint after the last child of an element", () => {
    const el = container("<p>abc</p><p>defg</p>");
    const p = el.children[0]; // "abc"
    // Offset === childNodes.length → end of <p> = 3.
    expect(offsetInContainer(el, p, p.childNodes.length)).toBe(3);
  });

  it("round-trips a selection of the middle word", () => {
    const el = container("one <strong>two</strong> three");
    const flat = el.textContent!; // "one two three"
    const strongText = el.querySelector("strong")!.firstChild!;
    const start = offsetInContainer(el, strongText, 0);
    const end = offsetInContainer(el, strongText, 3);
    expect(flat.slice(start!, end!)).toBe("two");
  });

  it("returns null for a node outside the container", () => {
    const el = container("inside");
    const other = document.createElement("span");
    other.textContent = "outside";
    expect(offsetInContainer(el, other.firstChild!, 1)).toBeNull();
  });
});
