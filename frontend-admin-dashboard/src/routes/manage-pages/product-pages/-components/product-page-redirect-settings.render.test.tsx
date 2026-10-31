import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductPageSettingsCard } from './ProductPageSettingsCard';
import {
    DEFAULT_PRODUCT_PAGE_SETTINGS,
    type ProductPageSettings,
} from '../-types/product-page-types';

/**
 * "Redirect After Enrollment" in the Post Enrollment Configuration.
 *
 * The only way to check a redirect is to buy something, so the settings panel
 * has to say what will happen — where the learner lands and after how long.
 * The field shipped before this saying "the user will be instantly redirected",
 * while the checkout ignored the value entirely; nothing on screen could have
 * shown that, which is exactly what these assertions are for.
 */

const settingsWith = (patch: Partial<ProductPageSettings>): ProductPageSettings => ({
    ...DEFAULT_PRODUCT_PAGE_SETTINGS,
    ...patch,
});

const renderCard = (patch: Partial<ProductPageSettings>) => {
    const onChange = vi.fn();
    render(
        <ProductPageSettingsCard settings={settingsWith(patch)} onChange={onChange} courses={[]} />
    );
    return onChange;
};

describe('the after-enrollment redirect settings', () => {
    it('says plainly that nothing is redirected when the field is empty', () => {
        renderCard({ afterPaymentRedirectUrl: '' });
        expect(screen.getByText(/No redirect/i)).toBeInTheDocument();
        // Nowhere to go yet, so there is no wait to configure.
        expect(screen.queryByText('Wait Before Redirecting')).not.toBeInTheDocument();
    });

    it('spells out the destination and the wait for a usable URL', () => {
        renderCard({
            afterPaymentRedirectUrl: 'https://shikshanation.com/thank-you',
            afterPaymentRedirectDelaySeconds: 3,
        });
        expect(screen.getByText(/success screen for 3 seconds/i)).toBeInTheDocument();
        expect(screen.getByText('https://shikshanation.com/thank-you')).toBeInTheDocument();
        // The URL is openable from here — checking it must not require enrolling.
        expect(screen.getByRole('link', { name: /test/i })).toHaveAttribute(
            'href',
            'https://shikshanation.com/thank-you'
        );
        expect(screen.getByText('Wait Before Redirecting')).toBeInTheDocument();
    });

    it('drops the wait from the sentence when the redirect is immediate', () => {
        renderCard({
            afterPaymentRedirectUrl: 'https://shikshanation.com/thank-you',
            afterPaymentRedirectDelaySeconds: 0,
        });
        expect(screen.getByText(/go straight to/i)).toBeInTheDocument();
    });

    it('warns instead of silently ignoring a value the browser cannot open', () => {
        // A bare host is the likely typo: the browser would resolve it as a
        // relative path off /product-pages/, so the checkout discards it.
        renderCard({ afterPaymentRedirectUrl: 'shikshanation.com/thank-you' });
        expect(screen.getByText(/isn't a destination a browser can open/i)).toBeInTheDocument();
        expect(screen.queryByText('Wait Before Redirecting')).not.toBeInTheDocument();
    });

    it('sets the wait from a preset chip', () => {
        const onChange = renderCard({
            afterPaymentRedirectUrl: 'https://shikshanation.com/thank-you',
            afterPaymentRedirectDelaySeconds: 3,
        });
        fireEvent.click(screen.getByRole('button', { name: '5s' }));
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ afterPaymentRedirectDelaySeconds: 5 })
        );
    });

    it('keeps a hand-typed wait inside the range the checkout honours', () => {
        const onChange = renderCard({
            afterPaymentRedirectUrl: 'https://shikshanation.com/thank-you',
            afterPaymentRedirectDelaySeconds: 3,
        });
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '900' } });
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ afterPaymentRedirectDelaySeconds: 30 })
        );
    });
});

describe('the empty-field states', () => {
    it('treats a field of only whitespace as unset, not as a broken URL', () => {
        // Someone clearing the field can easily leave a space behind; that is a
        // page with no redirect, and warning about it reads as a real problem.
        render(
            <ProductPageSettingsCard
                settings={settingsWith({ afterPaymentRedirectUrl: '   ' })}
                onChange={vi.fn()}
                courses={[]}
            />
        );
        expect(screen.getByText(/No redirect/i)).toBeInTheDocument();
        expect(
            screen.queryByText(/isn't a destination a browser can open/i)
        ).not.toBeInTheDocument();
    });
});
