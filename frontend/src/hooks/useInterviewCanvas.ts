import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { applyOperation, createEmptyDoc } from "@/lib/canvas/document";
import type { CanvasDoc, CanvasElement, CanvasEnvelope, CanvasOperation } from "@/lib/canvas/types";
import { services } from "@/services";
import type {
  ConnectionState,
  InterviewSession,
  Participant,
  Presence,
  RealtimeConnection,
  ServiceError,
} from "@/services/types";

function opId() {
  return `op_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

interface HistoryEntry {
  forward: CanvasOperation;
  inverse: CanvasOperation | null;
}

export interface InterviewCanvas {
  loading: boolean;
  doc: CanvasDoc;
  session: InterviewSession | null;
  participant: Participant | null;
  presences: Presence[];
  connection: ConnectionState;
  canEdit: boolean;
  commit(op: CanvasOperation, inverse?: CanvasOperation | null): void;
  addElement(element: CanvasElement): void;
  updateElement(id: string, patch: Partial<CanvasElement>): void;
  deleteElements(ids: string[]): void;
  clearCanvas(): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  publishPresence(presence: Omit<Presence, "participantId" | "displayName" | "color">): void;
  simulateDisconnect(): void;
  refresh(): Promise<void>;
}

export function useInterviewCanvas(
  sessionId: string,
  participant: Participant | null,
): InterviewCanvas {
  const [doc, setDoc] = useState<CanvasDoc>(createEmptyDoc);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [presences, setPresences] = useState<Presence[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connected");
  const [loading, setLoading] = useState(true);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const connRef = useRef<RealtimeConnection | null>(null);
  const seenOps = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const [snapshot, loaded] = await Promise.all([
      services.canvas.getSnapshot(sessionId),
      services.sessions.get(sessionId),
    ]);
    setDoc(snapshot.doc);
    setSession(loaded);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshot, loaded] = await Promise.all([
          services.canvas.getSnapshot(sessionId),
          services.sessions.get(sessionId),
        ]);
        if (cancelled) return;
        setDoc(snapshot.doc);
        setSession(loaded);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!participant) return;
    const conn = services.realtime.connect(sessionId, participant.id, {
      onDocumentUpdate(envelopes) {
        setDoc((current) => {
          let next = current;
          for (const env of envelopes) {
            if (seenOps.current.has(env.clientOperationId)) continue;
            seenOps.current.add(env.clientOperationId);
            next = applyOperation(next, env.operation);
          }
          return next;
        });
      },
      onPresence: (list) => setPresences(list.filter((p) => p.participantId !== participant.id)),
      onConnectionState: setConnection,
      onSessionChanged: (updated) => setSession(updated),
    });
    connRef.current = conn;
    return () => {
      conn.disconnect();
      connRef.current = null;
    };
  }, [sessionId, participant]);

  const canEdit = useMemo(() => {
    if (!session || !participant) return false;
    if (session.state === "ended" || session.state === "archived") return false;
    if (participant.role === "observer") return false;
    if (participant.role === "candidate" && !session.candidateEditingEnabled) return false;
    return true;
  }, [session, participant]);

  const send = useCallback(
    (op: CanvasOperation) => {
      if (!participant) return;
      const envelope: CanvasEnvelope = {
        clientOperationId: opId(),
        actorId: participant.id,
        sentAt: Date.now(),
        operation: op,
      };
      seenOps.current.add(envelope.clientOperationId);
      connRef.current?.sendOperations([envelope]);
      void services.canvas
        .submitOperations(sessionId, participant.id, [envelope])
        .catch(async (error: ServiceError) => {
          toast.error(error.message ?? "That change could not be saved.");
          // Never silently discard server state: reload the authoritative doc.
          await refresh();
        });
    },
    [participant, sessionId, refresh],
  );

  const commit = useCallback(
    (op: CanvasOperation, inverse: CanvasOperation | null = null) => {
      setDoc((current) => applyOperation(current, op));
      setUndoStack((s) => [...s.slice(-49), { forward: op, inverse }]);
      setRedoStack([]);
      send(op);
    },
    [send],
  );

  const addElement = useCallback(
    (element: CanvasElement) => commit({ type: "add", element }, { type: "delete", ids: [element.id] }),
    [commit],
  );

  const updateElement = useCallback(
    (id: string, patch: Partial<CanvasElement>) => {
      const previous = doc.elements[id];
      const inverse: CanvasOperation | null = previous
        ? {
            type: "update",
            id,
            patch: Object.fromEntries(
              Object.keys(patch).map((key) => [key, (previous as unknown as Record<string, unknown>)[key]]),
            ) as Partial<CanvasElement>,
            at: Date.now() + 1,
          }
        : null;
      commit({ type: "update", id, patch, at: Date.now() }, inverse);
    },
    [commit, doc],
  );

  const deleteElements = useCallback(
    (ids: string[]) => {
      const removed = ids.map((id) => doc.elements[id]).filter(Boolean) as CanvasElement[];
      commit(
        { type: "delete", ids },
        removed.length === 1 && removed[0] ? { type: "add", element: removed[0] } : null,
      );
    },
    [commit, doc],
  );

  const clearCanvas = useCallback(() => commit({ type: "clear" }, null), [commit]);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const entry = stack[stack.length - 1];
      if (!entry) return stack;
      if (entry.inverse) {
        setDoc((current) => applyOperation(current, entry.inverse!));
        send(entry.inverse);
        setRedoStack((r) => [...r, entry]);
      }
      return stack.slice(0, -1);
    });
  }, [send]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      const entry = stack[stack.length - 1];
      if (!entry) return stack;
      setDoc((current) => applyOperation(current, entry.forward));
      send(entry.forward);
      setUndoStack((u) => [...u, entry]);
      return stack.slice(0, -1);
    });
  }, [send]);

  const publishPresence = useCallback(
    (presence: Omit<Presence, "participantId" | "displayName" | "color">) => {
      if (!participant) return;
      connRef.current?.sendPresence({
        participantId: participant.id,
        displayName: participant.displayName,
        color: participant.color,
        ...presence,
      });
    },
    [participant],
  );

  const simulateDisconnect = useCallback(() => {
    connRef.current?.simulateDisconnect(3000);
  }, []);

  return {
    loading,
    doc,
    session,
    participant,
    presences,
    connection,
    canEdit,
    commit,
    addElement,
    updateElement,
    deleteElements,
    clearCanvas,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    publishPresence,
    simulateDisconnect,
    refresh,
  };
}
