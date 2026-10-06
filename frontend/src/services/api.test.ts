import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiBackend } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const session = {
  id: "session_1",
  ownerUserId: "user_owner",
  title: "Test session",
  prompt: "",
  state: "live" as const,
  candidateEditingEnabled: true,
  durationMinutes: 45,
  scheduledAt: null,
  startedAt: 1,
  endedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("ApiBackend authentication recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reissues a user token after the backend rejects the cached token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "invalid", message: "Invalid or expired bearer token." }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-user-token", token_type: "bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse([session]));
    vi.stubGlobal("fetch", fetchMock);

    const api = new ApiBackend("http://api.test");
    (api as unknown as { userToken: string | null }).userToken = "stale-user-token";

    await expect(api.sessions.list()).resolves.toEqual([session]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer stale-user-token");
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Authorization")).toBe("Bearer fresh-user-token");
  });

  it("clears an invalid collaboration token and does not retry the WebSocket", async () => {
    const participant = {
      id: "participant_1",
      sessionId: session.id,
      userId: null,
      displayName: "Ada",
      role: "candidate" as const,
      color: "rose",
      joinedAt: 1,
      leftAt: null,
      online: true,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ session, participant, collaborationToken: "stale-collaboration-token" }))
      .mockResolvedValueOnce(jsonResponse({ code: "invalid", message: "Invalid or expired bearer token." }, 401));
    vi.stubGlobal("fetch", fetchMock);

    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      constructor() {
        FakeWebSocket.instances.push(this);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const api = new ApiBackend("http://api.test");
    await api.sessions.joinWithToken("invite", "Ada");
    await expect(api.canvas.getSnapshot(session.id)).rejects.toMatchObject({ status: 401 });

    const states: string[] = [];
    api.realtime.connect(session.id, participant.id, { onConnectionState: (state) => states.push(state) });
    await vi.waitFor(() => expect(states).toContain("offline"));

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("treats a collaboration token restored from session storage as scoped", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        get length() {
          return values.size;
        },
        key: (index: number) => [...values.keys()][index] ?? null,
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ session, participant: { id: "participant_1", sessionId: session.id, userId: null, displayName: "Ada", role: "candidate", color: "rose", joinedAt: 1, leftAt: null, online: true }, collaborationToken: "persisted-collaboration-token" }))
      .mockResolvedValueOnce(jsonResponse({ code: "invalid", message: "Invalid or expired bearer token." }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const initial = new ApiBackend("http://api.test");
    await initial.sessions.joinWithToken("invite", "Ada");

    const reloaded = new ApiBackend("http://api.test");
    await expect(reloaded.canvas.getSnapshot(session.id)).rejects.toMatchObject({ status: 401 });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer persisted-collaboration-token");
  });
});
