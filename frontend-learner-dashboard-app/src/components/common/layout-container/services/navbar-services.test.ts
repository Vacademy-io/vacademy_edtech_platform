import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn(async () => ({ data: {} })));

vi.mock("axios", () => ({ default: { get } }));
vi.mock("@/constants/urls", () => ({ BASE_URL: "" }));
vi.mock("../../helper", () => ({ getInstituteIdSync: async () => "stored" }));

const load = async () => {
  vi.resetModules();
  return import("./navbar-services");
};
const askedFor = () => (get.mock.calls.at(-1) as unknown[] | undefined)?.[0];

describe("handleGetPublicInstituteDetails", () => {
  beforeEach(() => get.mockClear());

  it("reads a different entry once sign-in hydration names an institute", async () => {
    const { handleGetPublicInstituteDetails, setPublicInstituteDetailsScope } = await load();
    const beforeSignIn = handleGetPublicInstituteDetails().queryKey;
    setPublicInstituteDetailsScope("own");
    const afterSignIn = handleGetPublicInstituteDetails().queryKey;
    expect(afterSignIn).not.toEqual(beforeSignIn);
    setPublicInstituteDetailsScope("other");
    expect(handleGetPublicInstituteDetails().queryKey).not.toEqual(afterSignIn);
  });

  it("asks for the stored institute until then", async () => {
    const { handleGetPublicInstituteDetails } = await load();
    await handleGetPublicInstituteDetails().queryFn();
    expect(askedFor()).toContain("/stored");
  });

  it("asks for the institute its entry is named after", async () => {
    const { handleGetPublicInstituteDetails, setPublicInstituteDetailsScope } = await load();
    setPublicInstituteDetailsScope("own");
    await handleGetPublicInstituteDetails().queryFn();
    expect(askedFor()).toContain("/own");
  });
});
