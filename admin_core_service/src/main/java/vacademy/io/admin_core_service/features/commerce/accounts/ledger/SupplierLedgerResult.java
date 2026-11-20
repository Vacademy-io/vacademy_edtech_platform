package vacademy.io.admin_core_service.features.commerce.accounts.ledger;

import vacademy.io.admin_core_service.features.commerce.accounts.entity.CommerceSupplierLedgerEntry;

/** The ledger row of a post, and whether this call wrote it ({@code false}: a repeat of the same key). */
public record SupplierLedgerResult(CommerceSupplierLedgerEntry entry, boolean created) {
}
