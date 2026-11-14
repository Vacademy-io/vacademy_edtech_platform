import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { CbeAnswerView } from "@/components/common/cbe-review/cbe-answer-view";
import type { CbeAnswer, CbeConfig } from "../types";

const config: CbeConfig = {
  type: "CBE_RESPONSE",
  data: {
    version: 1,
    parts: [{ id: "p_aaaaaa", label: "(a)", kind: "DOCUMENT", marks: 5 }],
  },
} as CbeConfig;

describe("CbeAnswerView with a malformed learner answer", () => {
  it("skips part answers that are not well formed instead of crashing", () => {
    const answer = {
      parts: {
        p_aaaaaa: { kind: "DOCUMENT", html: "<p>Because</p>" },
        x: null,
        y: "text",
        z: { kind: "OTHER" },
      },
    } as unknown as CbeAnswer;
    const { container } = render(<CbeAnswerView answer={answer} config={config} />);
    expect(container.textContent).toContain("Because");
    expect(container.querySelectorAll("section")).toHaveLength(1);
  });

  it("renders the empty state when every part is malformed", () => {
    const answer = { parts: { x: null } } as unknown as CbeAnswer;
    render(<CbeAnswerView answer={answer} />);
    expect(screen.getByText("answer.empty")).toBeTruthy();
  });

  it("ignores a config part whose answer is not an object", () => {
    const answer = { parts: { p_aaaaaa: 42 } } as unknown as CbeAnswer;
    const { container } = render(<CbeAnswerView answer={answer} config={config} />);
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(container.textContent).toContain("answer.noText");
  });
});
