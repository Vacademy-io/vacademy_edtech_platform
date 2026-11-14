import type { LiveActivityEvent } from '../-services/live-activity-service';

/** Where a person currently stands. Drives the badge, not just the wording. */
export type JourneyState =
    | 'FORM_FILLED'
    | 'PAYMENT_PENDING'
    | 'PAID'
    | 'ENROLLED'
    | 'CALL_IN_PROGRESS'
    | 'CALL_ENDED'
    | 'NONE';

export interface CollapsedActivity {
    /** The newest event in the group -- what the row renders as its current state. */
    latest: LiveActivityEvent;
    /** Every event in the group, newest first. Length 1 means nothing was collapsed. */
    transitions: LiveActivityEvent[];
    key: string;
    /** Current standing, derived from the whole group rather than the last event alone. */
    state: JourneyState;
}

/**
 * Collapse related events into one row per *subject*, not one row per event.
 *
 * <p><b>This is the central design decision of the feed.</b> An event log answers "what
 * happened"; an admin needs "who is where, and do I need to act". Those are different
 * shapes. A prospect who fills the form, reaches payment and pays produces three events but
 * is one person at one stage -- showing three rows makes the reader reconstruct the journey
 * themselves, and buries the fact that the middle state is the one worth acting on.
 *
 * <p>So a row is a person, it updates in place as they progress, and the trail stays
 * available underneath. The discrete per-event view still exists on the category tabs.
 *
 * <p>Two things collapse:
 * <ul>
 *   <li><b>An enrolment journey</b>, keyed by subject. FORM_NEXT, REACHED_PAYMENT, ENROLLED
 *       and the payment outcome for one person are one story.</li>
 *   <li><b>A call</b>, keyed by call log id. QUEUED/RINGING/CONNECTED/ENDED is one call.</li>
 * </ul>
 *
 * <p>Leads and counsellor actions do not collapse: each is a discrete moment rather than a
 * stage in something longer.
 */
export function collapseEvents(events: LiveActivityEvent[]): CollapsedActivity[] {
    const out: CollapsedActivity[] = [];
    const indexByKey = new Map<string, number>();

    for (const event of events) {
        const key = groupKeyFor(event);

        if (key === null) {
            out.push({
                latest: event,
                transitions: [event],
                key: event.eventId,
                state: stateOf([event]),
            });
            continue;
        }

        const existing = indexByKey.get(key);
        if (existing === undefined) {
            indexByKey.set(key, out.length);
            out.push({ latest: event, transitions: [event], key, state: stateOf([event]) });
            continue;
        }

        const group = out[existing];
        if (!group) continue;

        group.transitions.push(event);
        // The list arrives newest-first, so the first event seen is normally already the
        // latest. Guard on the timestamp anyway rather than assuming order, because a
        // replayed batch after a reconnect can merge in out of order.
        if (event.occurredAtEpochMillis > group.latest.occurredAtEpochMillis) {
            group.latest = event;
        }
        group.state = stateOf(group.transitions);
    }

    return out;
}

/**
 * The key a row groups on, or null to stand alone.
 *
 * <p>The enrolment journey keys on the subject rather than the invite, because the same
 * person moving through stages is the thing being tracked. Payments join that journey when
 * they carry a subject, so "paid" lands on the row already showing "payment pending"
 * instead of appearing as an unrelated line elsewhere in the list.
 */
function groupKeyFor(event: LiveActivityEvent): string | null {
    if (event.category === 'CALL' && event.entityId) {
        return `CALL:${event.entityId}`;
    }
    if ((event.category === 'INVITE_FORM' || event.category === 'PAYMENT') && event.subjectId) {
        return `JOURNEY:${event.subjectId}`;
    }
    return null;
}

/**
 * Current standing for a group.
 *
 * <p>Derived from which milestones are present, not from the most recent event. Ordering is
 * not guaranteed -- a webhook can land out of order, and a replay can merge an older event
 * after a newer one -- so "has this person paid" is a question about the whole set.
 */
function stateOf(events: LiveActivityEvent[]): JourneyState {
    const actions = new Set(events.map((e) => e.action));

    if (actions.has('ENROLLED')) return 'ENROLLED';
    if (actions.has('PAYMENT_SUCCEEDED') || actions.has('RENEWAL_SUCCEEDED')) return 'PAID';
    if (actions.has('REACHED_PAYMENT') || actions.has('PAYMENT_FAILED')) return 'PAYMENT_PENDING';
    if (actions.has('FORM_NEXT')) return 'FORM_FILLED';

    if (actions.has('CALL_ENDED')) return 'CALL_ENDED';
    if (
        actions.has('CALL_CONNECTED') ||
        actions.has('CALL_RINGING') ||
        actions.has('CALL_QUEUED')
    ) {
        return 'CALL_IN_PROGRESS';
    }
    return 'NONE';
}
