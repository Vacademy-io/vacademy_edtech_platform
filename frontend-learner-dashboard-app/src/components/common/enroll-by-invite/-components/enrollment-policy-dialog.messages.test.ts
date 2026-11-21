// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// React 19 requires this before act(); the repo has no shared test setup file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from "react";
import { createRoot } from "react-dom/client";

// i18n: return the key so we can assert *which* string was chosen.
vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
    getTerminology: () => "Course",
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));

import EnrollmentPolicyDialog from "./enrollment-policy-dialog";

const POLICY = {
    reenrollmentPolicy: {
        activeRepurchaseBehavior: "BLOCK",
        allowReenrollmentAfterExpiry: false,
        reenrollmentGapInDays: 30,
        alreadyEnrolledMessage: "Institute's own already-enrolled copy.",
        reenrollmentBlockedMessage: "Come back on {{allowed_date}} to rejoin.",
    },
    onEnrollment: {
        terminateActiveSessions: [],
        blockIfActiveIn: ["ps-1"],
        blockMessage: "Institute's own paid-member copy.",
    },
} as never;

// Radix renders the dialog through a portal, so it only exists in a real DOM —
// SSR markup comes back empty. Mount it and read the document.
const render = (dialogType: string, serverMessage?: string, policyResponse: unknown = POLICY) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(EnrollmentPolicyDialog as never, {
                open: true,
                onOpenChange: () => {},
                dialogType,
                policyResponse,
                serverMessage,
            } as never),
        );
    });
    const html = document.body.innerHTML;
    act(() => root.unmount());
    container.remove();
    return html;
};

describe("reenrollment_blocked message resolution", () => {
    it("shows the backend's resolved date, never the raw {{allowed_date}}", () => {
        const html = render("reenrollment_blocked", "Come back on 2026-10-01 to rejoin.");
        expect(html).toContain("Come back on 2026-10-01 to rejoin.");
        expect(html).not.toContain("{{allowed_date}}");
    });

    it("falls back to the stored template when there is no server message", () => {
        const html = render("reenrollment_blocked", undefined);
        expect(html).toContain("Come back on");
    });

    it("falls back to copy instead of rendering blank when nothing is configured", () => {
        const html = render("reenrollment_blocked", undefined, {
            reenrollmentPolicy: { activeRepurchaseBehavior: "BLOCK" },
        });
        expect(html).toContain("enrollmentPolicy.reenrollmentBlockedFallback");
    });
});

describe("other variants are unchanged by serverMessage", () => {
    it("already_enrolled still prefers the institute's configured copy", () => {
        const html = render("already_enrolled", "You are already enrolled in this demo. Please complete your current trial first.");
        expect(html).toContain("Institute's own already-enrolled copy.");
        expect(html).not.toContain("complete your current trial first");
    });

    it("already_enrolled still falls back to i18n when unconfigured", () => {
        const html = render("already_enrolled", "some backend text", { onExpiry: { waitingPeriodInDays: 1 } });
        expect(html).toContain("enrollmentPolicy.alreadyEnrolledMessage");
    });

    it("paid_member_blocked still prefers the institute's configured copy", () => {
        const html = render("paid_member_blocked", "some backend text");
        expect(html).toContain("Institute's own paid-member copy.");
    });
});
