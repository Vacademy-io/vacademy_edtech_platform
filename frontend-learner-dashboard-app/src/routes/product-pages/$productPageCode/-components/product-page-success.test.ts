import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string, o?: Record<string, unknown>) =>
            k === 'success.access.oneYear' ? '1 year access'
            : k === 'success.youSaved' ? `You saved ${o?.amount}`
            : k === 'success.totalPaid' ? 'Total paid'
            : k,
    }),
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Course', getTerminologyPlural: () => 'Courses',
}));
vi.mock('@/utils/ios-iap-compliance', () => ({ shouldHidePaidPurchaseUI: () => false }));
const store = vi.hoisted(() => ({
    registrationData: {} as Record<string, { key?: string; name?: string; type?: string; value?: string }>,
    accessToken: null as string | null,
}));
vi.mock('../-stores/product-page-store', () => ({
    useProductPageStore: () => ({
        selectedPsOptionIds: ['o0', 'o1', 'o2', 'o3'],
        utmParams: {},
        finalPrice: () => 899,
        totalPrice: () => 1396,
        loginCode: null,
        registrationData: store.registrationData,
    }),
}));
// The real module pulls in the API base URL, which reads window at import time.
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => store.accessToken,
}));

const { ProductPageSuccess } = await import('./ProductPageSuccess');

// The four courses from the screenshot: Class 5 English, Maths, Science, G.K.
const SUBJECTS = [
    ['iThinkers Olympiad -ENGLISH', 'English - Class 5'],
    ['iThinkers Academy - MATHS', 'Mathematics - Class 5'],
    ['iThinkers Academy - SCIENCE', 'Science - Class 5'],
    ['iThinkers Academy - G.K.', 'G.K. - Class 5'],
];

/**
 * The receipt a parent is left holding. Every course on a basket-priced page
 * shares ONE payment plan ("Per Subject"), so a list built from the plan name
 * printed the same row four times — nothing on the page could be checked
 * against what was actually bought, or against the bank.
 */
describe('the enrolled-course list', () => {
    it('names each course instead of repeating the plan', () => {
        const pageData = {
            settings_json: null,
            currency: 'INR',
            mappings: SUBJECTS.map(([pkg, level], i) => ({
                ps_invite_payment_option_id: `o${i}`,
                package_name: pkg,
                level_name: level,
                session_name: '2026-27',
                payment_plan: { name: 'Per Subject', actual_price: 349, currency: 'INR', validity_in_days: 365 },
            })),
        };
        const html = renderToStaticMarkup(
            React.createElement(ProductPageSuccess, { pageData: pageData as never }),
        );
        const text = html.replace(/<[^>]+>/g, '\n').replace(/&#x20B9;/g, '₹')
            .split('\n').map((l) => l.trim()).filter(Boolean);
        expect(text).toContain('English - Class 5 · 2026-27 · 1 year access');

        for (const [pkg, level] of SUBJECTS) {
            expect(html).toContain(pkg);
            expect(html).toContain(level);
        }
        expect(html).not.toContain('Per Subject');
    });
});

/**
 * "Redirect Path" in the product page's Post Enrollment Configuration. The
 * setting has been offered in the admin UI ("the user will be instantly
 * redirected to this path after successful enrollment") while the learner app
 * only read it into a variable it never used, so every institute that set one
 * still got the built-in receipt.
 */
describe('the after-payment redirect', () => {
    const render = (afterPaymentRedirectUrl: string) => {
        const pageData = {
            settings_json: JSON.stringify({ afterPaymentRedirectUrl }),
            currency: 'INR',
            mappings: [
                {
                    ps_invite_payment_option_id: 'o0',
                    package_name: 'UnlockX Scholarship Test',
                    level_name: 'Class 10',
                    session_name: '2026-27',
                    payment_plan: { name: 'Registration', actual_price: 349, currency: 'INR' },
                },
            ],
        };
        return renderToStaticMarkup(
            React.createElement(ProductPageSuccess, { pageData: pageData as never }),
        );
    };

    it('hands the buyer over to the configured page instead of the receipt', () => {
        const html = render('https://shikshanation.com/thank-you');
        expect(html).toContain('href="https://shikshanation.com/thank-you"');
        expect(html).toContain('success.redirecting');
        // The receipt is skipped — it would only flash past before the handover.
        expect(html).not.toContain('success.goToMyCourses');
    });

    it('keeps the receipt when the configured value is not a usable destination', () => {
        // A `javascript:` URL, and a bare host the browser would resolve as a
        // relative path off /product-pages/ — both are institute typos, and
        // neither may replace a working receipt with a dead end.
        for (const bad of ['javascript:alert(1)', 'shikshanation.com/thank-you', '']) {
            const html = render(bad);
            expect(html).toContain('success.goToMyCourses');
            expect(html).not.toContain('success.redirecting');
        }
    });
});

/**
 * "Log In Automatically After Purchase" when the server issued no login code:
 * the buyer's account existed before this checkout (e.g. migrated from an
 * old store and never sent a password), so the button
 * takes them to the OTP login with their email and phone filled in. Which OTP
 * form opens is the login page's call, from the portal's policy.
 */
describe('a buyer with an existing account on an auto-login page', () => {
    const render = (settings: Record<string, unknown>) => {
        const pageData = {
            settings_json: JSON.stringify(settings),
            currency: 'INR',
            mappings: [
                {
                    ps_invite_payment_option_id: 'o0',
                    package_name: 'Geography eBook',
                    level_name: 'default',
                    session_name: 'default',
                    payment_plan: { name: 'eBook Rs 10', actual_price: 10, currency: 'INR' },
                },
            ],
        };
        return renderToStaticMarkup(
            React.createElement(ProductPageSuccess, { pageData: pageData as never }),
        );
    };
    const withBuyer = (email: string, phone = '', token: string | null = null) => {
        store.registrationData = {
            email: { key: 'email', name: 'Email', type: 'email', value: email },
            phone: { key: 'phone', name: 'Phone', type: 'phone', value: phone },
        };
        store.accessToken = token;
    };

    it('sends them to the OTP login with their email and phone filled in', () => {
        withBuyer('old.buyer+1@gmail.com', '+91 98765 43210');
        const html = render({ autoLoginAfterPayment: true });
        expect(html).toContain(
            'href="/login?method=otp&amp;email=old.buyer%2B1%40gmail.com&amp;phone=919876543210"',
        );
        expect(html).toContain('success.logInToContinue');
        expect(html).toContain('success.existingAccountHint');
        expect(html).not.toContain('success.goToMyCourses');
    });

    it('leaves out a phone number without its country code', () => {
        withBuyer('old.buyer@gmail.com', '9876543210');
        const html = render({ autoLoginAfterPayment: true });
        expect(html).toContain('href="/login?method=otp&amp;email=old.buyer%40gmail.com"');
    });

    it('changes nothing on a page without the setting', () => {
        withBuyer('old.buyer@gmail.com', '+919876543210');
        const html = render({});
        expect(html).toContain('href="/dashboard"');
        expect(html).toContain('success.goToMyCourses');
        expect(html).not.toContain('/login?method=otp');
        expect(html).not.toContain('success.existingAccountHint');
    });

    it('goes straight to the dashboard when this browser is already logged in', () => {
        withBuyer('old.buyer@gmail.com', '+919876543210', 'token');
        const html = render({ autoLoginAfterPayment: true });
        expect(html).toContain('href="/dashboard"');
        expect(html).not.toContain('/login?method=otp');
    });

    it('keeps the plain button when the form gave neither an email nor a phone', () => {
        withBuyer('', '');
        const html = render({ autoLoginAfterPayment: true });
        expect(html).toContain('href="/dashboard"');
        expect(html).not.toContain('success.existingAccountHint');
    });

    it('keeps the hidden login button hidden', () => {
        withBuyer('old.buyer@gmail.com');
        const html = render({ autoLoginAfterPayment: true, showLoginButton: false });
        expect(html).not.toContain('/login?method=otp');
        expect(html).not.toContain('success.existingAccountHint');
    });
});
