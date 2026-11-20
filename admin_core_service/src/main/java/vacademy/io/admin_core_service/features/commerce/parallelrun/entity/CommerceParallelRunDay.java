package vacademy.io.admin_core_service.features.commerce.parallelrun.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One business day of a store's parallel run (V744): the old system's day totals as a manager
 * entered them, the platform's figures for the same day and location as computed at save time
 * ({@code platform_json}), and the verdict. One row per institute, location and date.
 * {@code result} holds a name of {@code ParallelRunResult}.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_parallel_run_day")
public class CommerceParallelRunDay {

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    /** The store's trading day in the institute's time zone. */
    @Column(name = "business_date", nullable = false, updatable = false)
    private LocalDate businessDate;

    @Column(name = "old_bill_count", nullable = false)
    private Integer oldBillCount;

    /** Net sales of the day, tax included, after round-off. */
    @Column(name = "old_sales_value", nullable = false, precision = 14, scale = 2)
    private BigDecimal oldSalesValue;

    @Column(name = "old_tax", nullable = false, precision = 14, scale = 2)
    private BigDecimal oldTax;

    /** Cash taken less cash refunded. */
    @Column(name = "old_cash", nullable = false, precision = 14, scale = 2)
    private BigDecimal oldCash;

    /** Returns value; null = not compared. */
    @Column(name = "old_returns", precision = 14, scale = 2)
    private BigDecimal oldReturns;

    /** The platform's day figures (JSON object) used for the verdict. */
    @Column(name = "platform_json", nullable = false, columnDefinition = "text")
    private String platformJson;

    @Column(name = "result", nullable = false, length = 16)
    private String result;

    @Column(name = "note", length = 500)
    private String note;

    /** User id of whoever saved the day last. */
    @Column(name = "reviewed_by", nullable = false, length = 255)
    private String reviewedBy;

    @Column(name = "reviewed_at", nullable = false)
    private LocalDateTime reviewedAt;

    @Version
    @Column(name = "version", nullable = false)
    private Integer version;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    // The database default covers the insert only and no trigger maintains the column.
    @Column(name = "updated_at", insertable = false)
    private LocalDateTime updatedAt;

    @PreUpdate
    void touchUpdatedAt() {
        this.updatedAt = LocalDateTime.now();
    }
}
