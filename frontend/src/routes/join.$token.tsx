import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { services, type InterviewSession, type Participant } from "@/services";

export const Route = createFileRoute("/join/$token")({
  head: () => ({
    meta: [
      { title: "Join interview — Lattice" },
      { name: "description", content: "Join a live system design interview." },
      { property: "og:title", content: "Join interview — Lattice" },
      { property: "og:description", content: "Join a live system design interview." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Join,
});

const key = (token: string) => `lattice.guest.${token.slice(0, 12)}`;

function Join() {
  const { token } = Route.useParams();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [participant, setParticipant] = useState<Participant | null>(null);

  useEffect(() => {
    services.sessions.resolveToken(token).then(
      async ({ session }) => {
        setSession(session);
        // Rejoin after reload without asking again.
        const saved = sessionStorage.getItem(key(token));
        if (saved) {
          try {
            const list = await services.sessions.participants(session.id);
            const p = list.find((x) => x.id === saved && !x.leftAt);
            if (p) setParticipant(p);
            else sessionStorage.removeItem(key(token));
          } catch {
            // A backend restart may invalidate the saved collaboration token.
            // Leave the guest on the join form so a fresh credential can be issued.
            sessionStorage.removeItem(key(token));
          }
        }
      },
      (e: Error) => setError(e.message),
    );
  }, [token]);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { participant } = await services.sessions.joinWithToken(token, name);
      sessionStorage.setItem(key(token), participant.id);
      setParticipant(participant);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (participant && session) return <Workspace sessionId={session.id} participant={participant} />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-clay)]">
        <p className="font-mono text-xs font-semibold">lattice</p>
        {error ? (
          <div role="alert" className="mt-4">
            <h1 className="text-lg font-semibold">Can't join</h1>
            <p className="mt-1 text-sm text-muted-ink">{error}</p>
          </div>
        ) : !session ? (
          <p className="mt-4 text-sm text-muted-ink" role="status">Checking your invite…</p>
        ) : (
          <form onSubmit={join} className="mt-4 grid gap-4">
            <div>
              <h1 className="text-lg font-semibold">{session.title}</h1>
              <p className="mt-1 text-sm text-muted-ink">
                {session.state === "live" ? "The interview is live." : "The interviewer hasn't started yet — you can join and wait."}
              </p>
            </div>
            <label className="grid gap-1.5 text-sm">
              Your name
              <input
                required
                autoFocus
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-line bg-paper px-3 py-2 outline-none focus-visible:border-accent"
              />
            </label>
            <button disabled={busy} className="h-9 rounded-md bg-accent text-sm font-medium text-primary-foreground hover:bg-accent/90 disabled:opacity-50">
              {busy ? "Joining…" : "Join interview"}
            </button>
            <p className="text-xs text-muted-ink">No account needed. Audio and video happen in your usual call tool.</p>
          </form>
        )}
      </div>
    </div>
  );
}
