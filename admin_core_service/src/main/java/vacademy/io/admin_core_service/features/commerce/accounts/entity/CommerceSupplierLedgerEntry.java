package vacademy.io.admin_core_service.features.commerce.accounts.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Immutable;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One change of a supplier's balance (V734). Append-only: rows are inserted by
 * {@code CommerceSupplierLedgerRepository.insertIfAbsent} (one row per institute and idempotency
 * key) and never updated or deleted; a correction is a new row naming the one it reverses.
 * {@code amount} &gt; 0: owed more; &lt; 0: owed less or an advance. {@code type} is a name of
 * {@code SupplierLedgerType}.
 */
@Getter
@Setter
@NoArgsConstructor
@Immutable
@Entity
@Table(name = "commerce_supplier_ledger")
public class CommerceSupplierLedgerEntry {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "supplier_id", nullable = false, updatable = false, length = 36)
    private String supplierId;

    @Column(name = "book_date", nullable = false, updatable = false)
    private LocalDate bookDate;

    @Column(name = "type", nullable = false, updatable = false, length = 32)
    private String type;

    @Column(name = "amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "reference_type", updatable = false, length = 32)
    private String referenceType;

    @Column(name = "reference_id", updatable = false, length = 36)
    private String referenceId;

    @Column(name = "document_number", updatable = false, length = 64)
    private String documentNumber;

    @Column(name = "location_id", updatable = false, length = 36)
    private String locationId;

    @Column(name = "note", updatable = false, length = 500)
    private String note;

    @Column(name = "actor_user_id", updatable = false, length = 36)
    private String actorUserId;

    @Column(name = "reverses_entry_id", updatable = false, length = 36)
    private String reversesEntryId;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 100)
    private String idempotencyKey;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;
}
