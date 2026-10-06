import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CanvasStage } from "@/components/canvas/CanvasStage";
import { StateChip } from "@/components/workspace/StateChip";
import { services, type AuditEvent, type CanvasSnapshot, type InterviewSession } from "@/services";

export const Route = createFileRoute("/review/$sessionId")({
  head: () => ({
    meta: [
      { title: "Interview review — Lattice" },
      { name: "description", content: "Read-only final canvas and timeline of an ended interview." },
      { property: "og:title", content: "Interview review — Lattice" },
      { property: "og:description", content: "Read-only final canvas and timeline of an ended interview." },
    ],
  }),
  component: Review,
});

function Review() {
  const { sessionId } = Route.useParams();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [snap, setSnap] = useState<CanvasSnapshot | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [selection, setSelection] = useState<string[]>([]);

  useEffect(() => {
    void Promise.all([
      services.sessions.get(sessionId),
      services.canvas.getSnapshot(sessionId),
      services.sessions.auditLog(sessionId),
    ]).then(([s, c, a]) => {
      setSession(s);
      setSnap(c);
      setAudit(a);
    });
  }, [sessionId]);

  if (!session || !snap) return <div className="h-screen bg-paper" />;
  const noop = () => {};
  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <header className="flex h-12 items-center gap-3 border-b border-line bg-surface px-3">
        <Link to="/" className="font-mono text-xs font-semibold">lattice</Link>
        <h1 className="text-sm font-medium">{session.title}</h1>
        <StateChip state={session.state} />
        <span className="text-xs text-muted-ink">Read-only final snapshot</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex-1">
          <CanvasStage
            doc={snap.doc}
            tool="select"
            pendingComponent={null}
            canEdit={false}
            selection={selection}
            presences={[]}
            penColor="neutral"
            penWidth={3}
            onSelectionChange={setSelection}
            onCreate={noop}
            onUpdate={noop}
            onDelete={noop}
            onToolConsumed={noop}
            onPointerMoveWorld={noop}
            onUndo={noop}
            onRedo={noop}
            canUndo={false}
            canRedo={false}
          />
        </main>
        <aside className="w-64 overflow-y-auto border-l border-line bg-surface p-3" aria-label="Timeline">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-ink">Timeline</h2>
          <ol className="grid gap-2 text-xs">
            {audit.map((a) => (
              <li key={a.id}>
                <span className="font-mono text-ink">{a.type}</span>
                <span className="block text-muted-ink">{new Date(a.at).toLocaleString()}</span>
              </li>
            ))}
            {audit.length === 0 && <li className="text-muted-ink">No events recorded.</li>}
          </ol>
        </aside>
      </div>
    </div>
  );
}
