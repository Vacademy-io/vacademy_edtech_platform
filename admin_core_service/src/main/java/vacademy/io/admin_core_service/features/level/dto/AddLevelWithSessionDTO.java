package vacademy.io.admin_core_service.features.level.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.admin_core_service.features.course.dto.AddFacultyToCourseDTO;
import vacademy.io.admin_core_service.features.course.dto.SubgroupDTO;
import vacademy.io.admin_core_service.features.group.dto.AddGroupDTO;

import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
public class AddLevelWithSessionDTO {
    private String id;
    private Boolean newLevel;
    private String levelName;
    private Integer durationInDays;
    private String thumbnailFileId;
    private String packageId;
    private AddGroupDTO group;
    private String status;
    private String packageSessionStatus;
    private String packageSessionId;
    private boolean newPackageSession;
    private List<AddFacultyToCourseDTO> addFacultyToCourse;
    /** Optional: whether this batch is a parent. Backward compatible: not sent = false. */
    private Boolean isParent;
    /** Optional: parent batch id if this is a child batch. */
    private String parentId;
    /**
     * Optional: name for the batch created here. Not sent or blank = no name, and
     * the batch is shown as level + course name, as before.
     */
    private String batchName;
    /**
     * Optional list of subgroups for this level within the session.
     * When present, child package sessions will be created under the
     * parent batch corresponding to this (session, level) combination.
     */
    private List<SubgroupDTO> subgroups;
}
