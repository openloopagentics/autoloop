import { describe, it, expect, vi } from "vitest";

// Mock firebase so onSnapshot drives the listener's error callback.
vi.mock("../firebase", () => ({ auth: { currentUser: { uid: "u1" } }, db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  collectionGroup: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  documentId: vi.fn(() => "id"),
  limit: vi.fn(() => "limit"),
  orderBy: vi.fn(() => "orderBy"),
  query: vi.fn(() => ({})),
  where: vi.fn(() => "where"),
  onSnapshot: vi.fn((_ref: unknown, _next: unknown, err: (e: Error) => void) => {
    err(new Error("listener boom"));
    return () => {};
  }),
}));

import { renderHook } from "@testing-library/react";
import { collection, documentId, orderBy } from "firebase/firestore";
import { useComments, useGoals, usePages } from "./hooks";

describe("listener hooks surface errors", () => {
  it("exposes the error and stops loading when onSnapshot errors", () => {
    const { result } = renderHook(() => useGoals("t1", "web"));
    expect(result.current.error).toBe("listener boom");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });
});

describe("usePages", () => {
  it("subscribes to the project pages collection, ordered by 'order'", () => {
    renderHook(() => usePages("t1", "web"));
    expect(collection).toHaveBeenCalledWith({}, "teams", "t1", "projects", "web", "pages");
    expect(orderBy).toHaveBeenCalledWith("order");
  });
});

describe("useComments", () => {
  it("subscribes to the project comments collection, ordered by documentId()", () => {
    renderHook(() => useComments("t1", "web"));
    expect(collection).toHaveBeenCalledWith({}, "teams", "t1", "projects", "web", "comments");
    expect(documentId).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalledWith("id");
  });
});
