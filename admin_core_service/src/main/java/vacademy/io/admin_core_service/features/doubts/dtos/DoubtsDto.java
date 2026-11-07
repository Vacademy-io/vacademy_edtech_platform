package vacademy.io.admin_core_service.features.doubts.dtos;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class DoubtsDto {
    private String id;
    private String userId;
    private String source;
    private String sourceId;
    /** Configurable query type key (DOUBT, TECHNICAL, PAYMENT, ...). Defaults to DOUBT when absent. */
    private String type;
    /** Owning institute. Required for GENERAL queries (no batch); optional for SLIDE doubts. */
    private String instituteId;
    /** Guest contact (logged-out queries only — user_id is null for these). */
    private String guestName;
    private String guestEmail;
    private String subjectId;
    private String batchId;
    private String chapterId;
    private String moduleId;
    private String sourceName;
    private Date raisedTime;
    private Date resolvedTime;
    private String contentPosition;
    private String contentType;
    private String htmlText;
    private String status;
    /**
     * Response: the doubt's effective workflow status key (never null for top-level doubts).
     * Request (update): set to move the doubt to that status; the coarse {@link #status} is derived
     * from the status's kind. Echoing the current value back is a no-op.
     */
    private String workflowStatus;
    /**
     * Request only: an optional note recorded in the activity trail — attached to the status change
     * when {@link #workflowStatus} moves, otherwise logged as a standalone remark on the current
     * status. Visible to admins/teachers only.
     */
    private String remark;
    /** Response only: what the learner should see for this doubt's status. */
    private DoubtStatusDto learnerStatus;
    private String parentId;
    private Integer parentLevel;
    private List<String> doubtAssigneeRequestUserIds = new ArrayList<>();
    private List<DoubtAssigneeDto> allDoubtAssignee = new ArrayList<>();
    private List<String> deleteAssigneeRequest = new ArrayList<>();
    /**
     * Request: user ids that the admin has explicitly removed from the default (FSPSSM-implicit)
     * assignee list for this doubt. Backend persists these as DoubtAssignee rows with status
     * {@code DELETED}, and surfaces them back in this same field on the response so the UI can
     * filter its default-pill list.
     */
    private List<String> excludedAssigneeUserIds = new ArrayList<>();
    private List<DoubtsDto> replies = new ArrayList<>();
}
