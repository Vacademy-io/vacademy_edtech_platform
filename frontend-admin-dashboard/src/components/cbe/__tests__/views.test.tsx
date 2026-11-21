import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentView } from "../DocumentView";
import { SheetView } from "../SheetView";
import { xlsxToCbeSheet } from "../xlsx-import";
import type { CbeSheet } from "../types";

const FIXTURE = path.resolve(__dirname, "fixtures/cbe-mini-solution.xlsx");

describe("SheetView", () => {
  it("renders formatted values, formula tooltips, merges and tabs from an imported workbook", () => {
    const sheet = xlsxToCbeSheet(readFileSync(FIXTURE));
    const { container } = render(<SheetView sheet={sheet} highlight={["Consolidated SFP!B6"]} />);
    const b6 = container.querySelector('td[data-ref="B6"]');
    expect(b6?.textContent).toBe("3,200");
    expect(b6?.getAttribute("title")).toBe("B6: =Workings!B5");
    expect(b6?.className).toContain("bg-primary-50");
    expect(container.querySelector('td[data-ref="B10"]')?.textContent).toBe("(900)");
    expect(container.querySelector('td[data-ref="A1"]')?.getAttribute("colspan")).toBe("4");
    expect(container.querySelector('td[data-ref="B1"]')).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Workings" }));
    expect(container.querySelector('td[data-ref="B5"]')?.textContent).toBe("3,200");
  });

  it("shows the empty state", () => {
    const empty: CbeSheet = { sheets: [{ name: "Sheet1", cells: {} }] };
    render(<SheetView sheet={empty} emptyText="Nothing yet" />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
  });
});

describe("DocumentView", () => {
  it("sanitises the answer html and keeps tables", () => {
    const { container } = render(
      <DocumentView html={'<p>IAS 38</p><img src="x" onerror="alert(1)"><table><tr><td>a</td></tr></table>'} />,
    );
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.textContent).toContain("IAS 38");
    expect(container.querySelector("td")?.textContent).toBe("a");
  });

  it("never renders a script tag", () => {
    // happy-dom's DOMPurify drops the whole fragment here; a browser drops just the script.
    const { container } = render(<DocumentView html="<p>answer</p><script>alert(2)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("alert(2)");
  });

  it("shows the empty state for blank html", () => {
    render(<DocumentView html="<p>&nbsp;</p>" />);
    expect(screen.getByText("No written answer.")).toBeTruthy();
  });
});
