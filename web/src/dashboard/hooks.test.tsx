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
import { useGoals } from "./hooks";

describe("listener hooks surface errors", () => {
  it("exposes the error and stops loading when onSnapshot errors", () => {
    const { result } = renderHook(() => useGoals("t1", "web"));
    expect(result.current.error).toBe("listener boom");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });
});
