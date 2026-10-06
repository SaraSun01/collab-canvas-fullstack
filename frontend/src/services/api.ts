import type { CanvasDoc, CanvasEnvelope } from "@/lib/canvas/types";
import type {
  AuditEvent,
  CanvasSnapshot,
  ConnectionState,
  GuestLink,
  InterviewSession,
  Participant,
  Presence,
  RealtimeConnection,
  RealtimeHandlers,
  Services,
  User,
} from "./types";
import { ServiceError } from "./types";

type ApiErrorBody = { code?: string; message?: string; detail?: unknown };
type TokenResponse = { access_token: string; token_type: "bearer"; expires_in: number };
type JoinResponse = {
  session: InterviewSession;
  participant: Participant;
  collaborationToken: string;
};
type CanvasExport = {
  session: InterviewSession;
  canvas: CanvasDoc;
  exportedAt: string;
};

const serviceCodes = new Set<ServiceError["code"]>([
  "not_found",
  "revoked",
  "expired",
  "at_capacity",
  "forbidden",
  "ended",
  "invalid",
]);

const userTokenKey = "lattice.api.user-token";
const sessionTokenPrefix = "lattice.api.session-token.";

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage may be unavailable in private browsing or SSR.
  }
}

function storageDelete(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session storage may be unavailable in private browsing or SSR.
  }
}

function serviceCode(value: unknown, status: number): ServiceError["code"] {
  if (typeof value === "string" && serviceCodes.has(value as ServiceError["code"])) {
    return value as ServiceError["code"];
  }
  if (status === 401) return "invalid";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "invalid";
  return "invalid";
}

function websocketOrigin(apiOrigin: string): string {
  const parsed = new URL(apiOrigin, typeof window === "undefined" ? undefined : window.location.origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString().replace(/\/$/, "");
}

class ApiRealtimeConnection implements RealtimeConnection {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private closed = false;
  private suppressReconnect = false;
  private opening = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private simulateTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedOperations: CanvasEnvelope[] = [];
  private queuedPresence: Presence | null = null;

  constructor(
    private readonly origin: string,
    private readonly sessionId: string,
    private readonly participantId: string,
    private readonly tokenProvider: () => Promise<string | null>,
    private readonly handlers: RealtimeHandlers,
  ) {}

  start(): void {
    this.closed = false;
    void this.open();
  }

  private async open(): Promise<void> {
    if (this.closed || this.opening || typeof WebSocket === "undefined") {
      this.handlers.onConnectionState?.("offline");
      return;
    }
    this.opening = true;
    this.handlers.onConnectionState?.("reconnecting");
    let token: string | null;
    try {
      token = await this.tokenProvider();
    } catch {
      this.opening = false;
      this.suppressReconnect = true;
      if (!this.closed) this.handlers.onConnectionState?.("offline");
      return;
    }
    this.opening = false;
    if (this.closed || !token) {
      if (!this.closed) {
        this.suppressReconnect = true;
        this.handlers.onConnectionState?.("offline");
      }
      return;
    }
    this.token = token;
    const socket = new WebSocket(
      `${this.origin}/v1/sessions/${encodeURIComponent(this.sessionId)}/realtime?token=${encodeURIComponent(this.token)}`,
    );
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || this.closed) return;
      this.handlers.onConnectionState?.("connected");
      socket.send(
        JSON.stringify({
          type: "join_room",
          version: 1,
          sessionId: this.sessionId,
          participantId: this.participantId,
        }),
      );
      this.flush();
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => {
      if (!this.closed) this.handlers.onConnectionState?.("reconnecting");
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.closed || this.suppressReconnect) return;
      this.handlers.onConnectionState?.("offline");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, 1_000);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: {
      type?: string;
      envelopes?: CanvasEnvelope[];
      presences?: Presence[];
      presence?: Presence;
      session?: InterviewSession;
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }
    if (message.type === "document_update" && message.envelopes) {
      this.handlers.onDocumentUpdate?.(message.envelopes);
    } else if (message.type === "presence_snapshot" && message.presences) {
      this.handlers.onPresence?.(message.presences);
    } else if (message.type === "presence_update" && message.presence) {
      this.handlers.onPresence?.([message.presence]);
    } else if ((message.type === "permission_changed" || message.type === "session_ended") && message.session) {
      this.handlers.onSessionChanged?.(message.session);
    }
  }

  private isOpen(): boolean {
    return this.socket?.readyState === 1;
  }

  private flush(): void {
    if (!this.isOpen() || !this.socket) return;
    if (this.queuedOperations.length) {
      const envelopes = this.queuedOperations.splice(0, this.queuedOperations.length);
      this.socket.send(JSON.stringify({ type: "document_update", version: 1, sessionId: this.sessionId, envelopes }));
    }
    if (this.queuedPresence) {
      const presence = this.queuedPresence;
      this.queuedPresence = null;
      this.socket.send(JSON.stringify({ type: "presence_update", version: 1, sessionId: this.sessionId, presence }));
    }
  }

  sendOperations(envelopes: CanvasEnvelope[]): void {
    if (this.isOpen() && this.socket) {
      this.socket.send(JSON.stringify({ type: "document_update", version: 1, sessionId: this.sessionId, envelopes }));
    } else {
      this.queuedOperations.push(...envelopes);
    }
  }

  sendPresence(presence: Presence): void {
    if (this.isOpen() && this.socket) {
      this.socket.send(JSON.stringify({ type: "presence_update", version: 1, sessionId: this.sessionId, presence }));
    } else {
      this.queuedPresence = presence;
    }
  }

  simulateDisconnect(ms: number): void {
    this.suppressReconnect = true;
    this.handlers.onConnectionState?.("offline");
    this.socket?.close();
    if (this.simulateTimer) clearTimeout(this.simulateTimer);
    this.simulateTimer = setTimeout(() => {
      this.simulateTimer = null;
      this.suppressReconnect = false;
      if (!this.closed) this.open();
    }, ms);
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.simulateTimer) clearTimeout(this.simulateTimer);
    this.reconnectTimer = null;
    this.simulateTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}

export class ApiBackend implements Services {
  private readonly apiBase: string;
  private userToken: string | null;
  private readonly sessionTokens = new Map<string, string>();
  private readonly collaborationSessions = new Set<string>();

  readonly auth: Services["auth"] = {
    getCurrentUser: () => this.getCurrentUser(),
    signOut: () => this.signOut(),
  };

  readonly sessions: Services["sessions"] = {
    list: () => this.listSessions(),
    get: (id) => this.getSession(id),
    create: (input) => this.createSession(input),
    update: (id, patch) => this.updateSession(id, patch),
    start: (id) => this.startSession(id),
    end: (id) => this.endSession(id),
    archive: (id) => this.archiveSession(id),
    duplicate: (id) => this.duplicateSession(id),
    guestLink: (sessionId) => this.getGuestLink(sessionId),
    rotateGuestLink: (sessionId) => this.rotateGuestLink(sessionId),
    revokeGuestLink: (sessionId) => this.revokeGuestLink(sessionId),
    resolveToken: (token) => this.resolveToken(token),
    joinWithToken: (token, displayName) => this.joinWithToken(token, displayName),
    joinAsOwner: (sessionId) => this.joinAsOwner(sessionId),
    participants: (sessionId) => this.listParticipants(sessionId),
    removeParticipant: (sessionId, participantId) => this.removeParticipant(sessionId, participantId),
    auditLog: (sessionId) => this.auditLog(sessionId),
  };

  readonly canvas: Services["canvas"] = {
    getSnapshot: (sessionId) => this.getSnapshot(sessionId),
    submitOperations: (sessionId, participantId, envelopes) => this.submitOperations(sessionId, participantId, envelopes),
    exportJson: (sessionId) => this.exportJson(sessionId),
  };

  readonly realtime: Services["realtime"] = {
    connect: (sessionId, participantId, handlers) => this.connectRealtime(sessionId, participantId, handlers),
  };

  constructor(apiBase = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://127.0.0.1:8000") {
    this.apiBase = apiBase.replace(/\/$/, "");
    this.userToken = storageGet(userTokenKey);
  }

  private sessionTokenKey(sessionId: string): string {
    return `${sessionTokenPrefix}${sessionId}`;
  }

  private tokenForSessionSync(sessionId: string): string | null {
    const inMemory = this.sessionTokens.get(sessionId);
    if (inMemory) {
      this.collaborationSessions.add(sessionId);
      return inMemory;
    }
    const persisted = storageGet(this.sessionTokenKey(sessionId));
    if (persisted) this.collaborationSessions.add(sessionId);
    return persisted;
  }

  private rememberSessionToken(sessionId: string, token: string): void {
    this.collaborationSessions.add(sessionId);
    this.sessionTokens.set(sessionId, token);
    storageSet(this.sessionTokenKey(sessionId), token);
  }

  private forgetSessionToken(sessionId: string): void {
    this.sessionTokens.delete(sessionId);
    storageDelete(this.sessionTokenKey(sessionId));
  }

  private clearSessionTokens(): void {
    this.sessionTokens.clear();
    this.collaborationSessions.clear();
    if (typeof window === "undefined") return;
    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith(sessionTokenPrefix)) window.sessionStorage.removeItem(key);
      }
    } catch {
      // Session storage may be unavailable in private browsing or SSR.
    }
  }

  private invalidateUserToken(): void {
    this.userToken = null;
    storageDelete(userTokenKey);
  }

  private async request<T>(path: string, init: RequestInit = {}, token: string | null | undefined = undefined): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const authToken = token === undefined ? this.userToken : token;
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, { ...init, headers });
    } catch (error) {
      throw new ServiceError("invalid", error instanceof Error ? error.message : "The backend is unavailable.");
    }

    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const body = (payload ?? {}) as ApiErrorBody;
      const detail = typeof body.detail === "string" ? body.detail : undefined;
      const message = body.message ?? detail ?? `Backend request failed (${response.status}).`;
      throw new ServiceError(serviceCode(body.code, response.status), message, response.status);
    }
    return payload as T;
  }

  private async ensureUserToken(): Promise<string> {
    if (this.userToken) return this.userToken;
    const email = (import.meta.env["VITE_API_EMAIL"] as string | undefined) ?? "maya@lattice.dev";
    const password = (import.meta.env["VITE_API_PASSWORD"] as string | undefined) ?? "demo-password";
    const token = await this.request<TokenResponse>(
      "/v1/auth/token",
      { method: "POST", body: JSON.stringify({ email, password }) },
      null,
    );
    this.userToken = token.access_token;
    storageSet(userTokenKey, token.access_token);
    return token.access_token;
  }

  private async userRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.ensureUserToken();
    try {
      return await this.request<T>(path, init, token);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 401 || token !== this.userToken) throw error;
      this.invalidateUserToken();
      return this.request<T>(path, init, await this.ensureUserToken());
    }
  }

  private async sessionRequest<T>(sessionId: string, path: string, init: RequestInit = {}): Promise<T> {
    const collaborationToken = this.tokenForSessionSync(sessionId);
    if (this.collaborationSessions.has(sessionId)) {
      if (!collaborationToken) {
        throw new ServiceError("invalid", "The collaboration session has expired. Rejoin the interview.", 401);
      }
      try {
        return await this.request<T>(path, init, collaborationToken);
      } catch (error) {
        if (error instanceof ServiceError && error.status === 401) this.forgetSessionToken(sessionId);
        throw error;
      }
    }
    return this.userRequest<T>(path, init);
  }

  private async getCurrentUser(): Promise<User> {
    return this.userRequest<User>("/v1/auth/me");
  }

  private async signOut(): Promise<void> {
    const token = await this.ensureUserToken();
    try {
      await this.request<void>("/v1/auth/signout", { method: "POST" }, token);
    } finally {
      this.userToken = null;
      storageDelete(userTokenKey);
      this.clearSessionTokens();
    }
  }

  private async listSessions(): Promise<InterviewSession[]> {
    return this.userRequest<InterviewSession[]>("/v1/sessions");
  }

  private async getSession(id: string): Promise<InterviewSession> {
    return this.sessionRequest<InterviewSession>(id, `/v1/sessions/${encodeURIComponent(id)}`);
  }

  private async createSession(input: { title: string; prompt: string; durationMinutes: number }): Promise<InterviewSession> {
    return this.userRequest<InterviewSession>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  private async updateSession(
    id: string,
    patch: Partial<Pick<InterviewSession, "title" | "prompt" | "candidateEditingEnabled" | "durationMinutes">>,
  ): Promise<InterviewSession> {
    return this.userRequest<InterviewSession>(`/v1/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  private async startSession(id: string): Promise<InterviewSession> {
    return this.userRequest<InterviewSession>(`/v1/sessions/${encodeURIComponent(id)}/start`, { method: "POST" });
  }

  private async endSession(id: string): Promise<InterviewSession> {
    return this.userRequest<InterviewSession>(`/v1/sessions/${encodeURIComponent(id)}/end`, { method: "POST" });
  }

  private async archiveSession(id: string): Promise<InterviewSession> {
    return this.userRequest<InterviewSession>(`/v1/sessions/${encodeURIComponent(id)}/archive`, { method: "POST" });
  }

  private async duplicateSession(id: string): Promise<InterviewSession> {
    return this.userRequest<InterviewSession>(`/v1/sessions/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
  }

  private async getGuestLink(sessionId: string): Promise<GuestLink | null> {
    return this.userRequest<GuestLink | null>(`/v1/sessions/${encodeURIComponent(sessionId)}/guest-links`);
  }

  private async rotateGuestLink(sessionId: string): Promise<GuestLink> {
    return this.userRequest<GuestLink>(`/v1/sessions/${encodeURIComponent(sessionId)}/guest-links`, { method: "POST" });
  }

  private async revokeGuestLink(sessionId: string): Promise<void> {
    const link = await this.getGuestLink(sessionId);
    if (!link) return;
    await this.userRequest<void>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/guest-links/${encodeURIComponent(link.id)}`,
      { method: "DELETE" },
    );
  }

  private async resolveToken(token: string): Promise<{ session: InterviewSession; link: GuestLink }> {
    return this.request<{ session: InterviewSession; link: GuestLink }>(`/v1/join/${encodeURIComponent(token)}`, {}, null);
  }

  private async joinWithToken(token: string, displayName: string): Promise<{ session: InterviewSession; participant: Participant }> {
    const joined = await this.request<JoinResponse>(
      `/v1/join/${encodeURIComponent(token)}`,
      { method: "POST", body: JSON.stringify({ displayName }) },
      null,
    );
    this.rememberSessionToken(joined.session.id, joined.collaborationToken);
    return { session: joined.session, participant: joined.participant };
  }

  private async joinAsOwner(sessionId: string): Promise<Participant> {
    const participant = await this.userRequest<Participant>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/participants/owner`,
      { method: "POST" },
    );
    this.collaborationSessions.delete(sessionId);
    this.forgetSessionToken(sessionId);
    return participant;
  }

  private async listParticipants(sessionId: string): Promise<Participant[]> {
    return this.sessionRequest<Participant[]>(sessionId, `/v1/sessions/${encodeURIComponent(sessionId)}/participants`);
  }

  private async removeParticipant(sessionId: string, participantId: string): Promise<void> {
    await this.sessionRequest<void>(
      sessionId,
      `/v1/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}`,
      { method: "DELETE" },
    );
  }

  private async auditLog(sessionId: string): Promise<AuditEvent[]> {
    return this.userRequest<AuditEvent[]>(`/v1/sessions/${encodeURIComponent(sessionId)}/audit`);
  }

  private async getSnapshot(sessionId: string): Promise<CanvasSnapshot> {
    return this.sessionRequest<CanvasSnapshot>(sessionId, `/v1/sessions/${encodeURIComponent(sessionId)}/canvas`);
  }

  private async submitOperations(
    sessionId: string,
    participantId: string,
    envelopes: CanvasEnvelope[],
  ): Promise<{ accepted: number; cursor: number }> {
    return this.sessionRequest<{ accepted: number; cursor: number }>(
      sessionId,
      `/v1/sessions/${encodeURIComponent(sessionId)}/canvas/operations`,
      { method: "POST", body: JSON.stringify({ participantId, envelopes }) },
    );
  }

  private async exportJson(sessionId: string): Promise<string> {
    const payload = await this.sessionRequest<CanvasExport | string>(
      sessionId,
      `/v1/sessions/${encodeURIComponent(sessionId)}/canvas/export`,
    );
    return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  }

  private async tokenForSession(sessionId: string): Promise<string | null> {
    const sessionPath = `/v1/sessions/${encodeURIComponent(sessionId)}`;
    if (this.collaborationSessions.has(sessionId)) {
      const token = this.tokenForSessionSync(sessionId);
      if (!token) return null;
      try {
        await this.request<InterviewSession>(sessionPath, {}, token);
        return token;
      } catch (error) {
        if (error instanceof ServiceError && error.status === 401) this.forgetSessionToken(sessionId);
        throw error;
      }
    }
    await this.userRequest<InterviewSession>(sessionPath);
    return this.userToken;
  }

  private connectRealtime(sessionId: string, participantId: string, handlers: RealtimeHandlers): RealtimeConnection {
    const connection = new ApiRealtimeConnection(
      websocketOrigin(this.apiBase),
      sessionId,
      participantId,
      () => this.tokenForSession(sessionId),
      handlers,
    );
    connection.start();
    return connection;
  }
}
