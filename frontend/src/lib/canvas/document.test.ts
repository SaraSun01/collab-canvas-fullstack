import { describe, expect, it } from "vitest";
import { applyEnvelopes, applyOperation, createEmptyDoc } from "./document";
import type { CanvasEnvelope, NodeElement } from "./types";

const node = (id: string): NodeElement => ({
  id, kind: "node", componentType: "service", x: 0, y: 0, width: 100, height: 50,
  label: id, color: "neutral", createdBy: "a", createdAt: 1, updatedAt: 1,
});

describe("canvas document", () => {
  it("adds idempotently", () => {
    let doc = applyOperation(createEmptyDoc(), { type: "add", element: node("a") });
    doc = applyOperation(doc, { type: "add", element: node("a") });
    expect(doc.order).toEqual(["a"]);
  });

  it("converges on concurrent updates regardless of delivery order", () => {
    const base = applyOperation(createEmptyDoc(), { type: "add", element: node("a") });
    const u1 = { type: "update" as const, id: "a", patch: { label: "one" }, at: 10 };
    const u2 = { type: "update" as const, id: "a", patch: { label: "two" }, at: 20 };
    const x = applyOperation(applyOperation(base, u1), u2);
    const y = applyOperation(applyOperation(base, u2), u1);
    expect((x.elements["a"] as NodeElement).label).toBe("two");
    expect((y.elements["a"] as NodeElement).label).toBe("two");
  });

  it("cascades deletes to connectors", () => {
    let doc = applyOperation(createEmptyDoc(), { type: "add", element: node("a") });
    doc = applyOperation(doc, { type: "add", element: node("b") });
    doc = applyOperation(doc, {
      type: "add",
      element: {
        id: "c", kind: "connector", from: { elementId: "a" }, to: { elementId: "b" }, style: "straight",
        arrowStart: false, arrowEnd: true, dashed: false, width: 2, color: "neutral",
        createdBy: "a", createdAt: 1, updatedAt: 1,
      },
    });
    doc = applyOperation(doc, { type: "delete", ids: ["a"] });
    expect(doc.elements["c"]).toBeUndefined();
    expect(doc.order).toEqual(["b"]);
  });

  it("drops duplicate envelopes", () => {
    const env: CanvasEnvelope = { clientOperationId: "op1", actorId: "a", sentAt: 1, operation: { type: "add", element: node("a") } };
    const seen = new Set<string>();
    const doc = applyEnvelopes(createEmptyDoc(), [env, env], seen);
    expect(doc.order).toEqual(["a"]);
  });
});
