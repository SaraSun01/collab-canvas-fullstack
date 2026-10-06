import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { services } from "@/services";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "New interview — Lattice" },
      { name: "description", content: "Set up a new system design interview session." },
      { property: "og:title", content: "New interview — Lattice" },
      { property: "og:description", content: "Set up a new system design interview session." },
    ],
  }),
  component: NewSession,
});

function NewSession() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(45);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const s = await services.sessions.create({ title, prompt, durationMinutes: duration });
    await services.sessions.rotateGuestLink(s.id);
    navigate({ to: "/room/$sessionId", params: { sessionId: s.id } });
  };

  const field = "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus-visible:border-accent";
  return (
    <div className="min-h-screen bg-paper px-6 py-12 text-ink">
      <form onSubmit={submit} className="mx-auto grid max-w-lg gap-5 rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-clay)]">
        <div>
          <Link to="/" className="text-xs text-muted-ink hover:text-ink">← Interviews</Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">New interview</h1>
        </div>
        <label className="grid gap-1.5 text-sm">
          Title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Design a news feed" className={field} />
        </label>
        <label className="grid gap-1.5 text-sm">
          Prompt shown to the candidate
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1.5 text-sm">
          Duration (minutes)
          <input type="number" min={10} max={180} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={field} />
        </label>
        <button disabled={busy} className="h-9 rounded-md bg-accent text-sm font-medium text-primary-foreground hover:bg-accent/90 disabled:opacity-50">
          {busy ? "Creating…" : "Create and open workspace"}
        </button>
      </form>
    </div>
  );
}
