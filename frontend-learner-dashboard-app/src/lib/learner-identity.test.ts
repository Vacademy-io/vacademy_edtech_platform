import { describe, expect, it } from "vitest";
import { resolveLearnerIdentity } from "./learner-identity";

/** The enrol-invite form's adapter shape: field_key as the key. */
const f = (key: string, value: string, name?: string, type = "text") => ({
  key,
  name: name ?? key,
  type,
  value,
});

describe("resolving the learner's own identity from a custom-field form", () => {
  it("matches SSDC's actual invite fields", () => {
    const id = resolveLearnerIdentity([
      f("phone_number", "9876543210", "Phone Number", "number"),
      f("full_name", "Asha Rao", "Full Name"),
      f("email", "asha@example.com", "Email"),
    ]);
    expect(id.email).toBe("asha@example.com");
    expect(id.phone).toBe("9876543210");
    expect(id.name).toBe("Asha Rao");
  });

  it("still finds the identity when the KEY is unrecognisable but the label is not", () => {
    // The exact case the old substring-on-key check dropped: a UTM touch with
    // no identity is discarded by the server, so the campaign vanishes.
    const id = resolveLearnerIdentity([
      f("cf_9812", "ravi@example.com", "Email Address", "email"),
      f("cf_4471", "9812345678", "Mobile No"),
    ]);
    expect(id.email).toBe("ravi@example.com");
    expect(id.phone).toBe("9812345678");
  });

  it("does not mistake School Name for the learner's name", () => {
    const id = resolveLearnerIdentity([
      f("school_name", "St. Xavier High", "School Name"),
      f("full_name", "Priya S", "Full Name"),
    ]);
    expect(id.name).toBe("Priya S");
  });

  it("prefers a field the visitor actually filled over an empty match", () => {
    const id = resolveLearnerIdentity([
      f("email", "", "Email"),
      f("email_inst_42", "real@example.com", "Email"),
    ]);
    expect(id.email).toBe("real@example.com");
  });

  it("returns empty strings rather than throwing when nothing matches", () => {
    const id = resolveLearnerIdentity([f("cf_1", "yes", "Do you own a laptop?")]);
    expect(id).toEqual({ email: "", phone: "", name: "" });
  });
});
