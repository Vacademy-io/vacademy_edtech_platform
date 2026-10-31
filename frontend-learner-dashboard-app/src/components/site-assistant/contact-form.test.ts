// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  buildContactFields,
  buildContactSchema,
  emptyContactValues,
  roleOf,
  stripInstSuffix,
  toContactBody,
  type ContactMessages,
} from "./contact-form";
import { normalizeCard } from "./cards-normalize";
import { ContactFormCard } from "./ContactFormCard";
import { SiteAssistantUiContext } from "./context";
import { createSiteAssistantController } from "./controller";
import type { SiteAssistantApi } from "./api";
import type { ContactFormField, SiteAssistantCard } from "./types";

const labels = { name: "Full name", email: "Email", phone: "Phone number" };
const msg: ContactMessages = {
  required: (l) => `${l} is required`,
  email: "bad email",
  phone: "bad phone",
  oneOf: "phone or email",
  consent: "consent please",
  tooLong: "too long",
};

const f = (key: string, type = "text", required = false, options?: string[]): ContactFormField => ({
  key,
  label: key,
  type,
  required,
  options,
});

describe("contact form fields", () => {
  it("recognises name / email / phone fields by type or key", () => {
    expect(roleOf(f("full_name"))).toBe("name");
    expect(roleOf(f("x", "email"))).toBe("email");
    expect(roleOf(f("mobile_number"))).toBe("phone");
    expect(roleOf(f("x", "tel"))).toBe("phone");
    expect(roleOf(f("city", "dropdown", false, ["Delhi"]))).toBe("select");
    expect(roleOf(f("city", "dropdown"))).toBe("text");
  });

  it("reads a campaign's own name / phone field through admin_core's _inst_<instituteId> suffix", () => {
    // Brahm Varchas-style keys: slug + "_inst_" + the institute's UUID (> 64 characters).
    const inst = "_inst_8a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d";
    expect(stripInstSuffix(`full_name${inst}`)).toBe("full_name");
    expect(stripInstSuffix(`city${inst}_2`)).toBe("city");
    expect(stripInstSuffix("institute_name")).toBe("institute_name");
    const specs = buildContactFields(
      [f(`full_name${inst}`, "text", true), f(`phone_number${inst}`), f(`which_course_are_you_interested_in${inst}`)],
      labels,
    );
    // One name input (the campaign's), never a second default one.
    expect(specs.map((s) => s.role)).toEqual(["name", "phone", "text"]);
    expect(specs.filter((s) => s.role === "name")).toHaveLength(1);
  });

  it("keeps a campaign field whose key is over 64 characters (suffix dropped) instead of dropping it", () => {
    const longKey = "which_course_are_you_interested_in_inst_8a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d";
    expect(longKey.length).toBeGreaterThan(64);
    const card = normalizeCard({
      type: "contact_form",
      kind: "SALES",
      reason: "r",
      campaign_id: "camp-bv",
      consent_text: "ok",
      fields: [
        { key: "full_name", label: "Full Name", type: "text", required: true },
        { key: longKey, label: "Which course?", type: "dropdown", options: ["Vedic Parenting"] },
        { key: "x".repeat(70), label: "junk", type: "text" },
      ],
    });
    expect(card?.type === "contact_form" && card.fields.map((x) => x.key)).toEqual([
      "full_name",
      "which_course_are_you_interested_in",
    ]);
  });

  it("always yields a required name and some way to reach the visitor", () => {
    const specs = buildContactFields([f("city", "text")], labels);
    expect(specs.map((s) => s.role)).toEqual(["name", "text", "phone", "email"]);
    expect(specs[0].required).toBe(true);
    const withPhone = buildContactFields([f("name"), f("phone", "phone", true), f("phone2", "phone")], labels);
    expect(withPhone.map((s) => s.role)).toEqual(["name", "phone"]);
    expect(withPhone[0].required).toBe(true);
  });

  it("validates required, email, phone, one-of and consent", () => {
    const specs = buildContactFields([f("name", "text", true), f("email", "email"), f("phone", "phone")], labels);
    const schema = buildContactSchema(specs, msg);
    const empty = schema.safeParse(emptyContactValues(specs));
    expect(empty.success).toBe(false);
    const issues = empty.success ? [] : empty.error.issues.map((i) => i.message);
    expect(issues).toEqual(expect.arrayContaining(["name is required", "consent please", "phone or email"]));

    const bad = schema.safeParse({ f0: "Asha", f1: "not-an-email", f2: "+91123", consent: true });
    const badMsgs = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(badMsgs).toEqual(expect.arrayContaining(["bad email", "bad phone"]));

    expect(schema.safeParse({ f0: "Asha", f1: "", f2: "+919876543210", consent: true }).success).toBe(true);
    expect(schema.safeParse({ f0: "Asha", f1: "asha@example.com", f2: "+91", consent: true }).success).toBe(true);
  });

  it("maps values to the /contact body: name/email/phone out, the rest as fields", () => {
    const specs = buildContactFields(
      [f("full_name", "text", true), f("email", "email"), f("phone", "phone"), f("child_age", "number"), f("wants_hindi", "checkbox")],
      labels,
    );
    const body = toContactBody(
      specs,
      { f0: " Asha ", f1: "asha@example.com", f2: "+91", f3: "6", f4: true, consent: true },
      "SALES",
      ["c1"],
    );
    expect(body).toEqual({
      kind: "SALES",
      full_name: "Asha",
      email: "asha@example.com",
      fields: { child_age: "6", wants_hindi: true },
      consent: true,
      course_ids: ["c1"],
    });
  });
});

// ── the card in the DOM ─────────────────────────────────────────────────────

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement;

beforeAll(async () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../locales/en/siteAssistant.json"), "utf8"));
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "siteAssistant"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: { en: { common: {}, siteAssistant: catalog } },
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

const typeInto = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe("ContactFormCard", () => {
  it("shows inline errors, then sends the lead and shows the success state", async () => {
    const contact = vi.fn(async () => ({ status: "received" }));
    const controller = createSiteAssistantController({
      api: { contact } as unknown as SiteAssistantApi,
      source: {
        get: async () => ({
          session_id: "s1",
          token: "t1",
          expires_at: null,
          assistant: { name: null, avatar_url: null, greeting: null, suggestions: [], accent_color: null, position: null, persona: null },
          history: [],
        }),
        refresh: () => new Promise(() => {}),
      },
      getPage: () => ({ url: "", route: "", title: "" }),
    });
    const onLeadSubmitted = vi.fn();
    const card: SiteAssistantCard = {
      type: "contact_form",
      kind: "SALES",
      reason: "So our counsellor can call you about Vedic Parenting",
      campaign_id: "camp1",
      fields: [f("full_name", "text", true), f("email", "email"), f("city", "dropdown", false, ["Delhi", "Pune"])],
      consent_text: "I agree to be contacted by Brahm Varchas.",
      course_ids: ["c1"],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        e(
          I18nextProvider,
          { i18n: i18next },
          e(SiteAssistantUiContext.Provider, { value: { controller, consentText: null, onLeadSubmitted } }, e(ContactFormCard, { card, cardKey: "m1:0" })),
        ),
      );
    });

    expect(host.textContent).toContain("So our counsellor can call you about Vedic Parenting");
    expect(host.textContent).toContain("I agree to be contacted by Brahm Varchas.");

    const submit = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => submit.click());
    await flush();
    expect(host.textContent).toContain("full_name is required");
    expect(host.textContent).toContain("Enter a phone number or an email address");
    expect(host.textContent).toContain("Please agree so that we can contact you");
    expect(contact).not.toHaveBeenCalled();

    const inputs = Array.from(host.querySelectorAll("input")) as HTMLInputElement[];
    const [name, email] = inputs.filter((i) => i.type === "text" || i.type === "email");
    const consent = inputs.find((i) => i.type === "checkbox")!;
    await act(async () => typeInto(email, "not-an-email"));
    await act(async () => typeInto(name, "Asha Rao"));
    await act(async () => submit.click());
    await flush();
    expect(host.textContent).toContain("Enter a valid email address");

    await act(async () => typeInto(email, "asha@example.com"));
    await act(async () => typeInto(host.querySelector("select")!, "Pune"));
    await act(async () => consent.click());
    await act(async () => submit.click());
    await flush();
    await flush();

    expect(contact).toHaveBeenCalledWith("s1", "t1", {
      kind: "SALES",
      full_name: "Asha Rao",
      email: "asha@example.com",
      fields: { city: "Pune" },
      consent: true,
      course_ids: ["c1"],
    });
    expect(onLeadSubmitted).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-state="success"]')?.textContent).toContain("Our team will get in touch");
  });
});
