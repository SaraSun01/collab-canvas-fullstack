import type { SessionState } from "@/services";
import { cn } from "@/lib/utils";

const STYLES: Record<SessionState, string> = {
  live: "bg-accent-soft text-accent",
  draft: "bg-paper text-muted-ink border border-line",
  ended: "bg-amber-soft text-amber",
  archived: "bg-paper text-muted-ink",
};

export function StateChip({ state }: { state: SessionState }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider", STYLES[state])}>
      {state === "live" && <span className="live-dot size-1.5 rounded-full bg-accent" />}
      {state}
    </span>
  );
}
