package vacademy.io.admin_core_service.features.telephony.enums;

/**
 * Who asked for an AI call — decides which of the pre-dial throttles apply.
 *
 * <p>The throttles ({@code SKIPPED_ASSIGNED}, {@code SKIPPED_DAILY_CAP},
 * {@code SKIPPED_DUPLICATE}) all return HTTP 200 with {@code dispatched=false} and
 * dial nothing, so applying the wrong one to the wrong caller makes calling look
 * broken rather than throttled. They exist to bound AUTOMATION, which can loop,
 * re-enter and fan out — not to overrule a person who pressed a button.
 */
public enum CallTrigger {

    /** Workflow node, scheduler, retry re-dialer. Every throttle applies. */
    AUTOMATION,

    /**
     * One person, one click, one lead. No throttle applies: if they ask for a call,
     * a phone rings. Notably the already-assigned guard, which refused a counsellor
     * on every lead she owns — her leads are assigned by definition.
     */
    MANUAL,

    /**
     * A person started a bulk campaign over leads they picked. Skips the
     * already-assigned guard for the same reason as {@link #MANUAL} — they chose
     * these leads deliberately — but KEEPS the daily cap and the duplicate window,
     * because a fan-out is exactly what those two are there to bound.
     */
    BULK_MANUAL,

    /**
     * A workflow whose CALL_AI node was explicitly authored with
     * {@code ignoreAssignedGuard = true}. Same throttle profile as
     * {@link #BULK_MANUAL}: the already-assigned guard is skipped because an admin
     * deliberately built a graph that targets leads a counsellor already owns (e.g.
     * "when a manual call is dispositioned DNP, let the bot try again"), but the
     * daily cap and the duplicate window still apply — this path IS automation and
     * can loop, so the two throttles that bound fan-out must stay on.
     *
     * <p>Distinct from {@link #AUTOMATION} so the skip is visible in logs and can
     * never be the default: a node without the flag still comes in as AUTOMATION.
     */
    WORKFLOW_EXPLICIT,

    /**
     * The public AI calling API (Telleo API v1). A client's server places calls on
     * its own contacts, so every fan-out guard applies — institute daily cap,
     * per-number daily cap, the recall gap and the duplicate window — and the queue
     * respects calling hours. The assigned-lead guard does not: an API contact is not
     * a lead in our CRM.
     */
    API;

    /** True when the lead already having a counsellor should block the dial. */
    public boolean enforcesAssignedLeadGuard() {
        return this == AUTOMATION;
    }

    /** True when the institute's rolling 24h dial cap should block the dial. */
    public boolean enforcesDailyCap() {
        return this != MANUAL;
    }

    /**
     * True when the PER-LEAD rolling 24h cap should block the dial.
     *
     * <p>Same profile as the institute cap, and for the same reason: it bounds
     * fan-out, and a person clicking Call on one lead cannot fan anything out. This
     * is the guard that stops a lead being called twice by a re-fired campaign — the
     * bulk cooldown only spans minutes, while a queued run now spans hours.
     */
    public boolean enforcesPerLeadDailyCap() {
        return this != MANUAL;
    }

    /** True when a near-simultaneous duplicate for the same lead should be collapsed. */
    public boolean enforcesDuplicateWindow() {
        return this != MANUAL;
    }
}
