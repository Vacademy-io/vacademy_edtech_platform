import { describe, expect, it } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { checkoutErrorOf } from "./checkout-error";

const axiosError = (status: number, data: unknown) => {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
};

describe("checkoutErrorOf", () => {
  it("shows the server's explanation instead of the transport message", () => {
    expect(checkoutErrorOf(axiosError(510, { ex: "Payment amount mismatch" }), "Failed", "Changed")).toEqual({
      message: "Payment amount mismatch",
      priceChanged: false,
    });
  });

  it("flags a 409 as a changed price, with the server message or a fallback", () => {
    const msg = "The price of a course in your cart has changed. Please reload the page and try again.";
    expect(checkoutErrorOf(axiosError(409, { message: msg }), "Failed", "Changed")).toEqual({ message: msg, priceChanged: true });
    expect(checkoutErrorOf(axiosError(409, {}), "Failed", "Changed")).toEqual({ message: "Changed", priceChanged: true });
  });

  it.each([400, 403, 404, 422])("shows a refused request's own reason (%i)", (status: number) => {
    expect(checkoutErrorOf(axiosError(status, { ex: "Coupon invalid: expired" }), "Failed", "Changed")).toEqual({
      message: "Coupon invalid: expired",
      priceChanged: false,
    });
  });

  it("never shows the 511 catch-all's raw exception text", () => {
    const sql =
      "could not execute statement [ERROR: duplicate key value violates unique constraint \"user_plan_pkey\"] [insert into user_plan (id) values (?)]";
    expect(checkoutErrorOf(axiosError(511, { ex: sql }), "Failed", "Changed")).toEqual({
      message: "Failed",
      priceChanged: false,
    });
    expect(checkoutErrorOf(axiosError(511, { ex: "Cannot invoke \"java.util.List.size()\"" }), "Failed", "Changed").message).toBe(
      "Failed",
    );
  });

  it.each([500, 502, 503, 504])("keeps the translated message for a server failure (%i)", (status: number) => {
    expect(checkoutErrorOf(axiosError(status, { message: "Internal Server Error" }), "Failed", "Changed")).toEqual({
      message: "Failed",
      priceChanged: false,
    });
    expect(checkoutErrorOf(axiosError(status, "<html>oops</html>"), "Failed", "Changed").message).toBe("Failed");
  });

  it("keeps the translated message when there is no reason to show", () => {
    // A refused request with an empty body: the transport text helps no one.
    expect(checkoutErrorOf(axiosError(400, {}), "Failed", "Changed").message).toBe("Failed");
    expect(checkoutErrorOf(axiosError(404, "<html>Not found</html>"), "Failed", "Changed").message).toBe("Failed");
  });

  it("keeps the translated message for a network error or anything that is not a response", () => {
    // axios's own network failure: no response at all.
    expect(checkoutErrorOf(new AxiosError("Network Error", "ERR_NETWORK"), "Failed", "Changed")).toEqual({
      message: "Failed",
      priceChanged: false,
    });
    expect(checkoutErrorOf(new Error("Network Error"), "Failed", "Changed").message).toBe("Failed");
    expect(checkoutErrorOf("weird", "Failed", "Changed").message).toBe("Failed");
    expect(checkoutErrorOf(null, "Failed", "Changed").message).toBe("Failed");
  });
});
