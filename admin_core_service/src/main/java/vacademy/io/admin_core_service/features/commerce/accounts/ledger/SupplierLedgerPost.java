package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierLedgerType;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One change to a supplier's balance, as a document service asks for it. {@code amount} &gt; 0:
 * owed more; &lt; 0: owed less or an advance. {@code reversesEntryId} names the row this one
 * undoes (part or all of it). {@code idempotencyKey} is unique per institute forever, shaped
 * {@code KIND:<id>[:...]}, for example {@code BILL:<bill id>:r1} or {@code OPENING:<source id>}.
 */
public record SupplierLedgerPost(String instituteId, String supplierId, LocalDate bookDate, SupplierLedgerType type,
                                 BigDecimal amount, String referenceType, String referenceId, String documentNumber,
                                 String locationId, String note, String actorUserId, String reversesEntryId,
                                 String idempotencyKey) {
}
