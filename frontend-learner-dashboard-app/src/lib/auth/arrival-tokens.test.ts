import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Carried = {
  accessToken: string | null;
  refreshToken: string | null;
  path: string;
};

function stubWindow(address: string, carried?: Carried) {
  const url = new URL(address, "https://learner.example");
  const win = {
    location: { search: url.search, pathname: url.pathname },
    __arrivalTokens: carried,
  };
  vi.stubGlobal("window", win);
  return win;
}

const load = () => import("./arrival-tokens");

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const TOKENS = { accessToken: "A1", refreshToken: "R1" };
const carriedFrom = (path: string): Carried => ({ ...TOKENS, path });
const EMPTY = { accessToken: null, refreshToken: null };

describe("readArrivalTokens", () => {
  it("returns nothing outside a browser", async () => {
    const { readArrivalTokens, hasArrivalTokens } = await load();
    expect(readArrivalTokens()).toEqual(EMPTY);
    expect(hasArrivalTokens()).toBe(false);
  });

  it("returns nothing on an ordinary page", async () => {
    stubWindow("/dashboard?x=1");
    const { readArrivalTokens, hasArrivalTokens } = await load();
    expect(readArrivalTokens("/dashboard")).toEqual(EMPTY);
    expect(hasArrivalTokens()).toBe(false);
  });

  it("falls back to the live address when the inline script did not run", async () => {
    stubWindow("/login?accessToken=A1&refreshToken=R1");
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/login")).toEqual(TOKENS);
    expect(readArrivalTokens()).toEqual(TOKENS);
  });

  it("keeps a lone token, as the address would", async () => {
    stubWindow("/login?refreshToken=R1");
    const live = await load();
    expect(live.readArrivalTokens()).toEqual({ accessToken: null, refreshToken: "R1" });

    vi.resetModules();
    stubWindow("/login", { accessToken: null, refreshToken: "R1", path: "/login" });
    const held = await load();
    expect(held.readArrivalTokens()).toEqual({ accessToken: null, refreshToken: "R1" });
  });

  it("takes the values off window once loaded", async () => {
    const win = stubWindow("/login", carriedFrom("/login"));
    const { readArrivalTokens } = await load();
    expect("__arrivalTokens" in win).toBe(false);
    expect(readArrivalTokens()).toEqual(TOKENS);
  });

  it("stays readable on the arrival path, for repeat beforeLoad runs and mount fallbacks", async () => {
    stubWindow("/login", carriedFrom("/login"));
    const { readArrivalTokens, hasArrivalTokens } = await load();
    expect(readArrivalTokens("/login")).toEqual(TOKENS);
    expect(readArrivalTokens("/login")).toEqual(TOKENS);
    expect(readArrivalTokens()).toEqual(TOKENS);
    expect(hasArrivalTokens()).toBe(true);
  });

  it("does not return them for a router destination on another path, though the window has not moved yet", async () => {
    stubWindow("/login", carriedFrom("/login"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/courses")).toEqual(EMPTY);
  });

  it("does not bring them back after a move away and back to the arrival path", async () => {
    const win = stubWindow("/login", carriedFrom("/login"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/signup")).toEqual(EMPTY);
    win.location.pathname = "/signup";
    win.location.pathname = "/login";
    expect(readArrivalTokens("/login")).toEqual(EMPTY);
    expect(readArrivalTokens()).toEqual(EMPTY);
  });

  it("drops them when a mount read finds the window on another path", async () => {
    const win = stubWindow("/login", carriedFrom("/login"));
    const { readArrivalTokens } = await load();
    win.location.pathname = "/dashboard";
    expect(readArrivalTokens()).toEqual(EMPTY);
    win.location.pathname = "/login";
    expect(readArrivalTokens()).toEqual(EMPTY);
  });

  it("treats a trailing slash as the same path", async () => {
    stubWindow("/login/", carriedFrom("/login/"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/login")).toEqual(TOKENS);
    expect(readArrivalTokens("/login/")).toEqual(TOKENS);
  });

  it("treats the root path as itself", async () => {
    stubWindow("/", carriedFrom("/"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/")).toEqual(TOKENS);
  });

  it("matches a path the router decoded", async () => {
    stubWindow("/caf%C3%A9", carriedFrom("/caf%C3%A9"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/café")).toEqual(TOKENS);
  });

  it("does not throw on a malformed path", async () => {
    stubWindow("/login", carriedFrom("/bad%E0%A4%A"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/bad%E0%A4%A")).toEqual(TOKENS);
  });

  it("returns a copy without the path", async () => {
    stubWindow("/login", carriedFrom("/login"));
    const { readArrivalTokens } = await load();
    expect(Object.keys(readArrivalTokens()).sort()).toEqual(["accessToken", "refreshToken"]);
  });
});

describe("clearArrivalTokens", () => {
  it("stops a same-path re-run after the tokens are used", async () => {
    stubWindow("/dashboard", carriedFrom("/dashboard"));
    const { clearArrivalTokens, readArrivalTokens, hasArrivalTokens } = await load();
    expect(readArrivalTokens("/dashboard")).toEqual(TOKENS);
    clearArrivalTokens();
    expect(readArrivalTokens("/dashboard")).toEqual(EMPTY);
    expect(hasArrivalTokens()).toBe(false);
  });
});

describe("the copy held for a reload", () => {
  function stubTab(address: string, held?: unknown) {
    const stored = new Map<string, string>();
    if (held !== undefined) stored.set("arrivalTokens", JSON.stringify(held));
    const url = new URL(address, "https://learner.example");
    vi.stubGlobal("window", {
      location: { search: url.search, pathname: url.pathname },
      sessionStorage: {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
        removeItem: (k: string) => void stored.delete(k),
      },
    });
    return stored;
  }
  const heldOn = (path: string, ageMs = 1000) => ({
    ...TOKENS,
    path,
    at: Date.now() - ageMs,
  });

  it("finishes a sign-in after a reload on the arrival path", async () => {
    stubTab("/auth-transfer?redirect=%2Fx", heldOn("/auth-transfer"));
    const { readArrivalTokens, hasArrivalTokens } = await load();
    expect(readArrivalTokens("/auth-transfer")).toEqual(TOKENS);
    expect(hasArrivalTokens()).toBe(true);
  });

  it("is removed once the tokens are used", async () => {
    const stored = stubTab("/auth-transfer", heldOn("/auth-transfer"));
    const { clearArrivalTokens, readArrivalTokens } = await load();
    clearArrivalTokens();
    expect(stored.size).toBe(0);
    expect(readArrivalTokens("/auth-transfer")).toEqual(EMPTY);
  });

  it("is removed when the learner moves to another path", async () => {
    const stored = stubTab("/dashboard", heldOn("/auth-transfer"));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/dashboard")).toEqual(EMPTY);
    expect(stored.size).toBe(0);
  });

  it("is not used, and is removed, once it is too old", async () => {
    const stored = stubTab("/auth-transfer", heldOn("/auth-transfer", 6 * 60 * 1000));
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/auth-transfer")).toEqual(EMPTY);
    expect(stored.size).toBe(0);
  });

  it("is ignored and removed when it cannot be read", async () => {
    const stored = stubTab("/auth-transfer");
    stored.set("arrivalTokens", "not json");
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/auth-transfer")).toEqual(EMPTY);
    expect(stored.size).toBe(0);
  });

  it("gives way to values that came with this load", async () => {
    stubTab("/login", heldOn("/login"));
    const win = window as unknown as { __arrivalTokens?: Carried };
    win.__arrivalTokens = { accessToken: "A2", refreshToken: "R2", path: "/login" };
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/login")).toEqual({ accessToken: "A2", refreshToken: "R2" });
  });

  it("never throws when session storage is unavailable", async () => {
    stubWindow("/auth-transfer");
    const { clearArrivalTokens, readArrivalTokens } = await load();
    expect(() => clearArrivalTokens()).not.toThrow();
    expect(readArrivalTokens("/auth-transfer")).toEqual(EMPTY);
  });
});

// The inline script, run as written in each HTML entry.
const ENTRIES = ["index.html", "public/oauth-popup-handler.html"];

function inlineScript(file: string) {
  const html = readFileSync(resolve(process.cwd(), file), "utf8");
  const match = html.match(/<script>\s*\/\/ Sign-in hand-off[\s\S]*?<\/script>/);
  if (!match) throw new Error(`no hand-off script in ${file}`);
  return { html, script: match[0].replace(/<\/?script>/g, "") };
}

function runInline(
  script: string,
  address: string,
  overrides: Record<string, unknown> = {},
) {
  const url = new URL(address, "https://learner.example");
  const writes: unknown[][] = [];
  const window: { __arrivalTokens?: Carried } = {};
  const stored = new Map<string, string>();
  const sandbox = {
    window,
    Date,
    JSON,
    sessionStorage: { setItem: (k: string, v: string) => void stored.set(k, v) },
    location: { search: url.search, pathname: url.pathname, hash: url.hash },
    history: {
      state: { __TSR_index: 3 },
      replaceState: (...args: unknown[]) => writes.push(args),
    },
    URLSearchParams,
    Object,
    ...overrides,
  };
  runInNewContext(script, sandbox);
  return { writes, carried: window.__arrivalTokens, stored };
}

describe.each(ENTRIES)("the inline script in %s", (file: string) => {
  const { script } = inlineScript(file);

  it("removes the tokens and keeps everything else byte for byte", () => {
    const { writes, carried } = runInline(
      script,
      "/login/oauth/learner?state=a%20b+c&accessToken=A1&sso=true&refreshToken=R1&x=%7B%22y%22%3A1%7D#frag",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toEqual({ __TSR_index: 3 });
    expect(writes[0][2]).toBe(
      "/login/oauth/learner?state=a%20b+c&sso=true&x=%7B%22y%22%3A1%7D#frag",
    );
    expect(carried).toMatchObject({
      accessToken: "A1",
      refreshToken: "R1",
      path: "/login/oauth/learner",
    });
  });

  it("leaves no question mark behind when only tokens were there", () => {
    const { writes } = runInline(script, "/auth-transfer?accessToken=A1&refreshToken=R1");
    expect(writes[0][2]).toBe("/auth-transfer");
  });

  it("writes nothing on an address without tokens", () => {
    const { writes, carried } = runInline(script, "/dashboard?accessTokenish=1&x=accessToken#a");
    expect(writes).toHaveLength(0);
    expect(carried).toBeUndefined();
  });

  it("catches an encoded key and every duplicate, reading the first value", () => {
    const { writes, carried } = runInline(
      script,
      "/login?access%54oken=A1&accessToken=A2&refreshToken=r%2Bt&refreshToken=R2&keep=1",
    );
    expect(writes[0][2]).toBe("/login?keep=1");
    expect(carried?.accessToken).toBe("A1");
    expect(carried?.refreshToken).toBe("r+t");
  });

  it("removes a lone token", () => {
    const { writes, carried } = runInline(script, "/login?refreshToken=R1");
    expect(writes[0][2]).toBe("/login");
    expect(carried?.accessToken).toBeNull();
    expect(carried?.refreshToken).toBe("R1");
  });

  it("never throws when the address cannot be written, and the address still holds the tokens", () => {
    const history = {
      state: null,
      replaceState: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() =>
      runInline(script, "/login?accessToken=A1&refreshToken=R1", { history }),
    ).not.toThrow();
  });

  it("never throws on a browser without URLSearchParams", () => {
    const { writes } = runInline(script, "/login?accessToken=A1", {
      URLSearchParams: undefined,
    });
    expect(writes).toHaveLength(0);
  });

  it("is plain ES5", () => {
    const code = script.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/=>|`|\b(let|const|class)\b|\.\.\./);
  });
});

describe("the page structure", () => {
  it("puts the script straight after the charset, ahead of every other script", () => {
    for (const file of ENTRIES) {
      const { html, script } = inlineScript(file);
      const firstScript = html.indexOf("<script");
      expect(html.indexOf(script)).toBe(firstScript + "<script>".length);
      expect(html.slice(0, firstScript).trim()).toMatch(/<meta charset="UTF-8"\s*\/?>$/);
    }
  });

  it("leaves the first <head> as the tag the audience form build replaces", () => {
    const { html } = inlineScript("index.html");
    expect(html.indexOf("<head>")).toBeLessThan(html.indexOf("Sign-in hand-off"));
  });

  it("keeps the handler reading the values it no longer finds in the address", () => {
    const { html } = inlineScript("public/oauth-popup-handler.html");
    expect(html).toContain("(window.__arrivalTokens || {}).accessToken");
    expect(html).toContain("(window.__arrivalTokens || {}).refreshToken");
  });
});

describe("the copy held by the script in index.html", () => {
  const { script } = inlineScript("index.html");

  it("is written with the arrival path and time", () => {
    const { stored } = runInline(script, "/login?accessToken=A1&refreshToken=R1");
    const held = JSON.parse(stored.get("arrivalTokens") ?? "{}");
    expect(held).toMatchObject({ ...TOKENS, path: "/login" });
    expect(typeof held.at).toBe("number");
  });

  it("is not written on an address without tokens", () => {
    expect(runInline(script, "/login?x=1").stored.size).toBe(0);
  });

  it("still clears the address when session storage throws", () => {
    const { writes, carried } = runInline(script, "/login?accessToken=A1&refreshToken=R1", {
      sessionStorage: {
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(writes[0][2]).toBe("/login");
    expect(carried?.accessToken).toBe("A1");
  });
});

describe("the helper reading what the inline script left", () => {
  it("gets the values through the real hand-over", async () => {
    const { script } = inlineScript("index.html");
    const { writes, carried } = runInline(script, "/login?sso=true&accessToken=A1&refreshToken=R1");
    expect(writes[0][2]).toBe("/login?sso=true");
    // Rebuilt with the same shape: the sandbox object belongs to another realm.
    stubWindow(String(writes[0][2]), { ...(carried as Carried) });
    const { readArrivalTokens } = await load();
    expect(readArrivalTokens("/login")).toEqual(TOKENS);
  });
});
