import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { services, type Participant } from "@/services";

export const Route = createFileRoute("/room/$sessionId")({
  head: () => ({
    meta: [
      { title: "Interview workspace — Lattice" },
      { name: "description", content: "Live collaborative system design canvas." },
      { property: "og:title", content: "Interview workspace — Lattice" },
      { property: "og:description", content: "Live collaborative system design canvas." },
    ],
  }),
  component: Room,
});

function Room() {
  const { sessionId } = Route.useParams();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    services.sessions.joinAsOwner(sessionId).then(setParticipant, (e: Error) => setError(e.message));
  }, [sessionId]);

  if (error)
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-paper text-ink">
        <p>{error}</p>
        <Link to="/" className="text-sm text-accent">Back to interviews</Link>
      </div>
    );
  if (!participant) return <div className="h-screen bg-paper" />;
  return <Workspace sessionId={sessionId} participant={participant} />;
}
