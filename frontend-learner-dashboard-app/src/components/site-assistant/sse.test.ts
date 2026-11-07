// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSseParser, toStreamEvent, type RawSseEvent } from "./sse";
import { createSiteAssistantApi, SiteAssistantApiError } from "./api";
import type { SiteAssistantStreamEvent } from "./types";

const collect = (chunks: string[], end = true): RawSseEvent[] => {
  const out: RawSseEvent[] = [];
  const p = createSseParser((e) => out.push(e));
  chunks.forEach((c) => p.push(c));
  if (end) p.end();
  return out;
};

describe("createSseParser", () => {
  it("parses named events with JSON data", () => {
    const out = collect(['event: token\ndata: {"text":"Hi"}\n\n', 'event: done\ndata: {"message_id":"7"}\n\n']);
    expect(out).toEqual([
      { event: "token", data: '{"text":"Hi"}', id: undefined },
      { event: "done", data: '{"message_id":"7"}', id: undefined },
    ]);
  });

  it("survives any chunk split — inside field names, JSON and CRLF pairs", () => {
    const stream = 'event: token\r\ndata: {"text":"Namaste 🙏"}\r\n\r\nevent: card\r\ndata: {"type":"notice"}\r\n\r\n';
    const whole = collect([stream]);
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < stream.length; i += size) chunks.push(stream.slice(i, i + size));
      expect(collect(chunks)).toEqual(whole);
    }
    expect(whole.map((e) => e.event)).toEqual(["token", "card"]);
  });

  it("joins multi-line data, ignores comments and defaults the event name", () => {
    const out = collect([": keep-alive\n\ndata: line one\ndata: line two\n\n"]);
    expect(out).toEqual([{ event: "message", data: "line one\nline two", id: undefined }]);
  });

  it("ignores the server's `: ping` keep-alives between and inside events, in any split", () => {
    const stream = ': ping\n\nevent: token\ndata: {"text":"Hi"}\n\n: ping\n\n: ping\n\nevent: done\n: ping\ndata: {}\n\n';
    for (let size = 1; size <= 5; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < stream.length; i += size) chunks.push(stream.slice(i, i + size));
      expect(collect(chunks).map((e) => e.event)).toEqual(["token", "done"]);
    }
  });

  it("does not dispatch a block without data, and flushes an unterminated last block on end()", () => {
    expect(collect(["event: token\n\n"])).toEqual([]);
    expect(collect(['event: done\ndata: {"answered":true}'], false)).toEqual([]);
    expect(collect(['event: done\ndata: {"answered":true}'])).toHaveLength(1);
  });
});

/** The exact bytes ai_service's router.sse("card", card) writes for a course list (json.dumps, ensure_ascii=False). */
const AI_SERVICE_CARD_FRAME =
  'event: card\ndata: {"type": "course_list", "items": [{"id": "c1", "title": "Vedic Parenting", "subtitle": null, "image_url": "https://cdn.example.org/vp.jpg", "price_label": "₹4,999", "url": "/bv/course/vedic-parenting", "badges": ["Bestseller"], "languages": ["Hindi"], "format_labels": ["Live"], "availability": null}], "more_url": "/bv/courses"}\n\n';

describe("toStreamEvent", () => {
  it("reads the card ai_service actually streams: flat {type, ...fields}", () => {
    const [raw] = collect([AI_SERVICE_CARD_FRAME]);
    expect(toStreamEvent(raw)).toEqual({
      type: "card",
      card: {
        type: "course_list",
        more_url: "/bv/courses",
        items: [
          expect.objectContaining({ id: "c1", title: "Vedic Parenting", price_label: "₹4,999", url: "/bv/course/vedic-parenting" }),
        ],
      },
    });
    // The old wrapped shape is still read.
    expect(toStreamEvent({ event: "card", data: JSON.stringify({ card: { type: "notice", title: "T", body: "B" } }) })).toMatchObject({
      card: { type: "notice", title: "T" },
    });
  });

  it("maps the four SPEC events", () => {
    expect(toStreamEvent({ event: "token", data: '{"text":"Hello"}' })).toEqual({ type: "token", text: "Hello" });
    expect(toStreamEvent({ event: "done", data: '{"message_id":42,"answered":false,"billed":true}' })).toEqual({
      type: "done",
      message_id: "42",
      answered: false,
      billed: true,
    });
    expect(toStreamEvent({ event: "error", data: '{"code":"daily_cap","message":"cap"}' })).toEqual({
      type: "error",
      code: "daily_cap",
      message: "cap",
    });
  });

  it("treats unknown error codes as internal and drops junk frames", () => {
    expect(toStreamEvent({ event: "error", data: '{"code":"weird"}' })).toMatchObject({ code: "internal" });
    expect(toStreamEvent({ event: "token", data: "not json" })).toBeNull();
    expect(toStreamEvent({ event: "ping", data: "{}" })).toBeNull();
    // A card whose link is not https/site-relative is not a card.
    expect(
      toStreamEvent({ event: "card", data: JSON.stringify({ type: "page_link", title: "x", href: "javascript:alert(1)" }) }),
    ).toBeNull();
  });
});

const sseResponse = (chunks: string[], status = 200): Response => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(enc.encode(c)));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
};

describe("api.streamMessage", () => {
  const body = { text: "Any free class?", page: { url: "https://s/x", route: "/x", title: "X" }, client_msg_id: "c1" };

  it("streams token → card → done in order, with the bearer token", async () => {
    let seen: RequestInit | undefined;
    const api = createSiteAssistantApi("https://api/sa", async (_url, init) => {
      seen = init;
      return sseResponse([
        'event: token\ndata: {"text":"Yes, "}\n\n',
        ": ping\n\n",
        'event: token\ndata: {"text":"tomorrow."}\n\nevent: card\ndata: {"type": "notice", "title": "Batch", "body": "New batch"}\n\n',
        AI_SERVICE_CARD_FRAME,
        'event: done\ndata: {"message_id":"m1","answered":true,"billed":true}\n\n',
      ]);
    });
    const events: SiteAssistantStreamEvent[] = [];
    await api.streamMessage("s1", "tok", body, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["token", "token", "card", "card", "done"]);
    expect(events[3]).toMatchObject({ type: "card", card: { type: "course_list" } });
    expect((seen?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(seen?.body))).toEqual(body);
  });

  it("maps HTTP refusals to error codes", async () => {
    const respond = (status: number, json: unknown) =>
      createSiteAssistantApi("https://api/sa", async () =>
        new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }),
      );
    await expect(respond(401, { detail: "expired" }).streamMessage("s", "t", body, () => {})).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(respond(429, { detail: { code: "daily_cap", message: "cap" } }).streamMessage("s", "t", body, () => {})).rejects.toMatchObject({
      code: "daily_cap",
    });
    await expect(respond(500, {}).streamMessage("s", "t", body, () => {})).rejects.toBeInstanceOf(SiteAssistantApiError);
  });

  it("keeps each ai_service refusal code instead of collapsing it to internal", async () => {
    const codeOf = async (status: number, code: string) => {
      const api = createSiteAssistantApi("https://api/sa", async () =>
        new Response(JSON.stringify({ detail: { code, message: "m" } }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
      const err = await api.createSession({ site_tag: "bv", page: body.page }).catch((e: unknown) => e);
      return (err as SiteAssistantApiError).code;
    };
    expect(await codeOf(403, "disabled")).toBe("disabled");
    expect(await codeOf(503, "disabled")).toBe("disabled");
    expect(await codeOf(403, "origin_not_allowed")).toBe("not_allowed");
    expect(await codeOf(403, "unknown_site")).toBe("not_allowed");
    expect(await codeOf(401, "invalid_api_key")).toBe("unauthorized");
    expect(await codeOf(403, "closed")).toBe("closed");
    expect(await codeOf(403, "forbidden")).toBe("unauthorized");
    expect(await codeOf(404, "not_found")).toBe("disabled");
    expect(await codeOf(400, "invalid")).toBe("invalid");
    expect(await codeOf(429, "rate_limited")).toBe("rate_limited");
    // A code this client does not know keeps the HTTP status's meaning, not "internal".
    expect(await codeOf(403, "something_new")).toBe("disabled");
  });

  it("reports a stream that ends without done/error as a network error", async () => {
    const api = createSiteAssistantApi("https://api/sa", async () => sseResponse(['event: token\ndata: {"text":"Hal"}\n\n']));
    await expect(api.streamMessage("s", "t", body, () => {})).rejects.toMatchObject({ code: "network" });
  });
});
