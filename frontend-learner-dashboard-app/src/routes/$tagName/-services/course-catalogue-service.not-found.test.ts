import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { create: () => ({ get }) } }));
vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.example" }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminologyPlural: (_key: string, fallback: string) => fallback,
}));

import { CourseCatalogueService } from "./course-catalogue-service";

describe("getCourseCatalogueByTag", () => {
  beforeEach(() => {
    get.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("marks a tag the backend does not know", async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    const data = await CourseCatalogueService.getCourseCatalogueByTag("inst", "unknown");
    expect(data.notFound).toBe(true);
  });

  it("does not mark a catalogue that exists", async () => {
    get.mockResolvedValue({
      data: {
        id: "row",
        catalogue_json: JSON.stringify({ globalSettings: { leadCollection: { formStyle: {} } }, pages: [] }),
      },
    });
    const data = await CourseCatalogueService.getCourseCatalogueByTag("inst", "known");
    expect(data.notFound).toBeUndefined();
  });

  it("still reports other failures as failures", async () => {
    get.mockRejectedValue({ response: { status: 500 }, message: "server" });
    await expect(CourseCatalogueService.getCourseCatalogueByTag("inst", "x")).rejects.toBeTruthy();
  });
});
