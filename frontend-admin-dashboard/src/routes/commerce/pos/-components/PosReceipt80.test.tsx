/** POS review follow-ups: leaving a screen with a print in progress ends it (packing slips print later). */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

import { PRINTING_CLASS, printReceipt } from '../-shared/pos-receipt';
import { PrintPortal } from './PosReceipt80';

describe('PrintPortal', () => {
    it('removes the printing class when it unmounts', () => {
        vi.spyOn(window, 'print').mockImplementation(() => undefined);
        const view = render(
            <PrintPortal>
                <div className="pos-receipt-print" />
            </PrintPortal>
        );
        printReceipt(window);
        expect(document.body.classList.contains(PRINTING_CLASS)).toBe(true);
        view.unmount();
        expect(document.body.classList.contains(PRINTING_CLASS)).toBe(false);
    });

    it('the print CSS takes everything but the receipt out of the layout (no blank feed)', () => {
        const css = readFileSync(resolve(__dirname, 'pos-receipt.css'), 'utf8');
        expect(css).toContain('body.pos-printing > :not(.pos-receipt-print)');
        expect(css).toMatch(/display:\s*none/);
        expect(css).not.toMatch(/visibility:\s*hidden/);
    });
});
