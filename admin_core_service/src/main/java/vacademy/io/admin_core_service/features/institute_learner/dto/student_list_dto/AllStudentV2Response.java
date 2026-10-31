package vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentV2DTO;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AllStudentV2Response {
    private List<StudentV2DTO> content;
    private int pageNo;
    private int pageSize;
    private long totalElements;
    private int totalPages;
    private boolean last;

    /**
     * Whether this institute runs trials at all, i.e. some live invite sets
     * AUTOPAY_SETTING.TRIAL_DAYS > 0. The Trial/Paid badge and its filter hide themselves
     * when false, so an institute with no trial memberships is never shown a distinction
     * that means nothing there. Derived from the invites, not a flag to remember to set.
     */
    private Boolean membershipTypesAvailable;
}
