package vacademy.io.admin_core_service.features.commerce.accounts.period;

import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewItem;

import java.time.LocalDate;

/**
 * One kind of document still open on or before a date (unbilled receipts, drafts, entries to
 * review). Every bean is asked, in kind order, by the lock preview and by the lock itself (after it
 * holds the lock row), so the counts it answers include everything committed before the lock.
 */
public interface PeriodLockPreviewContributor {

    /** Upper-case kind, for example {@code UNBILLED_RECEIPTS}; also the key in the audit counts. */
    String kind();

    /** The count and up to ten samples dated on or before {@code through}; joins the caller's transaction. */
    PreviewItem items(String instituteId, LocalDate through);
}
