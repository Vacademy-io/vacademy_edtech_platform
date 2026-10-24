package vacademy.io.admin_core_service.features.user_subscription.dto;

/**
 * One row of the Manage Payments summary: how many rows carry a given status and what they add
 * up to, across the whole filtered set rather than the page on screen.
 */
public interface PaymentStatusTotalProjection {

    /**
     * The row's *classified* status — PAID / FAILED / ABANDONED / CANCELLED / NOT_INITIATED /
     * raw pending status — not the stored column. The query applies the same rules the row mapper
     * applies (a FAILED payment superseded by an ACTIVE plan reads PAID; a stale PAYMENT_PENDING
     * reads ABANDONED), so the tiles agree with the rows they filter to.
     */
    String getStatus();

    /** Normalised currency for this group; '' when the row carries none. */
    String getCurrency();

    /**
     * False for an unsettled row on a dead enrolment — money that will never arrive. Those are
     * reported separately so the pending tile does not overstate the gateway backlog.
     */
    boolean getDueEligible();

    long getRowCount();

    Double getTotalAmount();
}
