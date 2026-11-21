package vacademy.io.admin_core_service.features.counselor_pool.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class PoolAudienceDTO {

    private String id;

    @JsonProperty("pool_id")
    private String poolId;

    @JsonProperty("audience_id")
    private String audienceId;

    @JsonProperty("last_assigned_counselor_id")
    private String lastAssignedCounselorId;

    @JsonProperty("last_assigned_at")
    private Timestamp lastAssignedAt;

    @JsonProperty("added_at")
    private Timestamp addedAt;

    /** See {@code CounselorPoolAudience#assignOnIntake}. */
    @JsonProperty("assign_on_intake")
    private Boolean assignOnIntake;
}
