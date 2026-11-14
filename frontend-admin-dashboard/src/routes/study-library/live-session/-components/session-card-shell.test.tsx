/**
 * Covers the two pieces of the redesigned session cards that carry real logic:
 * the batch overflow toggle, and the date/time formatters the past and draft
 * cards use (those two tabs previously printed raw API strings like
 * "2026-03-09 11:00:00").
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionBatches, SessionTeacher } from './session-card-shell';
import {
    describeTimeUntilStart,
    formatClockTime,
    formatMeetingDate,
    formatTimeRange,
} from '../-utils/live-sesstions';

const renderBatches = (batches: string[]) =>
    render(
        <SessionBatches
            batches={batches}
            label="Batches"
            moreLabel={(count) => `+${count} more`}
            lessLabel="Show less"
        />
    );

describe('SessionBatches', () => {
    it('shows the total count and collapses the overflow', () => {
        renderBatches(['NEET Aimers 2027', 'Foundation 2027', 'Crash Course 2027', 'Target 680+']);

        expect(screen.getByText('Batches (4)')).toBeInTheDocument();
        expect(screen.getByText('NEET Aimers 2027, Foundation 2027')).toBeInTheDocument();
        // Third and fourth are behind the toggle, not run into the line.
        expect(screen.queryByText(/Crash Course 2027/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument();
    });

    it('expands to one name per line, not a second ellipsis', () => {
        renderBatches(['A', 'B', 'C']);

        fireEvent.click(screen.getByRole('button', { name: '+1 more' }));

        // Every name gets its own element — the collapsed view's single
        // `truncate`d line is what made "+1 more" reveal nothing.
        const items = screen.getAllByRole('listitem');
        expect(items.map((li) => li.textContent)).toEqual(['A', 'B', 'C']);
        expect(items.every((li) => !li.className.includes('truncate'))).toBe(true);
        expect(screen.queryByText('A, B, C')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(screen.getByText('A, B')).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });

    it('renders no toggle when everything already fits', () => {
        renderBatches(['Only batch']);


        expect(screen.getByText('Batches (1)')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders nothing at all when a session has no batches', () => {
        const { container } = renderBatches([]);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('SessionTeacher', () => {
    const renderTeacher = (
        instructors: Parameters<typeof SessionTeacher>[0]['instructors'],
        urls: Record<string, string> = {}
    ) =>
        render(
            <SessionTeacher
                instructors={instructors}
                label="Teacher"
                unassignedLabel="Not assigned"
                unknownLabel="Unnamed teacher"
                avatarUrlByFileId={urls}
            />
        );

    it('shows the name with a first-letter badge when there is no photo', () => {
        renderTeacher([{ user_id: 'u1', full_name: 'Priyanshu Sharma' }]);

        expect(screen.getByText('Teacher')).toBeInTheDocument();
        expect(screen.getByText('Priyanshu Sharma')).toBeInTheDocument();
        // First letter only, not both initials.
        expect(screen.getByText('P')).toBeInTheDocument();
        expect(screen.queryByText('PS')).not.toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('shows the photo when the page resolved one', () => {
        renderTeacher([{ user_id: 'u1', full_name: 'Priyanshu Sharma', profile_pic_file_id: 'f1' }], {
            f1: 'https://cdn.example.com/p.jpg',
        });

        expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/p.jpg');
        expect(screen.getByText('Priyanshu Sharma')).toBeInTheDocument();
        // The letter badge gives way to the photo rather than sitting beside it.
        expect(screen.queryByText('P')).not.toBeInTheDocument();
    });

    it('falls back to the letter badge when the file id resolved to nothing', () => {
        renderTeacher([{ user_id: 'u1', full_name: 'Ananya Verma', profile_pic_file_id: 'f9' }], {});

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('counts co-instructors rather than overflowing the line', () => {
        renderTeacher([
            { user_id: 'u1', full_name: 'Priyanshu Sharma' },
            { user_id: 'u2', full_name: 'Ananya Verma' },
        ]);

        expect(screen.getByText('+1')).toBeInTheDocument();
    });

    it('renders nothing at all when no teacher is assigned', () => {
        const { container } = renderTeacher([]);

        // A greyed-out "Not assigned" on every card is noise, not information.
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText('Teacher')).not.toBeInTheDocument();
        expect(screen.queryByText('Not assigned')).not.toBeInTheDocument();
    });

    it('renders nothing when nothing was sent at all', () => {
        const { container } = renderTeacher(null);
        expect(container).toBeEmptyDOMElement();
    });

    it('still renders when somebody is assigned but unnamed — that is a real problem', () => {
        renderTeacher([{ user_id: 'u1' }]);

        expect(screen.getByText('Teacher')).toBeInTheDocument();
        expect(screen.getByText('Unnamed teacher')).toBeInTheDocument();
    });

    it('never prints a raw user id when the directory could not name them', () => {
        renderTeacher([{ user_id: 'e0a1b2c3-dead-beef' }]);

        expect(screen.getByText('Unnamed teacher')).toBeInTheDocument();
        expect(screen.queryByText(/e0a1b2c3/)).not.toBeInTheDocument();
    });
});

describe('card date/time formatters', () => {
    it('formats a plain meeting date', () => {
        expect(formatMeetingDate('2026-03-09')).toBe('Mon, 09 Mar 2026');
    });

    it('accepts an ISO timestamp for the date', () => {
        expect(formatMeetingDate('2026-03-09T11:00:00Z')).toBe('Mon, 09 Mar 2026');
    });

    it('formats clock times with and without an offset', () => {
        expect(formatClockTime('11:00:00')).toBe('11:00 AM');
        expect(formatClockTime('12:15:00+05:30')).toBe('12:15 PM');
        expect(formatClockTime('2026-03-09T19:30:00Z')).toBe('7:30 PM');
    });

    it('builds a range, and degrades to the start alone', () => {
        expect(formatTimeRange('11:00:00', '12:15:00')).toBe('11:00 AM – 12:15 PM');
        expect(formatTimeRange('11:00:00', null)).toBe('11:00 AM');
    });

    it('returns null for empty input rather than rendering "null"', () => {
        expect(formatMeetingDate(null)).toBeNull();
        expect(formatMeetingDate('')).toBeNull();
        expect(formatClockTime(undefined)).toBeNull();
    });

    it('echoes unparseable input instead of throwing', () => {
        expect(formatMeetingDate('not-a-date')).toBe('not-a-date');
    });
});

describe('describeTimeUntilStart', () => {
    const now = new Date('2026-03-09T11:00:00Z');

    it('says nothing once the class has started', () => {
        expect(describeTimeUntilStart(new Date('2026-03-09T10:59:00Z'), now)).toBeNull();
        expect(describeTimeUntilStart(now, now)).toBeNull();
    });

    it('counts minutes, hours and days, singular where it should', () => {
        expect(describeTimeUntilStart(new Date('2026-03-09T11:10:00Z'), now)).toBe('10 minutes');
        expect(describeTimeUntilStart(new Date('2026-03-09T11:01:00Z'), now)).toBe('1 minute');
        expect(describeTimeUntilStart(new Date('2026-03-09T14:00:00Z'), now)).toBe('3 hours');
        expect(describeTimeUntilStart(new Date('2026-03-12T11:00:00Z'), now)).toBe('3 days');
        expect(describeTimeUntilStart(new Date('2026-03-10T11:00:00Z'), now)).toBe('1 day');
    });

    it('is quiet rather than throwing on an unparseable date', () => {
        expect(describeTimeUntilStart(new Date('nope'), now)).toBeNull();
    });
});
