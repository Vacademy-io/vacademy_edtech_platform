import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ instituteId: null as string | null }));
const store = vi.hoisted(() => vi.fn(async () => ({ id: "saved" })));
const read = vi.hoisted(() => vi.fn(async () => ({ id: "read" })));

vi.mock("@/lib/auth/session-institute", () => ({
  readSessionInstituteId: async () => session.instituteId,
}));
vi.mock("@/services/fetchAndStoreInstituteDetails", () => ({ fetchAndStoreInstituteDetails: store }));
vi.mock("@/services/signup-api", () => ({ getInstituteDetails: read }));

import { loadDialogInstitute } from "./load-dialog-institute";

describe("loadDialogInstitute", () => {
  beforeEach(() => {
    store.mockClear();
    read.mockClear();
  });

  it("only reads the institute for a signed-in learner of another institute", async () => {
    session.instituteId = "own";
    await loadDialogInstitute("site", "user-1");
    expect(read).toHaveBeenCalledWith("site");
    expect(store).not.toHaveBeenCalled();
  });

  it("saves it for a learner of that institute", async () => {
    session.instituteId = "site";
    await loadDialogInstitute("site", "user-1");
    expect(store).toHaveBeenCalledWith("site", "user-1");
    expect(read).not.toHaveBeenCalled();
  });

  it("saves it for a signed-out guest", async () => {
    session.instituteId = null;
    await loadDialogInstitute("site", null);
    expect(store).toHaveBeenCalledWith("site", "guest");
  });
});
