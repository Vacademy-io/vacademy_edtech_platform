package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * Per-financial-year counter of a v2 document series (V590 {@code platform_document_sequence}).
 * series_key 'I' = tax invoice ({@code VT/{FY}/I#####}), 'C' = credit note ({@code VT/{FY}/C#####});
 * fy '2627' = 1 Apr 2026 .. 31 Mar 2027 in Asia/Kolkata. {@code next_no} = the next number to issue.
 *
 * <p>Read-only view for reports and tests: allocate numbers only through the atomic upsert in
 * {@code PlatformDocumentSequenceService} / {@code PlatformDocumentSequenceRepository#allocate}, never
 * by read-modify-write of this entity.
 */
@Entity
@Table(name = "platform_document_sequence")
@IdClass(PlatformDocumentSequenceId.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformDocumentSequence {

    @Id
    @Column(name = "series_key", nullable = false, length = 8)
    private String seriesKey;

    @Id
    @Column(name = "fy", nullable = false, length = 4)
    private String fy;

    @Column(name = "next_no", nullable = false)
    private Integer nextNo;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;
}
