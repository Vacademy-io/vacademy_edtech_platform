package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Outcome of a bulk lead-status change. Partial success is the normal case —
 * a selection carried over from a stale page can contain leads that were since
 * deleted, and leads already on the target status are a no-op — so the caller
 * gets per-bucket counts instead of a single boolean.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BulkLeadStatusResponseDTO {

    /** Leads whose status actually moved. */
    private int updated;

    /** Leads already on the target status — counted, not re-written, no history row. */
    private int unchanged;

    /** Leads that could not be updated (missing row, mirror failure, …). */
    private int failed;

    /** Up to the first few failure reasons, for a toast that says what went wrong. */
    private List<String> errors;
}
