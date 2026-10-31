package vacademy.io.admin_core_service.features.hr_compliance.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** A TDS deposit (challan) against withheld salary TDS — mapped into Form 24Q (V483). */
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "hr_tds_challan")
public class TdsChallan {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "financial_year", nullable = false, length = 10)
    private String financialYear;

    /** Q1..Q4 in FY terms (Q1 = Apr–Jun). */
    @Column(name = "quarter", nullable = false, length = 2)
    private String quarter;

    @Column(name = "month")
    private Integer month;

    @Column(name = "year")
    private Integer year;

    @Column(name = "deposit_date", nullable = false)
    private LocalDate depositDate;

    @Column(name = "bsr_code", length = 10)
    private String bsrCode;

    @Column(name = "challan_serial", length = 10)
    private String challanSerial;

    @Column(name = "amount", nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(name = "interest", precision = 15, scale = 2)
    private BigDecimal interest;

    @Column(name = "fee", precision = 15, scale = 2)
    private BigDecimal fee;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;

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
