package vacademy.io.admin_core_service.features.suborg.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Per-learner outcome of a bulk add or move into a sub-organization, plus the totals. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SubOrgBulkMembersResponseDTO {

    /** A new enrollment was created in the sub-org. */
    public static final String ADDED = "ADDED";
    /** An existing ACTIVE enrollment now belongs to the sub-org. */
    public static final String MOVED = "MOVED";
    /** Already a member of this sub-org in that batch; nothing changed. */
    public static final String ALREADY_MEMBER = "ALREADY_MEMBER";
    public static final String FAILED = "FAILED";

    private int total;
    private int added;
    private int moved;
    private int alreadyMember;
    private int failed;
    private List<Item> results;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Item {
        private String userId;
        private String name;
        private String email;
        private String packageSessionId;
        private String status;
        private String message;
    }
}
