package vacademy.io.admin_core_service.features.counselor_pool.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/**
 * Full read-side view of a pool, including its audiences, members, and shifts.
 * Used by the "view pool detail" endpoint. List endpoints can use a slimmer
 * projection if needed.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CounselorPoolDTO {

    private String id;

    @JsonProperty("institute_id")
    private String instituteId;

    private String name;

    private String description;

    @JsonProperty("assignment_mode")
    private String assignmentMode;

    /** PER_DAY | SAME_HOURS_ALL_DAYS — drives which schedule editor the UI renders. */
    @JsonProperty("schedule_pattern")
    private String schedulePattern;

    /** ROUND_ROBIN opt-in: rotation gated to on-shift counsellors. */
    @JsonProperty("shift_aware")
    private Boolean shiftAware;

    /** Rotation follows one pool-wide order; per-campaign orders are ignored. */
    @JsonProperty("unified_rotation_order")
    private Boolean unifiedRotationOrder;

    @JsonProperty("created_by")
    private String createdBy;

    @JsonProperty("created_at")
    private Timestamp createdAt;

    @JsonProperty("updated_at")
    private Timestamp updatedAt;

    /** Campaigns linked to this pool. May be omitted in list views. */
    private List<PoolAudienceDTO> audiences;

    /** Counselors configured for this pool (one entry per (audience, counselor)). May be omitted in list views. */
    private List<PoolMemberDTO> members;

    /** Shift schedule (only meaningful when assignment_mode = TIME_BASED). May be omitted in list views. */
    private List<PoolShiftDTO> shifts;
}
