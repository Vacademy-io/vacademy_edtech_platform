// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SiteAssistantApiError, type SiteAssistantApi } from "./api";
import { createSiteAssistantController } from "./controller";
import { getStoredSessionId, getVisitorId, storeSessionId, RESUME_WINDOW_MS } from "./storage";
import type { SiteAssistantSession, SiteAssistantStreamEvent } from "./types";

const session = (id: string, history: SiteAssistantSession["history"] = []): SiteAssistantSession => ({
  session_id: id,
  token: `tok-${id}`,
  expires_at: null,
  assistant: { name: "Ask BV", avatar_url: null, greeting: "Namaste", suggestions: [], accent_color: null, position: null, persona: null },
  history,
});

const page = { url: "https://site.example/brahm/courses", route: "/brahm/courses", title: "Courses" };

const makeApi = (stream: SiteAssistantApi["streamMessage"]): SiteAssistantApi => ({
  createSession: vi.fn(),
  streamMessage: stream,
  contact: vi.fn(async () => ({ status: "received" })),
  feedback: vi.fn(async () => {}),
  getSession: vi.fn(async () => []),
});

describe("site assistant controller", () => {
  it("streams an answer into one assistant turn and sends the page with the message", async () => {
    const calls: unknown[] = [];
    const api = makeApi(async (_sid, token, body, onEvent) => {
      calls.push({ token, body });
      const events: SiteAssistantStreamEvent[] = [
        { type: "token", text: "We have " },
        { type: "token", text: "**2** courses." },
        { type: "card", card: { type: "notice", title: "New batch", body: "Starts Monday" } },
        { type: "done", message_id: "m9", answered: true, billed: true },
      ];
      events.forEach(onEvent);
    });
    const c = createSiteAssistantController({
      api,
      source: { get: async () => session("s1"), refresh: async () => session("s2") },
      getPage: () => page,
    });
    await c.send("  Any courses for parents?  ");
    const [user, answer] = c.store.getState().messages;
    expect(user).toMatchObject({ role: "user", text: "Any courses for parents?" });
    expect(answer).toMatchObject({ role: "assistant", text: "We have **2** courses.", messageId: "m9", pending: false, error: null });
    expect(answer.cards).toHaveLength(1);
    expect(calls[0]).toMatchObject({ token: "tok-s1", body: { text: "Any courses for parents?", page, client_msg_id: user.clientMsgId } });
    expect(c.store.getState().streaming).toBe(false);
  });

  it("re-issues the session on 401 and resends the same client_msg_id", async () => {
    const seen: { token: string; id: string }[] = [];
    const api = makeApi(async (_sid, token, body, onEvent) => {
      seen.push({ token, id: body.client_msg_id });
      if (token === "tok-s1") throw new SiteAssistantApiError(401, "unauthorized", "expired");
      onEvent({ type: "token", text: "Hello again" });
      onEvent({ type: "done", message_id: "m2", answered: true, billed: true });
    });
    const c = createSiteAssistantController({
      api,
      source: { get: async () => session("s1"), refresh: async () => session("s2") },
      getPage: () => page,
    });
    await c.send("hi");
    expect(seen.map((s) => s.token)).toEqual(["tok-s1", "tok-s2"]);
    expect(seen[0].id).toBe(seen[1].id);
    expect(c.store.getState().sessionId).toBe("s2");
    expect(c.store.getState().messages[1]).toMatchObject({ text: "Hello again", error: null });
  });

  it("starts a new chat when the server says this one is closed", async () => {
    const seen: string[] = [];
    const api = makeApi(async (_sid, token, _body, onEvent) => {
      seen.push(token);
      if (token === "tok-s1") throw new SiteAssistantApiError(403, "closed", "This chat is closed.");
      onEvent({ type: "done", message_id: "m2", answered: true, billed: true });
    });
    const c = createSiteAssistantController({
      api,
      source: { get: async () => session("s1"), refresh: async () => session("s2") },
      getPage: () => page,
    });
    await c.send("hi");
    expect(seen).toEqual(["tok-s1", "tok-s2"]);
    expect(c.store.getState().messages[1].error).toBeNull();
  });

  it("keeps why a chat could not start (a site the assistant does not serve)", async () => {
    const c = createSiteAssistantController({
      api: makeApi(async () => {}),
      source: {
        get: async () => {
          throw new SiteAssistantApiError(403, "not_allowed", "not verified");
        },
        refresh: async () => session("s2"),
      },
      getPage: () => page,
    });
    await c.connect();
    expect(c.store.getState()).toMatchObject({ status: "failed", failure: "not_allowed" });
  });

  it("keeps the server's error code on the turn (daily cap → contact fallback) and allows retry", async () => {
    let fail = true;
    const api = makeApi(async (_sid, _t, _b, onEvent) => {
      if (fail) {
        onEvent({ type: "error", code: "daily_cap", message: "" });
        return;
      }
      onEvent({ type: "token", text: "ok" });
      onEvent({ type: "done", message_id: "m3", answered: true, billed: true });
    });
    const c = createSiteAssistantController({
      api,
      source: { get: async () => session("s1"), refresh: async () => session("s2") },
      getPage: () => page,
    });
    await c.send("price?");
    const answer = c.store.getState().messages[1];
    expect(answer.error).toEqual({ code: "daily_cap", message: "" });
    fail = false;
    await c.retry(answer.localId);
    expect(c.store.getState().messages[1]).toMatchObject({ text: "ok", error: null, messageId: "m3" });
  });

  it("seeds a resumed conversation's history once, ahead of what the visitor typed", async () => {
    let release: (s: SiteAssistantSession) => void = () => {};
    const api = makeApi(async (_sid, _t, _b, onEvent) => onEvent({ type: "done", message_id: "m", answered: true, billed: false }));
    const c = createSiteAssistantController({
      api,
      source: {
        get: () => new Promise((r) => (release = r)),
        refresh: async () => session("s2"),
      },
      getPage: () => page,
    });
    const sending = c.send("second question");
    release(
      session("s1", [
        { role: "user", content: "first question", cards: [], message_id: "1", answered: null, feedback: null },
        { role: "assistant", content: "first answer", cards: [], message_id: "2", answered: true, feedback: 1 },
      ]),
    );
    await sending;
    expect(c.store.getState().messages.map((m) => m.text)).toEqual(["first question", "first answer", "second question", ""]);
    // A later re-issue never duplicates history.
    c.adoptSession(session("s3", [{ role: "user", content: "first question", cards: [], message_id: "1", answered: null, feedback: null }]));
    expect(c.store.getState().messages).toHaveLength(4);
  });

  it("rates optimistically and rolls back when the server refuses", async () => {
    const api = makeApi(async (_sid, _t, _b, onEvent) => onEvent({ type: "done", message_id: "m1", answered: true, billed: true }));
    (api.feedback as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const c = createSiteAssistantController({
      api,
      source: { get: async () => session("s1"), refresh: async () => session("s2") },
      getPage: () => page,
    });
    await c.send("hi");
    const answer = c.store.getState().messages[1];
    await c.rate(answer.localId, -1);
    expect(c.store.getState().messages[1].feedback).toBeNull();
    await c.rate(answer.localId, 1);
    expect(c.store.getState().messages[1].feedback).toBe(1);
    expect(api.feedback).toHaveBeenLastCalledWith("s1", "tok-s1", "m1", 1);
  });
});

describe("reload-resume storage", () => {
  it("keeps a visitor id and a session id for 12 h", () => {
    localStorage.clear();
    const v = getVisitorId();
    expect(getVisitorId()).toBe(v);
    storeSessionId("brahm", "s1", 1000);
    expect(getStoredSessionId("brahm", 1000 + RESUME_WINDOW_MS - 1)).toBe("s1");
    expect(getStoredSessionId("brahm", 1000 + RESUME_WINDOW_MS + 1)).toBeNull();
  });

  it("works (without resume) when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const spySet = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(getVisitorId()).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(getStoredSessionId("brahm")).toBeNull();
    expect(() => storeSessionId("brahm", "s1")).not.toThrow();
    spy.mockRestore();
    spySet.mockRestore();
  });
});
