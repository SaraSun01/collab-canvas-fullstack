import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, Copy, Plus, RotateCcw } from "lucide-react";

import { services, type InterviewSession } from "@/services";
import { StateChip } from "@/components/workspace/StateChip";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Interviews — Lattice" },
      { name: "description", content: "Run live, collaborative system design interviews on a shared canvas." },
      { property: "og:title", content: "Interviews — Lattice" },
      { property: "og:description", content: "Run live, collaborative system design interviews on a shared canvas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function fmt(ts: number | null) {
  return ts ? new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function Dashboard() {
  const [sessions, setSessions] = useState<InterviewSession[] | null>(null);
  const [user, setUser] = useState("");

  const load = async () => {
    setSessions(await services.sessions.list());
    setUser((await services.auth.getCurrentUser()).displayName);
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex h-12 items-center border-b border-line bg-surface px-6">
        <span className="font-mono text-xs font-semibold">lattice</span>
        <span className="ml-auto text-xs text-muted-ink">{user}</span>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Interviews</h1>
            <p className="mt-1 text-sm text-muted-ink">Create a session, share the candidate link, design together.</p>
          </div>
          <Link
            to="/new"
            className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-primary-foreground shadow-[var(--shadow-clay)] hover:bg-accent/90"
          >
            <Plus className="size-4" /> New interview
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-clay)]">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-paper/60 text-left font-mono text-[10px] uppercase tracking-wider text-muted-ink">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sessions === null && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-ink">Loading…</td></tr>
              )}
              {sessions?.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-ink">No interviews yet.</td></tr>
              )}
              {sessions?.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0 hover:bg-paper/50">
                  <td className="px-4 py-3">
                    <Link
                      to={s.state === "ended" ? "/review/$sessionId" : "/room/$sessionId"}
                      params={{ sessionId: s.id }}
                      className="font-medium hover:text-accent"
                    >
                      {s.title}
                    </Link>
                    <p className="line-clamp-1 text-xs text-muted-ink">{s.prompt}</p>
                  </td>
                  <td className="px-4 py-3"><StateChip state={s.state} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-ink">{fmt(s.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Duplicate ${s.title}`}
                        title="Duplicate"
                        onClick={async () => {
                          await services.sessions.duplicate(s.id);
                          toast.success("Duplicated");
                          void load();
                        }}
                        className="rounded p-1.5 text-muted-ink hover:bg-paper hover:text-ink"
                      >
                        <Copy className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Archive ${s.title}`}
                        title="Archive"
                        onClick={async () => {
                          await services.sessions.archive(s.id);
                          toast.success("Archived");
                          void load();
                        }}
                        className="rounded p-1.5 text-muted-ink hover:bg-paper hover:text-ink"
                      >
                        <Archive className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 flex items-center gap-1.5 text-xs text-muted-ink hover:text-ink"
        >
          <RotateCcw className="size-3" /> Refresh sessions
        </button>
      </main>
    </div>
  );
}
