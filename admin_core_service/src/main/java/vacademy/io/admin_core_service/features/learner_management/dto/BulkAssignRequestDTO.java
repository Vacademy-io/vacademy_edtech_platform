package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BulkAssignRequestDTO {

    private String instituteId;

    /** Explicit user IDs to assign */
    private List<String> userIds;

    /** New users to create inline and then assign */
    private List<NewUserDTO> newUsers;

    /** Filter-based user selection (merged with userIds) */
    private UserFilterDTO userFilter;

    /** Per-package-session enrollment config */
    private List<AssignmentItemDTO> assignments;

    /** Options: duplicate handling, dry run, notifications */
    private BulkAssignOptionsDTO options;

    /**
     * Enroll the assignments together as one admission package (one schedule, one discount,
     * one admission receipt). Null = each course on its own, as before.
     */
    private AdmissionPackageDTO admissionPackage;
}
