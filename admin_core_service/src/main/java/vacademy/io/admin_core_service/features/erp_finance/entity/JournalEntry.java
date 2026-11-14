package vacademy.io.admin_core_service.features.erp_finance.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One balanced double-entry journal (V484) — the seed of the Accounting/GL
 * module. Payroll approval posts here (source HR_PAYROLL, source_id = run id);
 * fees and future accounting share the same table so cross-module P&L reads
 * one place. Idempotent per (source_module, source_id) via a partial unique.
 */
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "erp_journal_entry")
public class JournalEntry {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "entry_date", nullable = false)
    private LocalDate entryDate;

    @Column(name = "period_month")
    private Integer periodMonth;

    @Column(name = "period_year")
    private Integer periodYear;

    /** HR_PAYROLL | FEES | MANUAL | ... */
    @Column(name = "source_module", nullable = false, length = 50)
    private String sourceModule;

    @Column(name = "source_id")
    private String sourceId;

    @Column(name = "reference")
    private String reference;

    @Column(name = "memo", columnDefinition = "TEXT")
    private String memo;

    @Column(name = "currency", length = 3)
    private String currency;

    /** POSTED | REVERSED */
    @Column(name = "status", length = 20)
    private String status;

    /** Set on a reversing entry: the entry it reverses. */
    @Column(name = "reversal_of_entry_id")
    private String reversalOfEntryId;

    @Column(name = "total_debit", precision = 18, scale = 2)
    private BigDecimal totalDebit;

    @Column(name = "total_credit", precision = 18, scale = 2)
    private BigDecimal totalCredit;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
