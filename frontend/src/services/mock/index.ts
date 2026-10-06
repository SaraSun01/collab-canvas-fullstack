import { applyOperation } from "@/lib/canvas/document";
import type { CanvasEnvelope } from "@/lib/canvas/types";
import {
  ServiceError,
  type AuditEvent,
  type GuestLink,
  type InterviewSession,
  type Participant,
  type Presence,
  type RealtimeConnection,
  type RealtimeHandlers,
  type Services,
} from "../types";
import { loadDb, randomId, randomToken, saveDb, seedDb, type MockDb } from "./store";

const LATENCY_MS = 60;
const MAX_PARTICIPANTS = 10;

function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

interface Room {
  handlers: Map<string, RealtimeHandlers>;
  presence: Map<string, Presence>;
  channel: BroadcastChannel | null;
}

export class MockBackend implements Services {
  private db: MockDb;
  private rooms = new Map<string, Room>();

  constructor(db?: MockDb) {
    this.db = db ?? loadDb();
  }

  /** Test helper: start from a deterministic, in-memory database. */
  static forTests(): MockBackend {
    return new MockBackend(seedDb(1_700_000_000_000));
  }

  private persist() {
    saveDb(this.db);
  }

  private audit(sessionId: string, type: string) {
    const event: AuditEvent = {
      id: randomId("aud"),
      sessionId,
      type,
      actor: this.db.user.displayName,
      at: Date.now(),
    };
    this.db.audit.push(event);
  }

  private requireSession(id: string): InterviewSession {
    const session = this.db.sessions.find((s) => s.id === id);
    if (!session) throw new ServiceError("not_found", "That interview does not exist.");
    return session;
  }

  private room(sessionId: string): Room {
    let room = this.rooms.get(sessionId);
    if (!room) {
      let channel: BroadcastChannel | null = null;
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(`lattice-room-${sessionId}`);
        channel.onmessage = (event) => {
          const data = event.data as
            | { kind: "ops"; envelopes: CanvasEnvelope[] }
            | { kind: "presence"; presence: Presence }
            | { kind: "session"; session: InterviewSession };
          if (data.kind === "ops") {
            this.applyLocal(sessionId, data.envelopes, false);
            this.fanOut(sessionId, (h) => h.onDocumentUpdate?.(data.envelopes));
          } else if (data.kind === "presence") {
            room!.presence.set(data.presence.participantId, data.presence);
            this.broadcastPresence(sessionId);
          } else if (data.kind === "session") {
            const idx = this.db.sessions.findIndex((s) => s.id === sessionId);
            if (idx >= 0) this.db.sessions[idx] = data.session;
            this.fanOut(sessionId, (h) => h.onSessionChanged?.(data.session));
          }
        };
      }
      room = { handlers: new Map(), presence: new Map(), channel };
      this.rooms.set(sessionId, room);
    }
    return room;
  }

  private fanOut(sessionId: string, fn: (h: RealtimeHandlers) => void) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    for (const h of room.handlers.values()) fn(h);
  }

  private broadcastPresence(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const list = [...room.presence.values()];
    this.fanOut(sessionId, (h) => h.onPresence?.(list));
  }

  private notifySessionChanged(session: InterviewSession) {
    this.fanOut(session.id, (h) => h.onSessionChanged?.(session));
    this.rooms.get(session.id)?.channel?.postMessage({ kind: "session", session });
  }

  private applyLocal(sessionId: string, envelopes: CanvasEnvelope[], persist = true) {
    const doc = this.db.docs[sessionId];
    if (!doc) return;
    let next = doc;
    for (const env of envelopes) next = applyOperation(next, env.operation);
    this.db.docs[sessionId] = next;
    this.db.cursors[sessionId] = (this.db.cursors[sessionId] ?? 0) + envelopes.length;
    if (persist) this.persist();
  }

  auth: Services["auth"] = {
    getCurrentUser: async () => delay(this.db.user),
    signOut: async () => delay(undefined),
  };

  sessions: Services["sessions"] = {
    list: async () =>
      delay(
        [...this.db.sessions]
          .filter((s) => s.state !== "archived")
          .sort((a, b) => b.updatedAt - a.updatedAt),
      ),

    get: async (id) => delay(this.requireSession(id)),

    create: async ({ title, prompt, durationMinutes }) => {
      const now = Date.now();
      const session: InterviewSession = {
        id: randomId("ses"),
        ownerUserId: this.db.user.id,
        title: title.trim() || "Untitled interview",
        prompt: prompt.trim(),
        state: "draft",
        candidateEditingEnabled: true,
        durationMinutes,
        scheduledAt: null,
        startedAt: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.db.sessions.unshift(session);
      this.db.docs[session.id] = { schemaVersion: 1, elements: {}, order: [] };
      this.db.cursors[session.id] = 0;
      this.audit(session.id, "session.created");
      this.persist();
      return delay(session);
    },

    update: async (id, patch) => {
      const session = this.requireSession(id);
      Object.assign(session, patch, { updatedAt: Date.now() });
      if ("candidateEditingEnabled" in patch) this.audit(id, "permission.changed");
      this.persist();
      this.notifySessionChanged(session);
      return delay(session);
    },

    start: async (id) => {
      const session = this.requireSession(id);
      session.state = "live";
      session.startedAt = session.startedAt ?? Date.now();
      session.endedAt = null;
      session.updatedAt = Date.now();
      this.audit(id, "session.started");
      this.persist();
      this.notifySessionChanged(session);
      return delay(session);
    },

    end: async (id) => {
      const session = this.requireSession(id);
      session.state = "ended";
      session.endedAt = Date.now();
      session.candidateEditingEnabled = false;
      session.updatedAt = Date.now();
      this.audit(id, "session.ended");
      // Final snapshot: the doc as stored becomes the reviewable record.
      this.persist();
      this.notifySessionChanged(session);
      return delay(session);
    },

    archive: async (id) => {
      const session = this.requireSession(id);
      session.state = "archived";
      session.updatedAt = Date.now();
      this.audit(id, "session.archived");
      this.persist();
      return delay(session);
    },

    duplicate: async (id) => {
      const source = this.requireSession(id);
      const now = Date.now();
      const copy: InterviewSession = {
        ...source,
        id: randomId("ses"),
        title: `${source.title} (copy)`,
        state: "draft",
        candidateEditingEnabled: true,
        startedAt: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.db.sessions.unshift(copy);
      const sourceDoc = this.db.docs[id];
      this.db.docs[copy.id] = sourceDoc
        ? { ...sourceDoc, elements: { ...sourceDoc.elements }, order: [...sourceDoc.order] }
        : { schemaVersion: 1, elements: {}, order: [] };
      this.db.cursors[copy.id] = 0;
      this.audit(copy.id, "session.created");
      this.persist();
      return delay(copy);
    },

    guestLink: async (sessionId) =>
      delay(this.db.links.find((l) => l.sessionId === sessionId && !l.revokedAt) ?? null),

    rotateGuestLink: async (sessionId) => {
      this.requireSession(sessionId);
      for (const link of this.db.links) {
        if (link.sessionId === sessionId && !link.revokedAt) link.revokedAt = Date.now();
      }
      const link: GuestLink = {
        id: randomId("lnk"),
        sessionId,
        token: randomToken(),
        roleGranted: "candidate",
        expiresAt: null,
        maxUses: MAX_PARTICIPANTS,
        revokedAt: null,
        createdAt: Date.now(),
      };
      this.db.links.push(link);
      this.audit(sessionId, "link.rotated");
      this.persist();
      return delay(link);
    },

    revokeGuestLink: async (sessionId) => {
      for (const link of this.db.links) {
        if (link.sessionId === sessionId && !link.revokedAt) link.revokedAt = Date.now();
      }
      this.audit(sessionId, "link.revoked");
      this.persist();
      return delay(undefined);
    },

    resolveToken: async (token) => {
      const link = this.db.links.find((l) => l.token === token);
      if (!link) throw new ServiceError("not_found", "This invite link is not valid.");
      if (link.revokedAt) throw new ServiceError("revoked", "This invite link was revoked by the interviewer.");
      if (link.expiresAt && link.expiresAt < Date.now())
        throw new ServiceError("expired", "This invite link has expired.");
      const session = this.requireSession(link.sessionId);
      if (session.state === "archived") throw new ServiceError("ended", "This interview is no longer available.");
      return delay({ session, link });
    },

    joinWithToken: async (token, displayName) => {
      const { session, link } = await this.sessions.resolveToken(token);
      if (session.state === "ended")
        throw new ServiceError("ended", "This interview has ended and is read-only.");
      const active = this.db.participants.filter((p) => p.sessionId === session.id && !p.leftAt);
      if (active.length >= (link.maxUses ?? MAX_PARTICIPANTS))
        throw new ServiceError("at_capacity", "This interview is already full.");
      const participant: Participant = {
        id: randomId("par"),
        sessionId: session.id,
        userId: null,
        displayName: displayName.trim() || "Guest",
        role: link.roleGranted,
        color: ["rose", "amber", "accent"][active.length % 3]!,
        joinedAt: Date.now(),
        leftAt: null,
        online: true,
      };
      this.db.participants.push(participant);
      this.audit(session.id, "participant.joined");
      this.persist();
      return delay({ session, participant });
    },

    joinAsOwner: async (sessionId) => {
      this.requireSession(sessionId);
      const existing = this.db.participants.find(
        (p) => p.sessionId === sessionId && p.userId === this.db.user.id,
      );
      if (existing) {
        existing.leftAt = null;
        existing.online = true;
        this.persist();
        return delay(existing);
      }
      const participant: Participant = {
        id: randomId("par"),
        sessionId,
        userId: this.db.user.id,
        displayName: this.db.user.displayName,
        role: "owner",
        color: "accent",
        joinedAt: Date.now(),
        leftAt: null,
        online: true,
      };
      this.db.participants.push(participant);
      this.persist();
      return delay(participant);
    },

    participants: async (sessionId) =>
      delay(this.db.participants.filter((p) => p.sessionId === sessionId)),

    removeParticipant: async (sessionId, participantId) => {
      const p = this.db.participants.find((x) => x.id === participantId && x.sessionId === sessionId);
      if (!p) throw new ServiceError("not_found", "That participant is not in this interview.");
      p.leftAt = Date.now();
      p.online = false;
      this.audit(sessionId, "participant.removed");
      this.persist();
      return delay(undefined);
    },

    auditLog: async (sessionId) =>
      delay(this.db.audit.filter((a) => a.sessionId === sessionId).sort((a, b) => b.at - a.at)),
  };

  canvas: Services["canvas"] = {
    getSnapshot: async (sessionId) => {
      this.requireSession(sessionId);
      const doc = this.db.docs[sessionId] ?? { schemaVersion: 1, elements: {}, order: [] };
      return delay({
        sessionId,
        doc,
        operationCursor: this.db.cursors[sessionId] ?? 0,
        updatedAt: Date.now(),
      });
    },

    submitOperations: async (sessionId, participantId, envelopes) => {
      const session = this.requireSession(sessionId);
      const participant = this.db.participants.find((p) => p.id === participantId);
      // Server-side authorization for every persistent update.
      if (!participant || participant.sessionId !== sessionId || participant.leftAt)
        throw new ServiceError("forbidden", "You are no longer part of this interview.");
      if (session.state === "ended" || session.state === "archived")
        throw new ServiceError("ended", "This interview has ended.");
      if (participant.role === "observer")
        throw new ServiceError("forbidden", "Observers cannot edit the canvas.");
      if (participant.role === "candidate" && !session.candidateEditingEnabled)
        throw new ServiceError("forbidden", "The interviewer has locked editing.");

      this.applyLocal(sessionId, envelopes);
      this.fanOut(sessionId, (h) => h.onDocumentUpdate?.(envelopes));
      this.rooms.get(sessionId)?.channel?.postMessage({ kind: "ops", envelopes });
      return delay({ accepted: envelopes.length, cursor: this.db.cursors[sessionId] ?? 0 });
    },

    exportJson: async (sessionId) => {
      const session = this.requireSession(sessionId);
      return delay(
        JSON.stringify(
          { session, canvas: this.db.docs[sessionId], exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      );
    },
  };

  realtime: Services["realtime"] = {
    connect: (sessionId, participantId, handlers) => {
      const room = this.room(sessionId);
      room.handlers.set(participantId, handlers);
      let offline = false;
      const queue: CanvasEnvelope[] = [];

      handlers.onConnectionState?.("connected");
      setTimeout(() => this.broadcastPresence(sessionId), 0);

      const flush = () => {
        if (queue.length === 0) return;
        const batch = queue.splice(0, queue.length);
        void this.canvas.submitOperations(sessionId, participantId, batch).catch(() => {
          /* rejected updates are surfaced by the caller's own submit path */
        });
      };

      const connection: RealtimeConnection = {
        sendOperations: (envelopes) => {
          if (offline) {
            queue.push(...envelopes);
            return;
          }
          this.fanOut(sessionId, (h) => {
            if (h !== handlers) h.onDocumentUpdate?.(envelopes);
          });
          room.channel?.postMessage({ kind: "ops", envelopes });
        },
        sendPresence: (presence) => {
          if (offline) return;
          room.presence.set(presence.participantId, presence);
          this.broadcastPresence(sessionId);
          room.channel?.postMessage({ kind: "presence", presence });
        },
        simulateDisconnect: (ms) => {
          offline = true;
          handlers.onConnectionState?.("offline");
          setTimeout(() => {
            handlers.onConnectionState?.("reconnecting");
            setTimeout(() => {
              offline = false;
              flush();
              handlers.onConnectionState?.("connected");
            }, 400);
          }, ms);
        },
        disconnect: () => {
          room.handlers.delete(participantId);
          room.presence.delete(participantId);
          this.broadcastPresence(sessionId);
        },
      };
      return connection;
    },
  };
}
