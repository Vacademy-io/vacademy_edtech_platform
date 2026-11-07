import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatThread, type ThreadMessage } from '../../ChatThread';
import type { ChatConversationResponse } from '@/services/chat/chatApi';

const isAdminForInstitute = vi.fn(() => false);
vi.mock('@/lib/auth/roleUtils', () => ({
    isAdminForInstitute: () => isAdminForInstitute(),
}));

// happy-dom has no scrollIntoView; ChatThread auto-scrolls to the newest message on mount.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
}

const ME = 'me-1';
const THEM = 'them-1';

const conversation = (memberRole?: string): ChatConversationResponse => ({
    id: 'conv-1',
    type: 'BATCH_GROUP',
    instituteId: 'inst-1',
    unreadCount: 0,
    canPost: true,
    memberRole,
});

const message = (overrides: Partial<ThreadMessage>): ThreadMessage => ({
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: THEM,
    senderName: 'Someone',
    contentType: 'TEXT',
    content: 'hello',
    seq: 1,
    createdAt: '2026-08-25T05:00:00Z',
    ...overrides,
});

const renderThread = (
    props: Partial<React.ComponentProps<typeof ChatThread>> & {
        conversation?: ChatConversationResponse;
    } = {}
) => {
    const onDelete = vi.fn();
    const onReport = vi.fn();
    const onEdit = vi.fn<[ThreadMessage, string], Promise<void>>(() => Promise.resolve());
    render(
        <ChatThread
            conversation={props.conversation ?? conversation()}
            messages={props.messages ?? [message({})]}
            currentUserId={ME}
            isLoading={false}
            hasMore={false}
            onLoadMore={vi.fn()}
            onRetry={vi.fn()}
            onDelete={onDelete}
            onReport={'onReport' in props ? props.onReport : onReport}
            onEdit={'onEdit' in props ? props.onEdit : onEdit}
        />
    );
    return { onDelete, onReport, onEdit };
};

describe('ChatThread message actions', () => {
    beforeEach(() => {
        isAdminForInstitute.mockReturnValue(false);
    });

    it('offers delete on your OWN message', () => {
        const { onDelete } = renderThread({
            messages: [message({ senderId: ME, senderName: 'Me' })],
        });

        fireEvent.click(screen.getByRole('button', { name: /delete message/i }));
        // Deleting is irreversible for everyone in the thread, so it is confirmed first.
        fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete.mock.calls[0]?.[0]?.id).toBe('msg-1');
    });

    it('does not offer delete on someone else’s message to a plain member', () => {
        renderThread({ conversation: conversation('MEMBER') });

        expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
    });

    it('offers delete on someone else’s message to a conversation MODERATOR', () => {
        renderThread({ conversation: conversation('MODERATOR') });

        expect(screen.getByRole('button', { name: /delete message/i })).toBeInTheDocument();
    });

    it('offers delete to an institute ADMIN who has no member row at all', () => {
        // An admin is shown every batch group whether or not they joined it, so memberRole is
        // undefined for the channels they only observe — the institute role has to carry the grant.
        isAdminForInstitute.mockReturnValue(true);
        renderThread({ conversation: conversation(undefined) });

        expect(screen.getByRole('button', { name: /delete message/i })).toBeInTheDocument();
    });

    it('does NOT extend the institute-admin grant into a direct message', () => {
        // A DM stays private to its two participants — the server refuses moderation there, so showing
        // the control would only produce a 403.
        isAdminForInstitute.mockReturnValue(true);
        renderThread({ conversation: { ...conversation(undefined), type: 'DIRECT' } });

        expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
    });

    it('offers report on someone else’s message and never on your own', () => {
        renderThread({ messages: [message({}), message({ id: 'msg-2', senderId: ME, seq: 2 })] });

        expect(screen.getAllByRole('button', { name: /report message/i })).toHaveLength(1);
    });

    it('hides report entirely when the surface passes no handler', () => {
        renderThread({ onReport: undefined });

        expect(screen.queryByRole('button', { name: /report message/i })).toBeNull();
    });

    it('offers neither action on an optimistic (not-yet-persisted) message', () => {
        renderThread({
            conversation: conversation('MODERATOR'),
            messages: [message({ id: 'temp-1', senderId: ME, pending: true })],
        });

        expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /report message/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /edit message/i })).toBeNull();
    });

    it('offers neither action on an already-deleted message', () => {
        renderThread({
            conversation: conversation('MODERATOR'),
            messages: [message({ senderId: ME, isDeleted: true })],
        });

        expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /report message/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /edit message/i })).toBeNull();
    });

    it('edits your OWN message and sends the new text', async () => {
        const { onEdit } = renderThread({
            messages: [message({ senderId: ME, content: 'teh meeting is at 5' })],
        });

        fireEvent.click(screen.getByRole('button', { name: /edit message/i }));
        const box = screen.getByRole('textbox', { name: /message text/i });
        expect(box).toHaveValue('teh meeting is at 5');
        fireEvent.change(box, { target: { value: 'the meeting is at 6' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
        expect(onEdit.mock.calls[0]?.[1]).toBe('the meeting is at 6');
    });

    it('will not save an edit that changes nothing', () => {
        renderThread({ messages: [message({ senderId: ME, content: 'hello' })] });

        fireEvent.click(screen.getByRole('button', { name: /edit message/i }));

        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });

    it('will not save an empty edit — deleting is how you remove a message', () => {
        renderThread({ messages: [message({ senderId: ME, content: 'hello' })] });

        fireEvent.click(screen.getByRole('button', { name: /edit message/i }));
        fireEvent.change(screen.getByRole('textbox', { name: /message text/i }), {
            target: { value: '   ' },
        });

        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });

    it('never offers edit on someone else’s message, even to a moderator', () => {
        // A moderator may take a message down, but must not put different words in someone's mouth.
        renderThread({ conversation: conversation('MODERATOR') });

        expect(screen.queryByRole('button', { name: /edit message/i })).toBeNull();
    });

    it('marks an edited message as edited', () => {
        renderThread({ messages: [message({ senderId: ME, isEdited: true })] });

        expect(screen.getByText('edited')).toBeInTheDocument();
    });

    it('hides self-delete when the institute has switched it off', () => {
        renderThread({
            conversation: { ...conversation('MEMBER'), canDeleteOwnMessages: false },
            messages: [message({ senderId: ME })],
        });

        expect(screen.queryByRole('button', { name: /delete message/i })).toBeNull();
    });

    it('hides self-edit when the institute has switched it off', () => {
        renderThread({
            conversation: { ...conversation('MEMBER'), canEditOwnMessages: false },
            messages: [message({ senderId: ME })],
        });

        expect(screen.queryByRole('button', { name: /edit message/i })).toBeNull();
    });

    it('still lets a moderator delete OTHERS when self-delete is switched off', () => {
        // The institute flag governs the sender path only — it must never disarm moderation.
        renderThread({
            conversation: { ...conversation('MODERATOR'), canDeleteOwnMessages: false },
        });

        expect(screen.getByRole('button', { name: /delete message/i })).toBeInTheDocument();
    });

    it('keeps both actions when the backend sends no flags at all', () => {
        // An older backend omits them; absent must mean allowed, not denied.
        renderThread({ messages: [message({ senderId: ME })] });

        expect(screen.getByRole('button', { name: /delete message/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /edit message/i })).toBeInTheDocument();
    });

    it('keeps the action rail hit-testable rather than display:none, anchored inside the scroll area', () => {
        // The shipped regression: the controls used `hidden` + `group-hover:block` at a NEGATIVE right
        // offset. `display:none` drops them from hit-testing until the bubble is hovered, and the gap
        // between bubble and button meant the hover was lost before the pointer ever arrived — on an
        // own (right-aligned) bubble the button also landed outside the scrollport entirely.
        renderThread({ messages: [message({ senderId: ME })] });

        const rail = screen.getByRole('button', { name: /delete message/i }).parentElement;
        expect(rail).not.toBeNull();
        expect(rail!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
        expect(rail!.className).not.toMatch(/-right-\d/);
        // Own bubbles sit against the container edge, so their rail must open to the LEFT.
        expect(rail!.className).toMatch(/right-full/);
    });
});
