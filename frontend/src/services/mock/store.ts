import { createEmptyDoc } from "@/lib/canvas/document";
import type { CanvasDoc } from "@/lib/canvas/types";
import type {
  AuditEvent,
  GuestLink,
  InterviewSession,
  Participant,
  User,
} from "../types";

export interface MockDb {
  user: User;
  sessions: InterviewSession[];
  links: GuestLink[];
  participants: Participant[];
  docs: Record<string, CanvasDoc>;
  cursors: Record<string, number>;
  audit: AuditEvent[];
}

const STORAGE_KEY = "lattice.mock.db.v1";

export function randomId(prefix = "id"): string {
  let rnd: string;
  try {
    rnd =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
  } catch {
    rnd = Math.random().toString(36).slice(2, 14);
  }
  return `${prefix}_${rnd}`;
}

/** 128+ bits of entropy, matching the guest-token requirement. */
export function randomToken(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export const PARTICIPANT_COLORS = ["accent", "amber", "rose", "ink"] as const;

export function seedDb(now = Date.now()): MockDb {
  const user: User = {
    id: "user_owner",
    email: "maya@lattice.dev",
    displayName: "Maya Kern",
    createdAt: now - 86_400_000 * 30,
  };

  const live: InterviewSession = {
    id: "ses_rate_limiter",
    ownerUserId: user.id,
    title: "Design a rate limiter",
    prompt:
      "Design a distributed rate limiter that handles 100k req/s with per-user quotas. Cover the data path, storage, and failure modes.",
    state: "live",
    candidateEditingEnabled: true,
    durationMinutes: 45,
    scheduledAt: null,
    startedAt: now - 34 * 60_000,
    endedAt: null,
    createdAt: now - 3 * 86_400_000,
    updatedAt: now - 60_000,
  };
  const draft: InterviewSession = {
    id: "ses_url_shortener",
    ownerUserId: user.id,
    title: "Design a URL shortener",
    prompt: "Design a URL shortener serving 500M redirects per day.",
    state: "draft",
    candidateEditingEnabled: true,
    durationMinutes: 45,
    scheduledAt: now + 86_400_000,
    startedAt: null,
    endedAt: null,
    createdAt: now - 86_400_000,
    updatedAt: now - 86_400_000,
  };
  const ended: InterviewSession = {
    id: "ses_chat_system",
    ownerUserId: user.id,
    title: "Design a chat system",
    prompt: "Design a realtime chat system for 10M daily users.",
    state: "ended",
    candidateEditingEnabled: false,
    durationMinutes: 60,
    scheduledAt: null,
    startedAt: now - 2 * 86_400_000,
    endedAt: now - 2 * 86_400_000 + 48 * 60_000,
    createdAt: now - 4 * 86_400_000,
    updatedAt: now - 2 * 86_400_000,
  };

  const link: GuestLink = {
    id: randomId("lnk"),
    sessionId: live.id,
    token: randomToken(),
    roleGranted: "candidate",
    expiresAt: null,
    maxUses: 10,
    revokedAt: null,
    createdAt: now - 3 * 86_400_000,
  };

  const participants: Participant[] = [
    {
      id: "par_owner_live",
      sessionId: live.id,
      userId: user.id,
      displayName: "Maya Kern",
      role: "owner",
      color: "accent",
      joinedAt: now - 35 * 60_000,
      leftAt: null,
      online: true,
    },
    {
      id: "par_priya",
      sessionId: live.id,
      userId: null,
      displayName: "Priya Raman",
      role: "candidate",
      color: "rose",
      joinedAt: now - 33 * 60_000,
      leftAt: null,
      online: true,
    },
    {
      id: "par_jordan",
      sessionId: ended.id,
      userId: null,
      displayName: "Jordan Diaz",
      role: "candidate",
      color: "amber",
      joinedAt: ended.startedAt!,
      leftAt: ended.endedAt,
      online: false,
    },
  ];

  const docs: Record<string, CanvasDoc> = {
    [live.id]: seedRateLimiterDoc(now),
    [draft.id]: createEmptyDoc(),
    [ended.id]: createEmptyDoc(),
  };

  return {
    user,
    sessions: [live, draft, ended],
    links: [link],
    participants,
    docs,
    cursors: { [live.id]: 4, [draft.id]: 0, [ended.id]: 0 },
    audit: [
      { id: randomId("aud"), sessionId: live.id, type: "session.created", actor: user.displayName, at: live.createdAt },
      { id: randomId("aud"), sessionId: live.id, type: "link.created", actor: user.displayName, at: link.createdAt },
      { id: randomId("aud"), sessionId: live.id, type: "session.started", actor: user.displayName, at: live.startedAt! },
    ],
  };
}

function seedRateLimiterDoc(now: number): CanvasDoc {
  const base = { createdBy: "par_owner_live", createdAt: now - 30 * 60_000, updatedAt: now - 30 * 60_000 };
  const doc = createEmptyDoc();
  const nodes = [
    { id: "el_client", componentType: "client", x: 80, y: 180, width: 140, height: 68, label: "Client", description: "web / mobile", color: "neutral" as const },
    { id: "el_gateway", componentType: "gateway", x: 320, y: 120, width: 155, height: 68, label: "API Gateway", description: "auth · routing", color: "neutral" as const },
    { id: "el_limiter", componentType: "service", x: 320, y: 320, width: 155, height: 68, label: "Rate Limiter", description: "token bucket", color: "accent" as const },
    { id: "el_cache", componentType: "cache", x: 600, y: 220, width: 140, height: 68, label: "Redis Cache", description: "counters", color: "accent" as const },
  ];
  for (const n of nodes) {
    doc.elements[n.id] = { kind: "node", ...base, ...n };
    doc.order.push(n.id);
  }
  const connectors = [
    { id: "el_c1", from: { elementId: "el_client" }, to: { elementId: "el_gateway" }, label: "HTTPS" },
    { id: "el_c2", from: { elementId: "el_gateway" }, to: { elementId: "el_limiter" }, label: "check" },
    { id: "el_c3", from: { elementId: "el_limiter" }, to: { elementId: "el_cache" }, label: "read/write" },
  ];
  for (const c of connectors) {
    doc.elements[c.id] = {
      kind: "connector",
      ...base,
      ...c,
      style: "elbow",
      arrowStart: false,
      arrowEnd: true,
      dashed: false,
      width: 2,
      color: "neutral",
    };
    doc.order.push(c.id);
  }
  return doc;
}

export function loadDb(): MockDb {
  if (typeof localStorage === "undefined") return seedDb();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = seedDb();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return JSON.parse(raw) as MockDb;
  } catch {
    return seedDb();
  }
}

export function saveDb(db: MockDb): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota or private mode — the in-memory copy still works */
  }
}

export function resetDb(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
