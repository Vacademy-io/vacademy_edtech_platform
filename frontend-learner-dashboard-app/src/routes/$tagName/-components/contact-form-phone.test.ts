// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";

/**
 * The catalogue contact form renders a bare <input> for every field, which gave
 * the Ask Mira form a phone box with no country code — leads reached the CRM as
 * bare 10-digit numbers. A phone-typed field must render the country picker.
 */
const page = {
  id: "p",
  route: "p",
  title: "p",
  components: [
    {
      id: "f",
      type: "contactForm",
      enabled: true,
      props: {
        heading: "Ask Mira a question",
        fields: [
          { name: "name", label: "Your name", type: "text", required: true },
          { name: "email", label: "Email address", type: "email", required: true },
          { name: "phone", label: "Phone number", type: "tel", required: false },
          { name: "question", label: "Your question for Mira", type: "textarea", required: true },
        ],
        submitLabel: "Send my question",
      },
    },
  ],
};

const html = renderToString(
  React.createElement(JsonRenderer, {
    page,
    globalSettings: {} as never,
    instituteId: "inst",
    tagName: "tag",
  } as never)
);

describe("catalogue contactForm phone field", () => {
  it("renders a country-code picker for the phone field", () => {
    // react-phone-input-2 markup: the dropdown button carries these classes.
    expect(html).toContain("flag-dropdown");
    expect(html).toContain("selected-flag");
  });

  it("still renders the other fields normally", () => {
    expect(html).toContain("Your question for Mira");
    expect(html).toContain("<textarea");
    expect(html).toContain('type="email"');
  });

  it("routes the phone through react-phone-input-2, not the plain input branch", () => {
    // The library renders its own type="tel" input; what must NOT appear is the
    // generic field input carrying the form's shared class list.
    expect(html).toContain("react-tel-input");
    expect(html).toContain('title="India: + 91"');
    expect(html).not.toMatch(/<input type="tel" required="" class="w-full rounded-lg/);
  });

  it("shows a real placeholder rather than the library's US sample number", () => {
    expect(html).not.toContain("1 (702) 123-4567");
  });
});
