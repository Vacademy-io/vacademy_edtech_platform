/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// The AI service leaves prices null for TTS rows and unpriced models, and the
// table used to call .toFixed() straight on them — which crashed the whole tab.
const records = [
  {
    id: "1",
    institute_id: "inst",
    user_id: "user",
    api_provider: "gemini",
    model: null,
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    input_token_price: null,
    output_token_price: null,
    total_price: null,
    request_type: "chat",
    request_id: null,
    request_metadata: null,
    created_at: "not-a-date",
  },
  {
    id: "2",
    institute_id: "inst",
    user_id: "user",
    api_provider: "openai",
    model: "gpt-4o-mini",
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    input_token_price: 0.0000001,
    output_token_price: 0.0000002,
    total_price: 0.0025,
    request_type: "chat",
    request_id: null,
    request_metadata: null,
    created_at: "2026-09-01T10:30:00",
  },
];

vi.mock("@/services/ai-settings-api", () => ({
  useGetUserApiKeys: () => ({ data: null, isLoading: false }),
  useSaveUserApiKeys: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteUserApiKeys: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetTokenUsage: () => ({
    data: { records, total: records.length },
    isLoading: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/common/layout-container/layout-container", () => ({
  LayoutContainer: ({ children }: { children: unknown }) => children,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));

vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenFromStorage: () => "token",
  getTokenFromCookie: () => "token",
}));

vi.mock("@/services/ai-settings-shortcut", () => ({
  useAiSettingsShortcutEnabled: () => false,
  setAiSettingsShortcutEnabled: vi.fn(),
}));

describe("TokenUsage", () => {
  it("renders rows whose price and model are missing", async () => {
    const { TokenUsage } = await import("./index");

    const html = renderToString(createElement(TokenUsage));

    // The unpriced row renders instead of throwing, and reads as "no value"
    // rather than a fabricated $0.0000.
    expect(html).toContain("—");
    expect(html).not.toContain("$0.0000<");
    // The priced row still shows its cost, and the totals ignore the nulls.
    expect(html).toContain("$0.0025");
    expect(html).toContain("165"); // total tokens across both rows
  });
});
