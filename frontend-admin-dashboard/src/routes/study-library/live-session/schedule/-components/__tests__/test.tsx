import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LiveSessionPreviewDialog } from '@/routes/study-library/live-session/schedule/-components/LiveSessionPreviewDialog';
import { ScheduleErrorBoundary } from '@/routes/study-library/live-session/schedule/-components/ScheduleErrorBoundary';
import { bulkSessionFormSchema } from '@/routes/study-library/live-session/schedule/-schema/bulkSchema';
import { AccessType } from '@/routes/study-library/live-session/-constants/enums';

afterEach(() => cleanup());

describe('Live-session schedule — crash hardening (no "System Crashed" page)', () => {
    it('LiveSessionPreviewDialog does not throw on malformed beforeLiveTime entries', () => {
        // The exact shape that tripped the route-level error page: nulls and
        // objects without a usable `time` reaching `.map(t => t.time)`. The body
        // (where this runs) executes even with open={false}, so this is the
        // precise crash path. Pre-fix this throws "Cannot read properties of
        // null (reading 'time')"; post-fix the bad entries are filtered out.
        const malformed = [null, undefined, {}, { time: '' }, { time: '5m' }] as never;

        expect(() =>
            render(
                <LiveSessionPreviewDialog
                    open={false}
                    onOpenChange={() => {}}
                    submitting={false}
                    onConfirm={() => {}}
                    sessions={[]}
                    courses={[]}
                    sessionList={[]}
                    notifications={{
                        notifyBy: { mail: true },
                        notifySettings: { onCreate: true, beforeLiveTime: malformed },
                    }}
                />
            )
        ).not.toThrow();
    });

    it('ScheduleErrorBoundary renders a recoverable fallback instead of letting the crash bubble', () => {
        const Boom = () => {
            throw new Error('simulated render crash');
        };
        // React logs the caught error to console.error; silence it for clean output.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(() =>
                render(
                    <ScheduleErrorBoundary feature="test">
                        <Boom />
                    </ScheduleErrorBoundary>
                )
            ).not.toThrow();
        } finally {
            errSpy.mockRestore();
        }

        // Localized fallback shown — NOT the global "System Crashed" page.
        // getByText / getByRole throw if the element is absent, so reaching these
        // assertions already proves the fallback rendered.
        expect(screen.getByText('Something went wrong')).toBeTruthy();
        expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });
});

describe('LiveSessionPreviewDialog — attendance-only notice', () => {
    // Resolves to the English copy or, if the catalog isn't loaded, the raw key.
    const notice = /attendance only|attendanceOnly\.title/i;
    const renderDialog = (attendanceOnly?: boolean) =>
        render(
            <LiveSessionPreviewDialog
                open
                onOpenChange={() => {}}
                submitting={false}
                onConfirm={() => {}}
                sessions={[]}
                courses={[]}
                sessionList={[]}
                attendanceOnly={attendanceOnly}
            />
        );

    it('shows the notice when the institute is in attendance-only mode', () => {
        renderDialog(true);
        expect(screen.queryByText(notice)).toBeTruthy();
    });

    it('hides the notice by default', () => {
        renderDialog();
        expect(screen.queryByText(notice)).toBeNull();
    });
});

describe('Private class requires at least one batch (bulk schedule)', () => {
    const baseRow = {
        title: 'Algebra',
        startDate: '2026-07-01',
        startTime: '10:00',
        durationHours: '1',
        durationMinutes: '0',
        platform: 'youtube',
        link: 'https://example.com/class',
        selectedLevels: [] as Array<{ courseId: string; sessionId: string; levelId: string }>,
    };
    const baseForm = {
        timeZone: 'Asia/Kolkata',
        rows: [baseRow],
        sharedOptions: {},
        accessType: AccessType.PRIVATE,
        fields: [],
        notifyBy: {
            mail: false,
            whatsapp: false,
            push_notification: false,
            system_notification: false,
        },
        notifySettings: {
            onCreate: false,
            beforeLive: false,
            beforeLiveTime: [],
            onLive: true,
            onAttendance: false,
        },
    };

    it('rejects a PRIVATE form whose row has no batch', () => {
        const res = bulkSessionFormSchema.safeParse(baseForm);
        expect(res.success).toBe(false);
        if (!res.success) {
            const hasBatchIssue = res.error.issues.some(
                (i) => i.path.join('.') === 'rows.0.selectedLevels'
            );
            expect(hasBatchIssue).toBe(true);
        }
    });

    it('accepts a PRIVATE form whose row has a batch', () => {
        const res = bulkSessionFormSchema.safeParse({
            ...baseForm,
            rows: [
                {
                    ...baseRow,
                    selectedLevels: [{ courseId: 'c', sessionId: 's', levelId: 'l' }],
                },
            ],
        });
        expect(res.success).toBe(true);
    });

    it('accepts a PUBLIC form even when rows have no batch', () => {
        const res = bulkSessionFormSchema.safeParse({
            ...baseForm,
            accessType: AccessType.PUBLIC,
        });
        expect(res.success).toBe(true);
    });
});
