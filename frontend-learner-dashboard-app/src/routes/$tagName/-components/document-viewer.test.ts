// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  useParams: () => ({ tagName: "tag" }),
  useRouter: () => ({ navigate: () => {} }),
  Link: () => null,
}));
import React from "react";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";

/**
 * `documentViewer` shows a PDF on the page (inline) or behind one button that
 * opens a full-screen reader. pdf.js is lazy-loaded, so SSR only ever paints
 * the host chrome — which is exactly what these assert: the section is wired
 * into the renderer, each display paints its own controls, and a missing URL
 * degrades to a placeholder instead of an empty viewer.
 */
const PDF = "https://cdn.example.com/CATALOGUE_DOCUMENTS/ADMIN/abc-the7cs-book-catalogue.pdf";

const page = (props: Record<string, unknown>) => ({
  id: "p", route: "p", title: "p",
  components: [{ id: "doc", type: "documentViewer", enabled: true, props }],
});

const render = (props: Record<string, unknown>) =>
  renderToString(
    React.createElement(JsonRenderer, {
      page: page(props), globalSettings: {} as never,
      instituteId: "inst", tagName: "tag",
    } as never),
  );

describe("documentViewer", () => {
  it("is a known component type and paints its heading", () => {
    const html = render({ heading: "Our books catalogue", documentUrl: PDF });
    expect(html).toContain("Our books catalogue");
    expect(html).not.toContain("Unknown component");
  });

  it("button display renders the open button and a download button, not a viewer", () => {
    const html = render({ heading: "Catalogue", documentUrl: PDF, buttonText: "Click to access" });
    expect(html).toContain("Click to access");
    expect(html).toContain("jsonRenderer.documentViewer.download");
    expect(html).not.toContain("rpv-core__viewer");
  });

  it("button display falls back to the translated open label", () => {
    const html = render({ documentUrl: PDF });
    expect(html).toContain("jsonRenderer.documentViewer.open");
  });

  it("inline display paints the frame with the file name and a full-screen control", () => {
    const html = render({ documentUrl: PDF, display: "inline", height: "520px" });
    expect(html).toContain("the7cs-book-catalogue.pdf");
    expect(html).toContain("jsonRenderer.documentViewer.fullScreen");
    expect(html).toContain("height:520px");
  });

  it("a custom fileName wins and is forced to .pdf", () => {
    const html = render({ documentUrl: PDF, display: "inline", fileName: "The7Cs Catalogue" });
    expect(html).toContain("The7Cs Catalogue.pdf");
  });

  it("showDownload=false hides the download control", () => {
    const html = render({ documentUrl: PDF, display: "inline", showDownload: false });
    expect(html).not.toContain("jsonRenderer.documentViewer.download");
  });

  it("without a document URL it renders the placeholder instead of a viewer", () => {
    const html = render({ heading: "Coming soon" });
    expect(html).toContain("jsonRenderer.documentViewer.noDocument");
    expect(html).not.toContain("jsonRenderer.documentViewer.open");
  });

  // The catalogue has no error boundary: any throw here blanks the whole page,
  // so stored JSON with odd values must degrade, never crash.
  it("survives null / non-string props from stored JSON", () => {
    expect(() => render({ documentUrl: null, heading: null, fileName: 42, coverImage: null, buttonText: null })).not.toThrow();
    expect(() => render({ documentUrl: PDF, heading: { bad: true }, subheading: ["x"] })).not.toThrow();
    expect(render({ documentUrl: null })).toContain("jsonRenderer.documentViewer.noDocument");
    const html = render({ documentUrl: PDF, display: "inline", fileName: 42 });
    expect(html).toContain("42.pdf");
  });

  it("a malformed percent-escape in the URL does not throw (URIError) and still names the file", () => {
    const bad = "https://cdn.example.com/docs/brochure%E0%A4.pdf";
    expect(() => render({ documentUrl: bad, display: "inline" })).not.toThrow();
    expect(render({ documentUrl: bad, display: "inline" })).toContain("brochure%E0%A4.pdf");
  });

  it("button display shows the cover image when provided", () => {
    const html = render({ documentUrl: PDF, coverImage: "https://cdn.example.com/cover.jpg" });
    expect(html).toContain('src="https://cdn.example.com/cover.jpg"');
  });
});
