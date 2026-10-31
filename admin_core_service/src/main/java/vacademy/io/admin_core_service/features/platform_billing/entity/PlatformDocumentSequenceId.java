package vacademy.io.admin_core_service.features.platform_billing.entity;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;

/** Composite key of {@link PlatformDocumentSequence}: (series_key, fy). */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class PlatformDocumentSequenceId implements Serializable {
    private String seriesKey;
    private String fy;
}
