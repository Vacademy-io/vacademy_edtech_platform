package vacademy.io.admin_core_service.features.erp_finance.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** One debit-or-credit line of a journal entry, with cost-center dimensions (V484). */
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "erp_journal_line")
public class JournalLine {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "journal_entry_id", nullable = false)
    private JournalEntry journalEntry;

    @Column(name = "line_no", nullable = false)
    private Integer lineNo;

    @Column(name = "gl_account_code", nullable = false, length = 50)
    private String glAccountCode;

    @Column(name = "gl_account_name")
    private String glAccountName;

    @Column(name = "debit", precision = 18, scale = 2)
    private BigDecimal debit;

    @Column(name = "credit", precision = 18, scale = 2)
    private BigDecimal credit;

    @Column(name = "department_id")
    private String departmentId;

    @Column(name = "employee_id")
    private String employeeId;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
