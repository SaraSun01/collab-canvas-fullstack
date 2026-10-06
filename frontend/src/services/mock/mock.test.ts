import { describe, expect, it } from "vitest";
import { MockBackend } from "./index";
import { randomToken } from "./store";
import type { CanvasEnvelope } from "@/lib/canvas/types";

const addOp = (id: string): CanvasEnvelope => ({
  clientOperationId: `op_${id}`,
  actorId: "x",
  sentAt: 1,
  operation: {
    type: "add",
    element: { id, kind: "text", x: 0, y: 0, text: "hi", size: 16, color: "neutral", createdBy: "x", createdAt: 1, updatedAt: 1 },
  },
});

describe("mock services", () => {
  it("guest tokens carry at least 128 bits", () => {
    const t = randomToken();
    expect(t.length).toBeGreaterThanOrEqual(22);
    expect(new Set(Array.from({ length: 50 }, randomToken)).size).toBe(50);
  });

  it("session lifecycle and guest join", async () => {
    const api = MockBackend.forTests();
    const s = await api.sessions.create({ title: "T", prompt: "", durationMinutes: 30 });
    expect(s.state).toBe("draft");
    const link = await api.sessions.rotateGuestLink(s.id);
    const { participant } = await api.sessions.joinWithToken(link.token, "Ada");
    expect(participant.role).toBe("candidate");
    await api.sessions.start(s.id);
    await api.canvas.submitOperations(s.id, participant.id, [addOp("t1")]);
    expect((await api.canvas.getSnapshot(s.id)).doc.order).toContain("t1");
  });

  it("revoked links are rejected", async () => {
    const api = MockBackend.forTests();
    const s = await api.sessions.create({ title: "T", prompt: "", durationMinutes: 30 });
    const link = await api.sessions.rotateGuestLink(s.id);
    await api.sessions.revokeGuestLink(s.id);
    await expect(api.sessions.joinWithToken(link.token, "Ada")).rejects.toMatchObject({ code: "revoked" });
  });

  it("enforces edit authorization server-side", async () => {
    const api = MockBackend.forTests();
    const s = await api.sessions.create({ title: "T", prompt: "", durationMinutes: 30 });
    const link = await api.sessions.rotateGuestLink(s.id);
    const { participant } = await api.sessions.joinWithToken(link.token, "Ada");
    await api.sessions.update(s.id, { candidateEditingEnabled: false });
    await expect(api.canvas.submitOperations(s.id, participant.id, [addOp("a")])).rejects.toMatchObject({ code: "forbidden" });
    await api.sessions.update(s.id, { candidateEditingEnabled: true });
    await api.sessions.removeParticipant(s.id, participant.id);
    await expect(api.canvas.submitOperations(s.id, participant.id, [addOp("b")])).rejects.toMatchObject({ code: "forbidden" });
  });

  it("ended sessions are read-only and audited", async () => {
    const api = MockBackend.forTests();
    const s = await api.sessions.create({ title: "T", prompt: "", durationMinutes: 30 });
    const owner = await api.sessions.joinAsOwner(s.id);
    await api.sessions.start(s.id);
    await api.sessions.end(s.id);
    await expect(api.canvas.submitOperations(s.id, owner.id, [addOp("a")])).rejects.toMatchObject({ code: "ended" });
    const types = (await api.sessions.auditLog(s.id)).map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["session.created", "session.started", "session.ended"]));
  });
});
