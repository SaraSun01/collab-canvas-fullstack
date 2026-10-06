import type { ElementColor } from "@/lib/canvas/types";

/** Maps semantic element colors onto design-system tokens (no raw colors). */
export const ELEMENT_FILL: Record<ElementColor, string> = {
  neutral: "var(--surface)",
  accent: "var(--accent-soft)",
  amber: "var(--amber-soft)",
  rose: "var(--rose-soft)",
};

export const ELEMENT_STROKE: Record<ElementColor, string> = {
  neutral: "var(--line)",
  accent: "var(--accent)",
  amber: "var(--amber)",
  rose: "var(--rose)",
};

export const ELEMENT_TEXT: Record<ElementColor, string> = {
  neutral: "var(--ink)",
  accent: "var(--accent)",
  amber: "var(--amber)",
  rose: "var(--rose)",
};

export const PARTICIPANT_COLOR: Record<string, string> = {
  accent: "var(--accent)",
  amber: "var(--amber)",
  rose: "var(--rose)",
  ink: "var(--ink)",
};

export function participantColor(color: string): string {
  return PARTICIPANT_COLOR[color] ?? "var(--accent)";
}
