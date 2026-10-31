package vacademy.io.admin_core_service.features.counselor_pool.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Edit a pool's metadata. Membership and audiences have their own endpoints. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdatePoolRequest {

    private String name;

    private String description;

    /** MANUAL | ROUND_ROBIN | TIME_BASED. Switching modes does NOT clear shifts or members. */
    @JsonProperty("assignment_mode")
    private String assignmentMode;

    /**
     * PER_DAY | SAME_HOURS_ALL_DAYS. Frontend sends this when admin picks a
     * schedule pattern from the empty state. Changing pattern with existing
     * shift rows in the pool is rejected at the service layer — admin must
     * clear the schedule first.
     */
    @JsonProperty("schedule_pattern")
    private String schedulePattern;

    /**
     * ROUND_ROBIN opt-in: gate the rotation to on-shift counsellors. Null means
     * "leave unchanged". Ignored at routing time for MANUAL / TIME_BASED.
     */
    @JsonProperty("shift_aware")
    private Boolean shiftAware;

    /**
     * Rotate in one pool-wide order instead of each list's own order. Null means
     * "leave unchanged". Ignored for MANUAL pools.
     */
    @JsonProperty("unified_rotation_order")
    private Boolean unifiedRotationOrder;
}
