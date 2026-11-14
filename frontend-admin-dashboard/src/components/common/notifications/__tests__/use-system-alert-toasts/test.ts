import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SystemAlertItem } from '@/services/notifications/system-alerts';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: toastSpy }));

import { useSystemAlertToasts } from '@/components/common/notifications/useSystemAlertToasts';

const alert = (id: string, extra: Partial<SystemAlertItem> = {}): SystemAlertItem => ({
    messageId: id,
    title: `Alert ${id}`,
    content: { id, type: 'html', content: '<p>AI check <b>finished</b>&nbsp;for Science</p>' },
    createdAt: '2026-09-15T00:00:00Z',
    isRead: false,
    ...extra,
});

describe('useSystemAlertToasts', () => {
    beforeEach(() => toastSpy.mockClear());

    it('treats what is there on first load as already seen', () => {
        renderHook(() => useSystemAlertToasts([alert('a'), alert('b')]));
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('toasts an alert that arrives later, once, as plain text', () => {
        const { rerender } = renderHook(({ alerts }) => useSystemAlertToasts(alerts), {
            initialProps: { alerts: [alert('a')] },
        });
        rerender({ alerts: [alert('new'), alert('a')] });
        rerender({ alerts: [alert('new'), alert('a')] });

        expect(toastSpy).toHaveBeenCalledTimes(1);
        expect(toastSpy).toHaveBeenCalledWith(
            'Alert new',
            expect.objectContaining({ description: 'AI check finished for Science' })
        );
    });

    it('stays quiet for alerts that are already read or dismissed', () => {
        const { rerender } = renderHook(({ alerts }) => useSystemAlertToasts(alerts), {
            initialProps: { alerts: [alert('a')] },
        });
        rerender({
            alerts: [alert('r', { isRead: true }), alert('d', { isDismissed: true }), alert('a')],
        });
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it('does nothing before the list has loaded', () => {
        const { rerender } = renderHook(({ alerts }) => useSystemAlertToasts(alerts), {
            initialProps: { alerts: undefined as SystemAlertItem[] | undefined },
        });
        rerender({ alerts: [alert('first')] });
        // The first real load is the baseline, not news.
        expect(toastSpy).not.toHaveBeenCalled();
    });
});
