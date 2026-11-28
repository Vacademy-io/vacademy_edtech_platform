import { describe, expect, it } from "vitest";
import {
    detectEnrollmentConflict,
    hasEnrollmentPolicyContent,
} from "./enrollment-conflict";
import type { EnrollmentPolicyResponse } from "../-components/enrollment-policy-dialog";

/** Shape older backends return when no policy is configured (five null keys). */
const EMPTY_POLICY = {
    onExpiry: null,
    notifications: null,
    reenrollmentPolicy: null,
    onEnrollment: null,
    workflow: null,
} as unknown as EnrollmentPolicyResponse;

const POLICY: EnrollmentPolicyResponse = {
    reenrollmentPolicy: {
        activeRepurchaseBehavior: "BLOCK",
        allowReenrollmentAfterExpiry: false,
        reenrollmentGapInDays: 30,
        alreadyEnrolledMessage: "You are already in the programme.",
        reenrollmentBlockedMessage:
            "Come back on {{allowed_date}} to rejoin the programme.",
        upgradeOptions: {
            paid_upgrade: { type: "paid", text: "Go premium", url: "https://x" },
        },
    },
    onEnrollment: {
        terminateActiveSessions: [],
        blockIfActiveIn: ["ps-1"],
        blockMessage: "Paid members cannot take the demo.",
    },
};

describe("hasEnrollmentPolicyContent", () => {
    it("rejects the all-null DTO older backends send for no policy", () => {
        expect(hasEnrollmentPolicyContent(EMPTY_POLICY)).toBe(false);
    });

    it("rejects {} from backends that omit nulls", () => {
        expect(hasEnrollmentPolicyContent({} as EnrollmentPolicyResponse)).toBe(false);
    });

    it("rejects null/undefined", () => {
        expect(hasEnrollmentPolicyContent(null)).toBe(false);
        expect(hasEnrollmentPolicyContent(undefined)).toBe(false);
    });

    it("accepts a policy with any populated section", () => {
        expect(hasEnrollmentPolicyContent(POLICY)).toBe(true);
    });
});

describe("detectEnrollmentConflict", () => {
    describe("explicit backend marker", () => {
        it.each([
            ["ALREADY_ENROLLED", "already_enrolled"],
            ["REENROLLMENT_BLOCKED", "reenrollment_blocked"],
            ["PAID_MEMBER_BLOCKED", "paid_member_blocked"],
        ])("maps %s to the %s dialog", (type, dialog) => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: "anything at all",
                    responseCode: `510 ENROLLMENT_CONFLICT:${type}`,
                }),
            ).toBe(dialog);
        });

        it("wins over message matching", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: "Paid members cannot take the demo.",
                    responseCode: "510 ENROLLMENT_CONFLICT:REENROLLMENT_BLOCKED",
                }),
            ).toBe("reenrollment_blocked");
        });

        it("still shows a dialog for an unknown conflict type", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: "x",
                    responseCode: "510 ENROLLMENT_CONFLICT:SOMETHING_NEW",
                }),
            ).toBe("already_enrolled");
        });
    });

    describe("message matching against a backend without the marker", () => {
        it("matches the institute's configured block message", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: "Paid members cannot take the demo.",
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBe("paid_member_blocked");
        });

        it("matches a configured message after {{allowed_date}} substitution", () => {
            // The backend replaces the placeholder before throwing, so the thrown
            // text never equals the stored template.
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: "Come back on 2026-10-01 to rejoin the programme.",
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBe("reenrollment_blocked");
        });

        it("matches the configured alreadyEnrolledMessage", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: "You are already in the programme.",
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBe("already_enrolled");
        });

        it.each([
            [
                "You already have an active membership plan. Demo access is not available for existing paid subscribers.",
                "paid_member_blocked",
            ],
            [
                "Re-enrollment is not allowed. Please try again after 2026-10-01. Minimum gap required: 30 days.",
                "reenrollment_blocked",
            ],
            [
                "You are already enrolled in this demo. Please complete your current trial first.",
                "already_enrolled",
            ],
            ["You can retry operation on 2026-10-01", "already_enrolled"],
        ])("matches the backend default %#", (message, dialog) => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: message,
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBe(dialog);
        });

        it("matches backend defaults even with no policy configured", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: EMPTY_POLICY,
                    errorMessage:
                        "You are already enrolled in this demo. Please complete your current trial first.",
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBe("already_enrolled");
        });
    });

    describe("failures that are NOT conflicts", () => {
        // These all arrive as HTTP 510 and used to render as "Already Enrolled",
        // hiding the real reason from the learner.
        it.each([
            "Recurring value should be between 1 and 31 for the provided frequency",
            "Seat limit reached for this organization. Current members: 50, Maximum allowed: 50.",
            "Selected plan does not belong to the chosen payment option.",
            "Selected batch is not part of this invite. Please reload and try again.",
            "Sub-org invite does not have admin roles configured. Please contact the organization admin.",
            "Failed to link student to institute: connection reset",
        ])("returns null for %s", (message) => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: message,
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBeNull();
        });

        it("does not guess when there is no error message", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: POLICY,
                    errorMessage: undefined,
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBeNull();
        });

        it("ignores blockMessage when blockIfActiveIn is empty", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: {
                        onEnrollment: {
                            terminateActiveSessions: [],
                            blockIfActiveIn: [],
                            blockMessage: "Paid members cannot take the demo.",
                        },
                    },
                    errorMessage: "Paid members cannot take the demo.",
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBeNull();
        });

        it.each([
            "{{allowed_date}}",
            "{{a}}{{b}}",
            "  {{allowed_date}}  ",
        ])(
            "does not let a placeholder-only template (%s) match everything",
            (template) => {
                expect(
                    detectEnrollmentConflict({
                        policyResponse: {
                            reenrollmentPolicy: {
                                activeRepurchaseBehavior: "BLOCK",
                                allowReenrollmentAfterExpiry: false,
                                reenrollmentGapInDays: 30,
                                alreadyEnrolledMessage: template,
                                reenrollmentBlockedMessage: template,
                            },
                        },
                        errorMessage:
                            "Recurring value should be between 1 and 31 for the provided frequency",
                        responseCode: "510 NOT_EXTENDED",
                    }),
                ).toBeNull();
            },
        );

        it("does not let an empty configured message match everything", () => {
            expect(
                detectEnrollmentConflict({
                    policyResponse: {
                        reenrollmentPolicy: {
                            activeRepurchaseBehavior: "BLOCK",
                            allowReenrollmentAfterExpiry: true,
                            reenrollmentGapInDays: 0,
                            alreadyEnrolledMessage: "   ",
                            reenrollmentBlockedMessage: "",
                        },
                    },
                    errorMessage: "Payment gateway timed out",
                    responseCode: "510 NOT_EXTENDED",
                }),
            ).toBeNull();
        });
    });
});
