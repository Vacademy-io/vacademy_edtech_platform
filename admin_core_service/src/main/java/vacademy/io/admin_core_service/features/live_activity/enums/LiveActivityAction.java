package vacademy.io.admin_core_service.features.live_activity.enums;

/**
 * The complete event catalog.
 *
 * <p>The COUNSELLOR_* values deliberately reuse the vocabulary already defined by
 * {@code counsellor_workbench/dto/ActivityFeedItemDTO} and projected by
 * {@code WorkbenchActivityRepository.fetchFeed(...)}, so the institute-wide live feed and
 * the per-counsellor workbench feed describe the same real event identically.
 */
public enum LiveActivityAction {

    // INVITE_FORM -- the enrolment funnel: details filled -> reached payment -> paid.
    FORM_NEXT,
    REACHED_PAYMENT,
    ENROLLED,

    // LEAD_FORM
    LEAD_SUBMITTED,

    // CALL
    CALL_QUEUED,
    CALL_RINGING,
    CALL_CONNECTED,
    CALL_ENDED,

    // PAYMENT
    PAYMENT_SUCCEEDED,
    PAYMENT_FAILED,
    RENEWAL_SUCCEEDED,
    RENEWAL_FAILED,

    // COUNSELLOR -- names match ActivityFeedItemDTO.
    STATUS_CHANGED,
    LEAD_TRANSFERRED_IN,
    LEAD_TRANSFERRED_OUT,
    NOTE_ADDED,
    FOLLOWUP_CREATED,
    FOLLOWUP_CLOSED
}
