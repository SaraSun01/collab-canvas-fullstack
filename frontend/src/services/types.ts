import type { CanvasDoc, CanvasEnvelope } from "@/lib/canvas/types";

export type SessionState = "draft" | "live" | "ended" | "archived";
export type Role = "owner" | "interviewer" | "candidate" | "observer";

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
}

export interface InterviewSession {
  id: string;
  ownerUserId: string;
  title: string;
  prompt: string;
  state: SessionState;
  candidateEditingEnabled: boolean;
  durationMinutes: number;
  scheduledAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GuestLink {
  id: string;
  sessionId: string;
  token: string;
  roleGranted: Exclude<Role, "owner">;
  expiresAt: number | null;
  maxUses: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface Participant {
  id: string;
  sessionId: string;
  userId: string | null;
  displayName: string;
  role: Role;
  color: string;
  joinedAt: number;
  leftAt: number | null;
  online: boolean;
}

export interface CanvasSnapshot {
  sessionId: string;
  doc: CanvasDoc;
  operationCursor: number;
  updatedAt: number;
}

export interface AuditEvent {
  id: string;
  sessionId: string;
  type: string;
  actor: string;
  at: number;
}

export interface Presence {
  participantId: string;
  displayName: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
}

export type ConnectionState = "connected" | "reconnecting" | "offline";

export interface RealtimeHandlers {
  onDocumentUpdate?(envelopes: CanvasEnvelope[]): void;
  onPresence?(presences: Presence[]): void;
  onConnectionState?(state: ConnectionState): void;
  onSessionChanged?(session: InterviewSession): void;
}

export interface RealtimeConnection {
  sendOperations(envelopes: CanvasEnvelope[]): void;
  sendPresence(presence: Presence): void;
  /** Simulates a temporary network loss, for demos and tests. */
  simulateDisconnect(ms: number): void;
  disconnect(): void;
}

export class ServiceError extends Error {
  constructor(
    public code:
      | "not_found"
      | "revoked"
      | "expired"
      | "at_capacity"
      | "forbidden"
      | "ended"
      | "invalid",
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface Services {
  auth: {
    getCurrentUser(): Promise<User>;
    signOut(): Promise<void>;
  };
  sessions: {
    list(): Promise<InterviewSession[]>;
    get(id: string): Promise<InterviewSession>;
    create(input: { title: string; prompt: string; durationMinutes: number }): Promise<InterviewSession>;
    update(id: string, patch: Partial<Pick<InterviewSession, "title" | "prompt" | "candidateEditingEnabled" | "durationMinutes">>): Promise<InterviewSession>;
    start(id: string): Promise<InterviewSession>;
    end(id: string): Promise<InterviewSession>;
    archive(id: string): Promise<InterviewSession>;
    duplicate(id: string): Promise<InterviewSession>;
    guestLink(sessionId: string): Promise<GuestLink | null>;
    rotateGuestLink(sessionId: string): Promise<GuestLink>;
    revokeGuestLink(sessionId: string): Promise<void>;
    resolveToken(token: string): Promise<{ session: InterviewSession; link: GuestLink }>;
    joinWithToken(token: string, displayName: string): Promise<{ session: InterviewSession; participant: Participant }>;
    joinAsOwner(sessionId: string): Promise<Participant>;
    participants(sessionId: string): Promise<Participant[]>;
    removeParticipant(sessionId: string, participantId: string): Promise<void>;
    auditLog(sessionId: string): Promise<AuditEvent[]>;
  };
  canvas: {
    getSnapshot(sessionId: string): Promise<CanvasSnapshot>;
    submitOperations(
      sessionId: string,
      participantId: string,
      envelopes: CanvasEnvelope[],
    ): Promise<{ accepted: number; cursor: number }>;
    exportJson(sessionId: string): Promise<string>;
  };
  realtime: {
    connect(sessionId: string, participantId: string, handlers: RealtimeHandlers): RealtimeConnection;
  };
}
