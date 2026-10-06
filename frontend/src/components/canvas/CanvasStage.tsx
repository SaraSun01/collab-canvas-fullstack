import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, Redo2, Undo2 } from "lucide-react";

import {
  anchorOnBox,
  elementBounds,
  elementsInBox,
  endpointPoint,
  docBounds,
  hitTest,
  orderedElements,
} from "@/lib/canvas/document";
import type {
  CanvasDoc,
  CanvasElement,
  ConnectorElement,
  ElementColor,
  NodeElement,
  StickyElement,
} from "@/lib/canvas/types";
import type { Presence } from "@/services/types";
import { ELEMENT_FILL, ELEMENT_STROKE, ELEMENT_TEXT, participantColor } from "./colors";
import type { ToolId } from "./tools";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasStageProps {
  doc: CanvasDoc;
  tool: ToolId;
  pendingComponent: { type: string; label: string; description: string; width: number; height: number; color: ElementColor } | null;
  canEdit: boolean;
  selection: string[];
  presences: Presence[];
  penColor: ElementColor;
  penWidth: number;
  onSelectionChange(ids: string[]): void;
  onCreate(element: CanvasElement): void;
  onUpdate(id: string, patch: Partial<CanvasElement>): void;
  onDelete(ids: string[]): void;
  onToolConsumed(): void;
  onPointerMoveWorld(point: { x: number; y: number }): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

function newId() {
  return `el_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function CanvasStage(props: CanvasStageProps) {
  const {
    doc,
    tool,
    pendingComponent,
    canEdit,
    selection,
    presences,
    penColor,
    penWidth,
    onSelectionChange,
    onCreate,
    onUpdate,
    onDelete,
    onToolConsumed,
    onPointerMoveWorld,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draftStroke, setDraftStroke] = useState<Array<[number, number]> | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);

  const drag = useRef<
    | { mode: "pan"; startX: number; startY: number; origin: Viewport }
    | { mode: "move"; ids: string[]; last: { x: number; y: number } }
    | { mode: "resize"; id: string; start: { x: number; y: number }; box: { width: number; height: number } }
    | { mode: "marquee"; start: { x: number; y: number } }
    | { mode: "draw" }
    | null
  >(null);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / viewport.zoom + viewport.x,
        y: (clientY - rect.top) / viewport.zoom + viewport.y,
      };
    },
    [viewport],
  );

  const zoomBy = useCallback((factor: number, center?: { x: number; y: number }) => {
    setViewport((vp) => {
      const zoom = Math.min(3, Math.max(0.2, vp.zoom * factor));
      if (!center) return { ...vp, zoom };
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...vp, zoom };
      const px = (center.x - rect.left) / vp.zoom + vp.x;
      const py = (center.y - rect.top) / vp.zoom + vp.y;
      return {
        zoom,
        x: px - (center.x - rect.left) / zoom,
        y: py - (center.y - rect.top) / zoom,
      };
    });
  }, []);

  const zoomToFit = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    const bounds = docBounds(doc);
    if (!rect || !bounds) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const pad = 80;
    const zoom = Math.min(
      2,
      Math.max(0.2, Math.min(rect.width / (bounds.width + pad * 2), rect.height / (bounds.height + pad * 2))),
    );
    setViewport({
      zoom,
      x: bounds.x + bounds.width / 2 - rect.width / 2 / zoom,
      y: bounds.y + bounds.height / 2 - rect.height / 2 / zoom,
    });
  }, [doc]);

  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || doc.order.length === 0) return;
    didFit.current = true;
    zoomToFit();
  }, [doc, zoomToFit]);


  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!canEdit) return;
      const now = Date.now();
      const base = { id: newId(), createdBy: "me", createdAt: now, updatedAt: now };
      if (pendingComponent) {
        const el: NodeElement = {
          ...base,
          kind: "node",
          componentType: pendingComponent.type,
          x: snap(world.x - pendingComponent.width / 2),
          y: snap(world.y - pendingComponent.height / 2),
          width: pendingComponent.width,
          height: pendingComponent.height,
          label: pendingComponent.label,
          description: pendingComponent.description,
          color: pendingComponent.color,
        };
        onCreate(el);
        onSelectionChange([el.id]);
        onToolConsumed();
        return;
      }
      if (tool === "sticky") {
        const el: StickyElement = {
          ...base,
          kind: "sticky",
          x: snap(world.x - 70),
          y: snap(world.y - 50),
          width: 140,
          height: 100,
          text: "Note",
          color: "amber",
        };
        onCreate(el);
        onSelectionChange([el.id]);
        setEditingText(el.id);
        onToolConsumed();
        return;
      }
      if (tool === "text") {
        const el: CanvasElement = {
          ...base,
          kind: "text",
          x: snap(world.x),
          y: snap(world.y),
          text: "Label",
          size: 16,
          color: "neutral",
        };
        onCreate(el);
        onSelectionChange([el.id]);
        setEditingText(el.id);
        onToolConsumed();
      }
    },
    [canEdit, pendingComponent, tool, onCreate, onSelectionChange, onToolConsumed],
  );

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const world = toWorld(event.clientX, event.clientY);
    const hit = hitTest(doc, world);

    if (tool === "pan" || event.button === 1) {
      drag.current = { mode: "pan", startX: event.clientX, startY: event.clientY, origin: viewport };
      return;
    }

    if (tool === "pen" || tool === "highlighter") {
      if (!canEdit) return;
      drag.current = { mode: "draw" };
      setDraftStroke([[world.x, world.y]]);
      return;
    }

    if (tool === "eraser") {
      if (hit && canEdit) onDelete([hit.id]);
      return;
    }

    if (tool === "connector") {
      if (!hit || !canEdit) return;
      if (!connectFrom) {
        setConnectFrom(hit.id);
      } else if (connectFrom !== hit.id) {
        const now = Date.now();
        const connector: ConnectorElement = {
          id: newId(),
          kind: "connector",
          createdBy: "me",
          createdAt: now,
          updatedAt: now,
          from: { elementId: connectFrom },
          to: { elementId: hit.id },
          style: "elbow",
          arrowStart: false,
          arrowEnd: true,
          dashed: false,
          width: 2,
          color: "neutral",
        };
        onCreate(connector);
        onSelectionChange([connector.id]);
        setConnectFrom(null);
        onToolConsumed();
      }
      return;
    }

    if (tool === "component" || tool === "sticky" || tool === "text") {
      createAt(world);
      return;
    }

    // select tool
    if (hit) {
      const ids = event.shiftKey
        ? selection.includes(hit.id)
          ? selection.filter((id) => id !== hit.id)
          : [...selection, hit.id]
        : selection.includes(hit.id)
          ? selection
          : [hit.id];
      onSelectionChange(ids);
      if (canEdit) drag.current = { mode: "move", ids, last: world };
    } else {
      onSelectionChange([]);
      drag.current = { mode: "marquee", start: world };
      setMarquee({ x: world.x, y: world.y, w: 0, h: 0 });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const world = toWorld(event.clientX, event.clientY);
    onPointerMoveWorld(world);
    const state = drag.current;
    if (!state) return;

    if (state.mode === "pan") {
      const dx = (event.clientX - state.startX) / viewport.zoom;
      const dy = (event.clientY - state.startY) / viewport.zoom;
      setViewport({ ...state.origin, x: state.origin.x - dx, y: state.origin.y - dy });
      return;
    }
    if (state.mode === "draw") {
      setDraftStroke((points) => (points ? [...points, [world.x, world.y]] : [[world.x, world.y]]));
      return;
    }
    if (state.mode === "marquee") {
      setMarquee({
        x: Math.min(state.start.x, world.x),
        y: Math.min(state.start.y, world.y),
        w: Math.abs(world.x - state.start.x),
        h: Math.abs(world.y - state.start.y),
      });
      return;
    }
    if (state.mode === "move") {
      const dx = world.x - state.last.x;
      const dy = world.y - state.last.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
      state.last = world;
      for (const id of state.ids) {
        const el = doc.elements[id];
        if (!el) continue;
        if (el.kind === "node" || el.kind === "sticky" || el.kind === "text") {
          onUpdate(id, { x: el.x + dx, y: el.y + dy } as Partial<CanvasElement>);
        } else if (el.kind === "stroke") {
          onUpdate(id, {
            points: el.points.map(([px, py]) => [px + dx, py + dy] as [number, number]),
          } as Partial<CanvasElement>);
        }
      }
      return;
    }
    if (state.mode === "resize") {
      const el = doc.elements[state.id];
      if (!el || (el.kind !== "node" && el.kind !== "sticky")) return;
      onUpdate(state.id, {
        width: Math.max(80, snap(world.x - el.x)),
        height: Math.max(48, snap(world.y - el.y)),
      } as Partial<CanvasElement>);
    }
  };

  const handlePointerUp = () => {
    const state = drag.current;
    drag.current = null;

    if (state?.mode === "marquee" && marquee) {
      if (marquee.w > 4 || marquee.h > 4) {
        const hits = elementsInBox(doc, { x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h });
        onSelectionChange(hits.map((el) => el.id));
      }
      setMarquee(null);
    }

    if (state?.mode === "move") {
      // Snap moved elements to the grid on release.
      for (const id of state.ids) {
        const el = doc.elements[id];
        if (el && (el.kind === "node" || el.kind === "sticky" || el.kind === "text")) {
          onUpdate(id, { x: snap(el.x), y: snap(el.y) } as Partial<CanvasElement>);
        }
      }
    }

    if (state?.mode === "draw" && draftStroke && draftStroke.length > 1) {
      const now = Date.now();
      onCreate({
        id: newId(),
        kind: "stroke",
        createdBy: "me",
        createdAt: now,
        updatedAt: now,
        points: draftStroke,
        color: penColor,
        width: penWidth,
        tool: tool === "highlighter" ? "highlighter" : "pen",
      });
    }
    setDraftStroke(null);
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (event.ctrlKey || event.metaKey) {
      zoomBy(event.deltaY < 0 ? 1.1 : 0.9, { x: event.clientX, y: event.clientY });
      return;
    }
    setViewport((vp) => ({ ...vp, x: vp.x + event.deltaX / vp.zoom, y: vp.y + event.deltaY / vp.zoom }));
  };

  // Keyboard: delete, nudge, escape, zoom.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "Escape") {
        onSelectionChange([]);
        setConnectFrom(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selection.length && canEdit) {
        event.preventDefault();
        onDelete(selection);
        onSelectionChange([]);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (event.key.startsWith("Arrow") && selection.length && canEdit) {
        event.preventDefault();
        const step = event.shiftKey ? GRID * 2 : GRID;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        for (const id of selection) {
          const el = doc.elements[id];
          if (el && (el.kind === "node" || el.kind === "sticky" || el.kind === "text")) {
            onUpdate(id, { x: el.x + dx, y: el.y + dy } as Partial<CanvasElement>);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, doc, canEdit, onDelete, onSelectionChange, onUpdate, onUndo, onRedo]);

  const elements = orderedElements(doc);
  const cursor =
    tool === "pan" ? "grab" : tool === "select" ? "default" : tool === "eraser" ? "crosshair" : "crosshair";

  return (
    <div className="relative h-full w-full overflow-hidden canvas-grid bg-paper">
      <svg
        ref={svgRef}
        role="application"
        aria-label="Interview canvas"
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink)" />
          </marker>
        </defs>
        <g transform={`scale(${viewport.zoom}) translate(${-viewport.x} ${-viewport.y})`}>
          {elements.map((el) => (
            <ElementView
              key={el.id}
              doc={doc}
              element={el}
              selected={selection.includes(el.id)}
              editing={editingText === el.id}
              onStartEdit={() => canEdit && setEditingText(el.id)}
              onEndEdit={(text) => {
                setEditingText(null);
                if (text !== undefined) onUpdate(el.id, { text, label: text } as Partial<CanvasElement>);
              }}
              onResizeStart={(event) => {
                event.stopPropagation();
                if (!canEdit) return;
                drag.current = { mode: "resize", id: el.id, start: { x: 0, y: 0 }, box: { width: 0, height: 0 } };
              }}
            />
          ))}

          {draftStroke && draftStroke.length > 1 && (
            <polyline
              points={draftStroke.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke={ELEMENT_STROKE[penColor]}
              strokeWidth={penWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={tool === "highlighter" ? 0.35 : 1}
            />
          )}

          {marquee && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill="var(--accent-soft)"
              fillOpacity={0.4}
              stroke="var(--accent)"
              strokeDasharray="4 3"
            />
          )}

          {presences.map((p) =>
            p.cursor ? (
              <g key={p.participantId} transform={`translate(${p.cursor.x} ${p.cursor.y})`}>
                <path d="M0 0 L0 14 L4 11 L7 17 L9 16 L6 10 L11 10 Z" fill={participantColor(p.color)} />
                <rect x={12} y={6} rx={4} width={p.displayName.length * 6.4 + 10} height={16} fill={participantColor(p.color)} />
                <text x={17} y={18} fontSize={10} fill="var(--surface)" fontWeight={600}>
                  {p.displayName}
                </text>
              </g>
            ) : null,
          )}
        </g>
      </svg>

      {connectFrom && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-line">
          Pick a second element to connect
        </div>
      )}

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-surface px-1.5 py-1 shadow-clay ring-1 ring-line">
        <button
          type="button"
          aria-label="Undo"
          title="Undo"
          disabled={!canUndo}
          onClick={onUndo}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-line/60 disabled:opacity-40"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo"
          disabled={!canRedo}
          onClick={onRedo}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-line/60 disabled:opacity-40"
        >
          <Redo2 className="size-4" />
        </button>
        <div className="h-4 w-px bg-line" />
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomBy(0.9)}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-line/60"
        >
          <Minus className="size-4" />
        </button>
        <span className="w-12 text-center font-mono text-[11px] text-muted-foreground">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.1)}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-line/60"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom to fit"
          onClick={zoomToFit}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-line/60"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

interface ElementViewProps {
  doc: CanvasDoc;
  element: CanvasElement;
  selected: boolean;
  editing: boolean;
  onStartEdit(): void;
  onEndEdit(text?: string): void;
  onResizeStart(event: React.PointerEvent): void;
}

function ElementView({ doc, element, selected, editing, onStartEdit, onEndEdit, onResizeStart }: ElementViewProps) {
  const outline = selected ? (
    <OutlineFor doc={doc} element={element} />
  ) : null;

  if (element.kind === "connector") {
    const fromBox = "elementId" in element.from ? elementBounds(doc, doc.elements[element.from.elementId]!) : null;
    const toBox = "elementId" in element.to ? elementBounds(doc, doc.elements[element.to.elementId]!) : null;
    const fromCenter = endpointPoint(doc, element.from);
    const toCenter = endpointPoint(doc, element.to);
    const a = fromBox ? anchorOnBox(fromBox, toCenter) : fromCenter;
    const b = toBox ? anchorOnBox(toBox, fromCenter) : toCenter;
    const d =
      element.style === "elbow"
        ? `M ${a.x} ${a.y} L ${(a.x + b.x) / 2} ${a.y} L ${(a.x + b.x) / 2} ${b.y} L ${b.x} ${b.y}`
        : element.style === "curved"
          ? `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`
          : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    return (
      <g>
        <path
          d={d}
          fill="none"
          stroke={selected ? "var(--accent)" : ELEMENT_STROKE[element.color === "neutral" ? "neutral" : element.color]}
          strokeOpacity={element.color === "neutral" ? 0.55 : 1}
          strokeWidth={element.width + (selected ? 1 : 0)}
          strokeDasharray={element.dashed ? "6 4" : undefined}
          markerEnd={element.arrowEnd ? "url(#arrow)" : undefined}
          markerStart={element.arrowStart ? "url(#arrow)" : undefined}
        />
        {element.label && (
          <g>
            <rect
              x={(a.x + b.x) / 2 - element.label.length * 3.2 - 4}
              y={(a.y + b.y) / 2 - 9}
              width={element.label.length * 6.4 + 8}
              height={16}
              rx={4}
              fill="var(--paper)"
            />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 + 3}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--muted-foreground)"
            >
              {element.label}
            </text>
          </g>
        )}
      </g>
    );
  }

  if (element.kind === "stroke") {
    return (
      <g>
        <polyline
          points={element.points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={ELEMENT_STROKE[element.color]}
          strokeWidth={element.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={element.tool === "highlighter" ? 0.35 : 1}
        />
        {outline}
      </g>
    );
  }

  if (element.kind === "text") {
    return (
      <g>
        {editing ? (
          <foreignObject x={element.x} y={element.y - element.size} width={220} height={40}>
            <input
              autoFocus
              defaultValue={element.text}
              onBlur={(e) => onEndEdit(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && onEndEdit(e.currentTarget.value)}
              className="w-full rounded-md bg-surface px-1.5 py-1 text-sm ring-1 ring-accent"
            />
          </foreignObject>
        ) : (
          <text
            x={element.x}
            y={element.y}
            fontSize={element.size}
            fill={ELEMENT_TEXT[element.color]}
            onDoubleClick={onStartEdit}
          >
            {element.text}
          </text>
        )}
        {outline}
      </g>
    );
  }

  // node or sticky
  const box = element as NodeElement | StickyElement;
  const isNode = element.kind === "node";
  const label = isNode ? (element as NodeElement).label : (element as StickyElement).text;

  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={isNode ? 14 : 8}
        fill={ELEMENT_FILL[box.color]}
        stroke={selected ? "var(--accent)" : ELEMENT_STROKE[box.color]}
        strokeOpacity={box.color === "neutral" && !selected ? 1 : 0.5}
        strokeWidth={selected ? 2 : 1}
      />
      {editing ? (
        <foreignObject x={box.x + 8} y={box.y + 8} width={box.width - 16} height={30}>
          <input
            autoFocus
            defaultValue={label}
            onBlur={(e) => onEndEdit(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && onEndEdit(e.currentTarget.value)}
            className="w-full rounded-md bg-surface px-1.5 py-1 text-xs ring-1 ring-accent"
          />
        </foreignObject>
      ) : (
        <text
          x={box.x + 12}
          y={box.y + 24}
          fontSize={12}
          fontWeight={600}
          fill={ELEMENT_TEXT[box.color]}
          onDoubleClick={onStartEdit}
        >
          {label}
        </text>
      )}
      {isNode && (element as NodeElement).description && (
        <text x={box.x + 12} y={box.y + 40} fontSize={10} fill="var(--muted-foreground)">
          {(element as NodeElement).description}
        </text>
      )}
      {selected && (
        <rect
          x={box.x + box.width - 5}
          y={box.y + box.height - 5}
          width={10}
          height={10}
          rx={2}
          fill="var(--accent)"
          style={{ cursor: "nwse-resize" }}
          onPointerDown={onResizeStart}
        />
      )}
      {outline}
    </g>
  );
}

function OutlineFor({ doc, element }: { doc: CanvasDoc; element: CanvasElement }) {
  const box = elementBounds(doc, element);
  if (!box) return null;
  return (
    <rect
      x={box.x - 6}
      y={box.y - 6}
      width={box.width + 12}
      height={box.height + 12}
      fill="none"
      stroke="var(--accent)"
      strokeDasharray="4 3"
      pointerEvents="none"
    />
  );
}
