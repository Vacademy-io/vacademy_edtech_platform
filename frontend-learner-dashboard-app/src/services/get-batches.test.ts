// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { withoutChargePackages } from "./get-batches";

const batch = (package_type?: string | null) => ({ package_dto: { package_type } });

describe("withoutChargePackages", () => {
  it("drops shipping and deposits", () => {
    expect(withoutChargePackages([batch("DELIVERY_CHARGE"), batch("SECURITY_DEPOSIT")])).toEqual([]);
  });

  it("keeps real courses, typed or not", () => {
    const courses = [batch("COURSE"), batch("MEMBERSHIP"), batch(null), batch(undefined), {}];
    expect(withoutChargePackages(courses)).toEqual(courses);
  });
});
