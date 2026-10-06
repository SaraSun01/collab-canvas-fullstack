import { Eraser, Hand, Highlighter, MousePointer2, Pencil, Spline, StickyNote, Type } from "lucide-react";

export type ToolId =
  | "select"
  | "pan"
  | "pen"
  | "highlighter"
  | "eraser"
  | "text"
  | "sticky"
  | "connector"
  | "component";

export const TOOLS: Array<{ id: Exclude<ToolId, "component">; label: string; key: string; icon: typeof Hand }> = [
  { id: "select", label: "Select", key: "v", icon: MousePointer2 },
  { id: "pan", label: "Pan", key: "h", icon: Hand },
  { id: "connector", label: "Connector", key: "c", icon: Spline },
  { id: "pen", label: "Pen", key: "p", icon: Pencil },
  { id: "highlighter", label: "Highlighter", key: "m", icon: Highlighter },
  { id: "eraser", label: "Eraser", key: "e", icon: Eraser },
  { id: "text", label: "Text", key: "t", icon: Type },
  { id: "sticky", label: "Sticky note", key: "s", icon: StickyNote },
];
