import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemplateSearchableSelect, toTemplateOptions } from './TemplateSearchableSelect';

/**
 * The picker's row is where an admin decides which message to send, and the body is the only thing
 * that distinguishes `reminder_v2` from `reminder_v3`. Two clamped lines cut that off mid-sentence,
 * so each row can be opened out — and opening one must NOT also pick the template and close the
 * list, which is the whole trap of putting a button inside a cmdk item.
 */
const longBody =
    'Dear {{1}}, To access your scheduled classes, attempt assigned tests, and track your daily ' +
    'course updates, please log in to the official Shiksha Nation mobile application. You can ' +
    'download it from the Play Store.';

const options = [
    {
        value: 'shiksha_nation_batch_portal_update_app',
        name: 'shiksha_nation_batch_portal_update_app',
        status: 'APPROVED',
        category: 'MARKETING',
        language: 'en',
        preview: longBody.replace('{{1}}', '[name]'),
    },
];

describe('TemplateSearchableSelect', () => {
    it('opens a row out without selecting it', async () => {
        const onChange = vi.fn();
        render(
            <TemplateSearchableSelect options={options} value={undefined} onChange={onChange} />
        );

        fireEvent.click(screen.getByRole('combobox'));
        fireEvent.click(screen.getByRole('button', { name: /show full message/i }));

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
    });

    it('still selects the template when the row itself is clicked', async () => {
        const onChange = vi.fn();
        render(
            <TemplateSearchableSelect options={options} value={undefined} onChange={onChange} />
        );

        fireEvent.click(screen.getByRole('combobox'));
        fireEvent.click(screen.getByText('shiksha_nation_batch_portal_update_app'));

        expect(onChange).toHaveBeenCalledWith('shiksha_nation_batch_portal_update_app');
    });

    it('spends both clamped lines on words, not on the body’s blank lines', async () => {
        const onChange = vi.fn();
        render(
            <TemplateSearchableSelect
                options={[
                    {
                        value: 'greeting',
                        name: 'greeting_template',
                        preview: 'Dear [name],\n\nYour batch starts tomorrow.',
                    },
                ]}
                value={undefined}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('combobox'));
        // Collapsed: one flowing paragraph, so the clamp shows message text on both lines.
        expect(screen.getByText('Dear [name], Your batch starts tomorrow.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /show full message/i }));
        expect(
            screen.getByText('Dear [name],\n\nYour batch starts tomorrow.', {
                collapseWhitespace: false,
            })
        ).toBeInTheDocument();
    });

    it('offers no expander for a body that already fits', async () => {
        render(
            <TemplateSearchableSelect
                options={[
                    { value: 'short', name: 'short_template', preview: 'Your OTP is [otp].' },
                ]}
                value={undefined}
                onChange={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('combobox'));

        expect(
            screen.queryByRole('button', { name: /show full message/i })
        ).not.toBeInTheDocument();
    });
});

describe('toTemplateOptions', () => {
    it('shows what the message says instead of its positional placeholders', () => {
        const [option] = toTemplateOptions([
            {
                id: 'tpl-1',
                name: 'batch_portal_update',
                bodyText: 'Dear {{1}}, your {{2}} starts tomorrow.',
                bodyVariableNames: ['name', 'course_name'],
            },
        ]);

        expect(option?.preview).toBe('Dear [name], your [course_name] starts tomorrow.');
    });

    it('strips email HTML down to readable text', () => {
        const [option] = toTemplateOptions([
            { id: 'tpl-2', name: 'welcome_email', content: '<p>Hi&nbsp;{{name}}</p>' },
        ]);

        expect(option?.preview).toBe('Hi [name]');
    });
});
