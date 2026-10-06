export const SCHEMA_VERSION = 1;

export type ElementColor = "neutral" | "accent" | "amber" | "rose";

export interface BaseElement {
  id: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodeElement extends BaseElement {
  kind: "node";
  componentType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  description?: string;
  color: ElementColor;
}

export interface StickyElement extends BaseElement {
  kind: "sticky";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: ElementColor;
}

export interface TextElement extends BaseElement {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  color: ElementColor;
}

export type ConnectorEndpoint = { elementId: string } | { x: number; y: number };

export interface ConnectorElement extends BaseElement {
  kind: "connector";
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  style: "straight" | "elbow" | "curved";
  arrowStart: boolean;
  arrowEnd: boolean;
  dashed: boolean;
  width: number;
  label?: string;
  color: ElementColor;
}

export interface StrokeElement extends BaseElement {
  kind: "stroke";
  points: Array<[number, number]>;
  color: ElementColor;
  width: number;
  tool: "pen" | "highlighter";
}

export type CanvasElement =
  | NodeElement
  | StickyElement
  | TextElement
  | ConnectorElement
  | StrokeElement;

export interface CanvasDoc {
  schemaVersion: number;
  elements: Record<string, CanvasElement>;
  /** Draw order, bottom to top. */
  order: string[];
}

export type CanvasOperation =
  | { type: "add"; element: CanvasElement }
  | { type: "update"; id: string; patch: Partial<CanvasElement>; at: number }
  | { type: "delete"; ids: string[] }
  | { type: "reorder"; id: string; to: "front" | "back" }
  | { type: "clear" };

export interface CanvasEnvelope {
  /** Unique per client operation; used to drop duplicates. */
  clientOperationId: string;
  actorId: string;
  sentAt: number;
  operation: CanvasOperation;
}
