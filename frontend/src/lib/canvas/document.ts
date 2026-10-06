import {
  SCHEMA_VERSION,
  type CanvasDoc,
  type CanvasElement,
  type CanvasEnvelope,
  type CanvasOperation,
} from "./types";

export function createEmptyDoc(): CanvasDoc {
  return { schemaVersion: SCHEMA_VERSION, elements: {}, order: [] };
}

export function cloneDoc(doc: CanvasDoc): CanvasDoc {
  return {
    schemaVersion: doc.schemaVersion,
    elements: { ...doc.elements },
    order: [...doc.order],
  };
}

/**
 * Applies one operation to a document. Pure: returns a new document and never
 * mutates the input. Unknown ids are ignored so that duplicated / out-of-order
 * deliveries converge instead of throwing.
 */
export function applyOperation(doc: CanvasDoc, op: CanvasOperation): CanvasDoc {
  switch (op.type) {
    case "add": {
      if (doc.elements[op.element.id]) {
        // Idempotent: re-adding the same element is a no-op.
        return doc;
      }
      const next = cloneDoc(doc);
      next.elements[op.element.id] = op.element;
      next.order.push(op.element.id);
      return next;
    }
    case "update": {
      const existing = doc.elements[op.id];
      if (!existing) return doc;
      // Last-writer-wins per element, keyed on the operation timestamp so that
      // out-of-order delivery cannot resurrect an older value.
      if (op.at < existing.updatedAt) return doc;
      const next = cloneDoc(doc);
      next.elements[op.id] = {
        ...existing,
        ...(op.patch as Partial<CanvasElement>),
        id: existing.id,
        kind: existing.kind,
        updatedAt: op.at,
      } as CanvasElement;
      return next;
    }
    case "delete": {
      const ids = new Set(op.ids);
      const next = cloneDoc(doc);
      let changed = false;
      for (const id of ids) {
        if (next.elements[id]) {
          delete next.elements[id];
          changed = true;
        }
      }
      if (!changed) return doc;
      // Connectors attached to a removed element are removed too.
      for (const [id, el] of Object.entries(next.elements)) {
        if (el.kind !== "connector") continue;
        const from = "elementId" in el.from ? el.from.elementId : null;
        const to = "elementId" in el.to ? el.to.elementId : null;
        if ((from && ids.has(from)) || (to && ids.has(to))) {
          delete next.elements[id];
          ids.add(id);
        }
      }
      next.order = next.order.filter((id) => next.elements[id]);
      return next;
    }
    case "reorder": {
      if (!doc.elements[op.id]) return doc;
      const next = cloneDoc(doc);
      next.order = next.order.filter((id) => id !== op.id);
      if (op.to === "front") next.order.push(op.id);
      else next.order.unshift(op.id);
      return next;
    }
    case "clear":
      return createEmptyDoc();
    default:
      return doc;
  }
}

export function applyOperations(doc: CanvasDoc, ops: CanvasOperation[]): CanvasDoc {
  return ops.reduce(applyOperation, doc);
}

/** Applies envelopes, skipping any client operation id already seen. */
export function applyEnvelopes(
  doc: CanvasDoc,
  envelopes: CanvasEnvelope[],
  seen: Set<string>,
): CanvasDoc {
  let next = doc;
  for (const env of envelopes) {
    if (seen.has(env.clientOperationId)) continue;
    seen.add(env.clientOperationId);
    next = applyOperation(next, env.operation);
  }
  return next;
}

export function orderedElements(doc: CanvasDoc): CanvasElement[] {
  return doc.order
    .map((id) => doc.elements[id])
    .filter((el): el is CanvasElement => Boolean(el));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function elementBounds(doc: CanvasDoc, el: CanvasElement): Box | null {
  switch (el.kind) {
    case "node":
    case "sticky":
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case "text":
      return { x: el.x, y: el.y, width: Math.max(40, el.text.length * el.size * 0.58), height: el.size * 1.4 };
    case "stroke": {
      if (el.points.length === 0) return null;
      const xs = el.points.map((p) => p[0]);
      const ys = el.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
    }
    case "connector": {
      const a = endpointPoint(doc, el.from);
      const b = endpointPoint(doc, el.to);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      return { x, y, width: Math.max(1, Math.abs(b.x - a.x)), height: Math.max(1, Math.abs(b.y - a.y)) };
    }
  }
}

export function endpointPoint(
  doc: CanvasDoc,
  endpoint: { elementId: string } | { x: number; y: number },
): { x: number; y: number } {
  if ("elementId" in endpoint) {
    const el = doc.elements[endpoint.elementId];
    if (el && (el.kind === "node" || el.kind === "sticky")) {
      return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    }
    if (el && el.kind === "text") return { x: el.x, y: el.y };
    return { x: 0, y: 0 };
  }
  return { x: endpoint.x, y: endpoint.y };
}

export function docBounds(doc: CanvasDoc): Box | null {
  const boxes = orderedElements(doc)
    .map((el) => elementBounds(doc, el))
    .filter((b): b is Box => b !== null);
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

export function hitTest(doc: CanvasDoc, point: { x: number; y: number }): CanvasElement | null {
  const els = orderedElements(doc);
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (!el) continue;
    const box = elementBounds(doc, el);
    if (!box) continue;
    const pad = el.kind === "connector" || el.kind === "stroke" ? 8 : 0;
    if (
      point.x >= box.x - pad &&
      point.x <= box.x + box.width + pad &&
      point.y >= box.y - pad &&
      point.y <= box.y + box.height + pad
    ) {
      return el;
    }
  }
  return null;
}

export function elementsInBox(doc: CanvasDoc, box: Box): CanvasElement[] {
  return orderedElements(doc).filter((el) => {
    const b = elementBounds(doc, el);
    return b ? boxesIntersect(b, box) : false;
  });
}

/** Rectangle-edge anchor used so connectors touch the border, not the centre. */
export function anchorOnBox(box: Box, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const s = Math.min(scaleX, scaleY);
  return { x: cx + dx * s, y: cy + dy * s };
}
