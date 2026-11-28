package vacademy.io.admin_core_service.features.suborg.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Moves learners who are already ACTIVE in a batch into a sub-organization (admin students
 * list → select → "Move to sub-org"). Each member is one enrollment: the learner plus the
 * batch the row was selected in.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SubOrgMoveMembersRequestDTO {

    private String instituteId;
    private String subOrgId;
    private List<Member> members;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Member {
        private String userId;
        private String packageSessionId;
    }
}
