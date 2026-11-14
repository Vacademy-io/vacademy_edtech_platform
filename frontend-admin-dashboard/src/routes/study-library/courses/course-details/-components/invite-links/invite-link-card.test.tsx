import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import strings from '../../../../../../../public/locales/en/studyLibraryCourseDetailsInviteDetailsComponent.json';
import type { InviteLinkDataInterface } from '@/schemas/study-library/invite-links-schema';

/**
 * The invite card is where every share/lifecycle action for one link lives.
 * The states below are the ones a static render cannot vouch for: the short
 * URL button doubles as the place the address is READ, so it must show the
 * address and not a label; the UTM button must follow the institute switch;
 * and the QR dialog has to actually mount a symbol when asked for one.
 */

// Strict `t` for the namespace under test, with i18next-style interpolation
// and `_one`/`_other` plural resolution — a missing key throws rather than
// leaking through as a raw key that a getByText would then happily match.
const resolve = (key: string, options?: Record<string, unknown>): string => {
    const count = options?.count;
    const candidates =
        typeof count === 'number' ? [`${key}_${count === 1 ? 'one' : 'other'}`, key] : [key];
    for (const candidate of candidates) {
        const value = candidate
            .split('.')
            .reduce<unknown>(
                (node, part) => (node as Record<string, unknown> | undefined)?.[part],
                strings
            );
        if (typeof value === 'string') {
            return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
                String(options?.[name] ?? '')
            );
        }
    }
    throw new Error(`Missing translation: ${key}`);
};
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: resolve }),
}));

// The builder drags in the whole UTM settings graph; the card only has to
// mount it when asked, which a stub can prove.
vi.mock('@/components/common/utm/utm-builder-dialog', () => ({
    UtmBuilderDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="utm-builder" /> : null,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// happy-dom has no 2D canvas. qrcode.react's hidden export canvas asks for a
// context on mount and bails out cleanly on null; without this stub the
// property is missing altogether and the mount effect throws instead.
if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
    HTMLCanvasElement.prototype.getContext = (() =>
        null) as typeof HTMLCanvasElement.prototype.getContext;
}

import { InviteLinkCard } from './invite-link-card';

const invite = (overrides: Partial<InviteLinkDataInterface> = {}): InviteLinkDataInterface =>
    ({
        id: 'inv-1',
        name: 'Summer Batch 2026',
        invite_code: '8s7t7s',
        tag: 'DEFAULT',
        status: 'ACTIVE',
        created_at: '2026-09-11T10:30:00.000Z',
        short_url: 'https://u.vacademy.io/s/8s7t7s',
        package_session_ids: ['ps-1'],
        ...overrides,
    }) as InviteLinkDataInterface;

const INVITE_URL =
    'https://training.enarkuplift.in/learner-invitation-response?instituteId=inst-1&inviteCode=8s7t7s';

const renderCard = (props: Partial<React.ComponentProps<typeof InviteLinkCard>> = {}) => {
    const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onMakeDefault: vi.fn() };
    render(
        <InviteLinkCard
            invite={invite()}
            packageSessionId="ps-1"
            inviteUrl={INVITE_URL}
            isMakingDefault={false}
            {...handlers}
            {...props}
        />
    );
    return handlers;
};

// Radix DropdownMenu opens on pointerdown, not click, so a plain click leaves
// the menu closed and every menuitem query fails with "unable to find role".
const openMenu = async () => {
    const trigger = screen.getByRole('button', { name: strings.actions });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
};

describe('InviteLinkCard', () => {
    it('shows the name, the DEFAULT badge, the created date and the full link', () => {
        renderCard();
        expect(screen.getByText('Summer Batch 2026')).toBeInTheDocument();
        expect(screen.getByText(strings.defaultTag)).toBeInTheDocument();
        // The created date sits in the <dd> right after the "Created" label.
        const createdLabel = screen.getByText(strings.meta.created);
        expect(createdLabel.nextElementSibling).toHaveTextContent(/2026/);
        expect(screen.getByRole('link', { name: INVITE_URL })).toHaveAttribute('href', INVITE_URL);
        // A default link has nothing to be made default of.
        expect(screen.queryByText(strings.makeDefault)).not.toBeInTheDocument();
    });

    it('offers "Make default" on a non-default link, and edit/delete from the ⋮ menu', async () => {
        const handlers = renderCard({ invite: invite({ tag: 'REGULAR' }) });

        fireEvent.click(screen.getByRole('button', { name: strings.makeDefault }));
        expect(handlers.onMakeDefault).toHaveBeenCalledTimes(1);

        await openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(strings.edit) }));
        expect(handlers.onEdit).toHaveBeenCalledTimes(1);

        await openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(strings.delete) }));
        expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    });

    it('lists the short address inside the menu, and disables the item when there is none', async () => {
        renderCard();
        await openMenu();
        const item = screen.getByRole('menuitem', { name: /u\.vacademy\.io\/s\/8s7t7s/ });
        expect(item).not.toHaveAttribute('aria-disabled', 'true');
        expect(item).not.toHaveTextContent('https://');

        cleanup();
        renderCard({ invite: invite({ short_url: null }) });
        await openMenu();
        expect(
            screen.getByRole('menuitem', { name: new RegExp(strings.menu.copyShortUrl) })
        ).toHaveAttribute('aria-disabled', 'true');
    });

    it('names the creator and never shows an Updated line', () => {
        renderCard({
            invite: invite({
                created_by_user_id: 'u-1',
                created_by_name: 'Neeraj Hariyale',
                updated_at: '2026-09-12T08:00:00.000Z',
                updated_by_user_id: 'u-2',
                updated_by_name: 'Kajal Kumari',
            }),
        });
        expect(screen.getByText('Neeraj Hariyale')).toBeInTheDocument();
        // Edits are the activity log's story, not the card's.
        expect(screen.queryByText('Kajal Kumari')).not.toBeInTheDocument();
    });

    it('falls back to the raw id when the name lookup failed, and omits "by" when nothing is recorded', () => {
        renderCard({ invite: invite({ created_by_user_id: 'u-1', created_by_name: null }) });
        expect(screen.getByText('u-1')).toBeInTheDocument();

        cleanup();
        renderCard({ invite: invite({ created_by_user_id: null, created_by_name: null }) });
        expect(screen.queryByText(strings.meta.by)).not.toBeInTheDocument();
    });

    it('opens the QR dialog from the menu with a symbol encoding the full invite URL', async () => {
        renderCard();
        await openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(strings.menu.qrCode) }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        const dialog = screen.getByRole('dialog');
        expect(dialog.querySelector('svg')).not.toBeNull();
        // The encoded value is echoed under the symbol; by default it is the
        // full URL, never the revocable short link.
        expect(dialog).toHaveTextContent(INVITE_URL);
        expect(screen.getByText(strings.qr.fullUrlNote)).toBeInTheDocument();
    });

    it('always offers the UTM generator, even with the institute switch off', async () => {
        renderCard();
        await openMenu();
        fireEvent.click(
            screen.getByRole('menuitem', { name: new RegExp(strings.menu.utmGenerator) })
        );
        expect(screen.getByTestId('utm-builder')).toBeInTheDocument();
    });
});
