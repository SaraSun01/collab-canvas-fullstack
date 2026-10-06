import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Copy,
  Download,
  Lock,
  LockOpen,
  Play,
  RefreshCw,
  Square,
  Trash2,
  UserMinus,
  WifiOff,
} from "lucide-react";

import { CanvasStage } from "@/components/canvas/CanvasStage";
import { TOOLS, type ToolId } from "@/components/canvas/tools";
import { participantColor } from "@/components/canvas/colors";
import { useInterviewCanvas } from "@/hooks/useInterviewCanvas";
import { COMPONENT_CATEGORIES, COMPONENT_LIBRARY, type ComponentSpec } from "@/lib/canvas/palette";
import type { CanvasElement, ElementColor } from "@/lib/canvas/types";
import { services, type GuestLink, type Participant } from "@/services";
import { cn } from "@/lib/utils";
import { StateChip } from "./StateChip";

const COLORS: ElementColor[] = ["neutral", "accent", "amber", "rose"];

export function guestUrl(token: string) {
  if (typeof window === "undefined") return `/join/${token}`;
  return `${window.location.origin}/join/${token}`;
}

export function Workspace({ sessionId, participant }: { sessionId: string; participant: Participant }) {
  const canvas = useInterviewCanvas(sessionId, participant);
  const { session, doc } = canvas;
  const isHost = participant.role === "owner" || participant.role === "interviewer";
  const navigate = useNavigate();

  const [tool, setTool] = useState<ToolId>("select");
  const [pending, setPending] = useState<ComponentSpec | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [penColor, setPenColor] = useState<ElementColor>("neutral");
  const [penWidth] = useState(3);
  const [query, setQuery] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [link, setLink] = useState<GuestLink | null>(null);

  const loadMeta = useCallback(async () => {
    setParticipants(await services.sessions.participants(sessionId));
    if (isHost) setLink(await services.sessions.guestLink(sessionId));
  }, [sessionId, isHost]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta, canvas.presences.length]);

  // Candidate got removed or session ended elsewhere.
  useEffect(() => {
    if (!isHost && session?.state === "ended") toast.info("The interviewer ended this interview.");
  }, [session?.state, isHost]);

  // Tool keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]") || e.metaKey || e.ctrlKey) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) {
        setTool(t.id);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selected = selection.length === 1 ? doc.elements[selection[0]!] : undefined;

  const filtered = useMemo(
    () =>
      COMPONENT_LIBRARY.filter(
        (c) => !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.category.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  if (canvas.loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper text-sm text-muted-ink" role="status">
        Loading workspace…
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await loadMeta();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copyLink = async () => {
    const l = link ?? (await services.sessions.rotateGuestLink(sessionId));
    setLink(l);
    await navigator.clipboard?.writeText(guestUrl(l.token)).catch(() => {});
    toast.success("Candidate link copied");
  };

  const exportJson = async () => {
    const json = await services.canvas.exportJson(sessionId);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${session.title.replace(/\W+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const online = new Set([participant.id, ...canvas.presences.map((p) => p.participantId)]);
  const active = participants.filter((p) => !p.leftAt);

  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <Link to="/" className="font-mono text-xs font-semibold tracking-tight text-ink">
          lattice
        </Link>
        <span className="text-line" aria-hidden>/</span>
        <h1 className="truncate text-sm font-medium">{session.title}</h1>
        <StateChip state={session.state} />
        {!canvas.canEdit && session.state === "live" && (
          <span className="flex items-center gap-1 rounded-md bg-amber-soft px-2 py-0.5 text-xs text-amber">
            <Lock className="size-3" /> View only
          </span>
        )}
        <ConnectionBadge state={canvas.connection} />
        <div className="ml-auto flex items-center gap-1.5">
          <div className="mr-2 flex -space-x-1.5" aria-label="Participants online">
            {active.filter((p) => online.has(p.id)).map((p) => (
              <span
                key={p.id}
                title={`${p.displayName} (${p.role})`}
                className="flex size-6 items-center justify-center rounded-full border-2 border-surface text-[10px] font-semibold text-primary-foreground"
                style={{ background: participantColor(p.color) }}
              >
                {p.displayName.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <BarButton onClick={() => canvas.simulateDisconnect()} label="Simulate network drop">
            <WifiOff className="size-3.5" />
          </BarButton>
          <BarButton onClick={exportJson} label="Export JSON">
            <Download className="size-3.5" />
          </BarButton>
          {isHost && (
            <>
              <BarButton onClick={copyLink} label="Copy candidate link">
                <Copy className="size-3.5" /> <span className="hidden lg:inline">Invite</span>
              </BarButton>
              {session.state !== "live" && session.state !== "ended" && (
                <BarButton primary onClick={() => run(() => services.sessions.start(sessionId), "Interview started")} label="Start interview">
                  <Play className="size-3.5" /> Start
                </BarButton>
              )}
              {session.state === "live" && (
                <BarButton
                  danger
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm("End the interview? The canvas becomes read-only.")) return;
                      await services.sessions.end(sessionId);
                      navigate({ to: "/review/$sessionId", params: { sessionId } });
                    })
                  }
                  label="End interview"
                >
                  <Square className="size-3.5" /> End
                </BarButton>
              )}
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Tool rail */}
        <nav aria-label="Tools" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-label={`${t.label} (${t.key.toUpperCase()})`}
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-pressed={tool === t.id}
              disabled={!canvas.canEdit && t.id !== "select" && t.id !== "pan"}
              onClick={() => {
                setTool(t.id);
                setPending(null);
              }}
              className={cn(
                "flex size-9 items-center justify-center rounded-md text-muted-ink transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30",
                tool === t.id && "bg-accent-soft text-accent",
              )}
            >
              <t.icon className="size-4" />
            </button>
          ))}
          <div className="my-1 h-px w-6 bg-line" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Ink color ${c}`}
              aria-pressed={penColor === c}
              onClick={() => setPenColor(c)}
              className={cn("size-5 rounded-full border-2", penColor === c ? "border-ink" : "border-transparent")}
              style={{ background: c === "neutral" ? "var(--ink)" : `var(--${c})` }}
            />
          ))}
        </nav>

        {/* Component library */}
        <aside aria-label="Component library" className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
          <div className="border-b border-line p-2">
            <label htmlFor="lib-search" className="sr-only">Search components</label>
            <input
              id="lib-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search components"
              className="h-8 w-full rounded-md border border-line bg-paper px-2 text-xs outline-none focus-visible:border-accent"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {COMPONENT_CATEGORIES.map((cat) => {
              const items = filtered.filter((c) => c.category === cat);
              if (!items.length) return null;
              return (
                <section key={cat} className="mb-3">
                  <h2 className="mb-1 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-ink">{cat}</h2>
                  <ul className="grid gap-0.5">
                    {items.map((c) => (
                      <li key={c.type}>
                        <button
                          type="button"
                          disabled={!canvas.canEdit}
                          aria-pressed={pending?.type === c.type}
                          onClick={() => {
                            setPending(c);
                            setTool("component");
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-paper disabled:opacity-40",
                            pending?.type === c.type && "bg-accent-soft",
                          )}
                        >
                          <span className="size-2.5 rounded-sm" style={{ background: c.color === "neutral" ? "var(--line)" : `var(--${c.color})` }} />
                          <span className="flex-1 truncate">{c.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </aside>

        {/* Canvas */}
        <main className="relative min-w-0 flex-1">
          <CanvasStage
            doc={doc}
            tool={tool}
            pendingComponent={pending}
            canEdit={canvas.canEdit}
            selection={selection}
            presences={canvas.presences}
            penColor={penColor}
            penWidth={penWidth}
            onSelectionChange={setSelection}
            onCreate={(el: CanvasElement) => canvas.addElement({ ...el, createdBy: participant.id })}
            onUpdate={canvas.updateElement}
            onDelete={(ids) => {
              canvas.deleteElements(ids);
              setSelection([]);
            }}
            onToolConsumed={() => {
              setTool("select");
              setPending(null);
            }}
            onPointerMoveWorld={(point) => canvas.publishPresence({ cursor: point, selection })}
            onUndo={canvas.undo}
            onRedo={canvas.redo}
            canUndo={canvas.canUndo}
            canRedo={canvas.canRedo}
          />
          {pending && (
            <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-ink px-3 py-1 text-xs text-paper">
              Click the canvas to place {pending.label}
            </p>
          )}
        </main>

        {/* Right panel */}
        <aside aria-label="Details" className="hidden w-64 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface lg:flex">
          <Panel title="Prompt">
            <p className="text-xs leading-relaxed text-muted-ink">{session.prompt || "No prompt."}</p>
          </Panel>

          <Panel title={selected ? "Selection" : "Properties"}>
            {selected ? (
              <SelectionEditor
                element={selected}
                disabled={!canvas.canEdit}
                onChange={(patch) => canvas.updateElement(selected.id, patch)}
                onDelete={() => {
                  canvas.deleteElements([selected.id]);
                  setSelection([]);
                }}
              />
            ) : (
              <p className="text-xs text-muted-ink">
                {selection.length > 1 ? `${selection.length} elements selected` : "Select an element to edit it."}
              </p>
            )}
          </Panel>

          <Panel title={`Participants · ${active.length}`}>
            <ul className="grid gap-1.5">
              {active.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="size-2 rounded-full" style={{ background: online.has(p.id) ? participantColor(p.color) : "var(--line)" }} />
                  <span className="flex-1 truncate">
                    {p.displayName} {p.id === participant.id && <span className="text-muted-ink">(you)</span>}
                  </span>
                  <span className="font-mono text-[10px] text-muted-ink">{p.role}</span>
                  {isHost && p.role !== "owner" && (
                    <button
                      type="button"
                      aria-label={`Remove ${p.displayName}`}
                      onClick={() => run(() => services.sessions.removeParticipant(sessionId, p.id), "Participant removed")}
                      className="rounded p-0.5 text-muted-ink hover:bg-rose-soft hover:text-rose"
                    >
                      <UserMinus className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          {isHost && (
            <Panel title="Controls">
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() =>
                    run(() => services.sessions.update(sessionId, { candidateEditingEnabled: !session.candidateEditingEnabled }))
                  }
                  className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs hover:bg-paper"
                >
                  {session.candidateEditingEnabled ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
                  {session.candidateEditingEnabled ? "Candidate can edit" : "Candidate editing locked"}
                </button>
                <button
                  type="button"
                  onClick={() => run(async () => setLink(await services.sessions.rotateGuestLink(sessionId)), "New link created")}
                  className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs hover:bg-paper"
                >
                  <RefreshCw className="size-3.5" /> Rotate candidate link
                </button>
                <button
                  type="button"
                  disabled={!link}
                  onClick={() => run(() => services.sessions.revokeGuestLink(sessionId), "Link revoked")}
                  className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs text-rose hover:bg-rose-soft disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" /> Revoke link
                </button>
                {link && (
                  <code className="break-all rounded bg-paper p-1.5 font-mono text-[10px] text-muted-ink">{guestUrl(link.token)}</code>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Clear the whole canvas for everyone?")) canvas.clearCanvas();
                  }}
                  disabled={!canvas.canEdit}
                  className="rounded-md px-2 py-1 text-left text-xs text-muted-ink hover:text-rose disabled:opacity-40"
                >
                  Clear canvas
                </button>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line p-3">
      <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-ink">{title}</h2>
      {children}
    </section>
  );
}

function BarButton({
  children,
  onClick,
  label,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick(): void;
  label: string;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs font-medium hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent",
        primary && "border-accent bg-accent text-primary-foreground hover:bg-accent/90",
        danger && "border-rose bg-rose text-primary-foreground hover:bg-rose/90",
      )}
    >
      {children}
    </button>
  );
}

function ConnectionBadge({ state }: { state: string }) {
  if (state === "connected")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-ink" role="status">
        <span className="size-1.5 rounded-full bg-accent" /> Saved
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 rounded-md bg-amber-soft px-2 py-0.5 text-xs text-amber" role="status">
      <WifiOff className="size-3" /> {state === "offline" ? "Offline — changes queued" : "Reconnecting…"}
    </span>
  );
}

function SelectionEditor({
  element,
  disabled,
  onChange,
  onDelete,
}: {
  element: CanvasElement;
  disabled: boolean;
  onChange(patch: Partial<CanvasElement>): void;
  onDelete(): void;
}) {
  const textKey = element.kind === "node" ? "label" : element.kind === "connector" ? "label" : element.kind === "stroke" ? null : "text";
  const value = textKey ? ((element as unknown as Record<string, string | undefined>)[textKey] ?? "") : "";
  return (
    <div className="grid gap-2 text-xs">
      <p className="font-mono text-[10px] text-muted-ink">{element.kind}</p>
      {textKey && (
        <label className="grid gap-1">
          <span className="text-muted-ink">{textKey === "label" ? "Label" : "Text"}</span>
          <input
            key={element.id}
            defaultValue={value}
            disabled={disabled}
            onBlur={(e) => e.target.value !== value && onChange({ [textKey]: e.target.value } as Partial<CanvasElement>)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-7 rounded-md border border-line bg-paper px-2 outline-none focus-visible:border-accent"
          />
        </label>
      )}
      {element.kind === "node" && (
        <label className="grid gap-1">
          <span className="text-muted-ink">Note</span>
          <input
            key={`${element.id}-d`}
            defaultValue={element.description ?? ""}
            disabled={disabled}
            onBlur={(e) => onChange({ description: e.target.value } as Partial<CanvasElement>)}
            className="h-7 rounded-md border border-line bg-paper px-2 outline-none focus-visible:border-accent"
          />
        </label>
      )}
      <div className="flex gap-1.5" role="group" aria-label="Color">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-label={`Color ${c}`}
            aria-pressed={element.color === c}
            onClick={() => onChange({ color: c })}
            className={cn("size-5 rounded-full border-2", element.color === c ? "border-ink" : "border-line")}
            style={{ background: c === "neutral" ? "var(--surface)" : `var(--${c})` }}
          />
        ))}
      </div>
      {element.kind === "connector" && (
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={disabled} checked={element.dashed} onChange={(e) => onChange({ dashed: e.target.checked } as Partial<CanvasElement>)} />
            Dashed
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={disabled} checked={element.arrowStart} onChange={(e) => onChange({ arrowStart: e.target.checked } as Partial<CanvasElement>)} />
            Arrow at start
          </label>
          <select
            disabled={disabled}
            value={element.style}
            onChange={(e) => onChange({ style: e.target.value } as Partial<CanvasElement>)}
            className="h-7 rounded-md border border-line bg-paper px-1"
            aria-label="Connector style"
          >
            <option value="straight">Straight</option>
            <option value="elbow">Elbow</option>
            <option value="curved">Curved</option>
          </select>
        </div>
      )}
      <button type="button" disabled={disabled} onClick={onDelete} className="mt-1 flex items-center gap-1.5 text-rose disabled:opacity-40">
        <Trash2 className="size-3.5" /> Delete
      </button>
    </div>
  );
}
