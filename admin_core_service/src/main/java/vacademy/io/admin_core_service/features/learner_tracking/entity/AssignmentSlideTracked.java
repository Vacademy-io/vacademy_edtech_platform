package vacademy.io.admin_core_service.features.learner_tracking.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.learner_tracking.dto.AssignmentSlideActivityLogDTO;

import java.sql.Timestamp;

@Entity
@AllArgsConstructor
@NoArgsConstructor
public class AssignmentSlideTracked {

    @Id
    private String id;

    private String commaSeparatedFileIds;

    private Double marks;

    private String feedback;

    @Column(name = "checked_file_id")
    private String checkedFileId;

    @Column(name = "late_submission", nullable = false)
    private Boolean lateSubmission;

    @ManyToOne
    @JoinColumn(name = "activity_id", nullable = false)
    private ActivityLog activityLog;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Timestamp updatedAt;

    public AssignmentSlideTracked(AssignmentSlideActivityLogDTO assignmentSlideActivityLogDTO, ActivityLog activityLog) {
        this.id = assignmentSlideActivityLogDTO.getId();
        this.commaSeparatedFileIds = assignmentSlideActivityLogDTO.getCommaSeparatedFileIds();
        this.marks = assignmentSlideActivityLogDTO.getMarks();
        this.lateSubmission = Boolean.TRUE.equals(assignmentSlideActivityLogDTO.getLateSubmission());
        this.activityLog = activityLog;
    }

    public AssignmentSlideActivityLogDTO toAssignmentSlideActivityLog() {
        AssignmentSlideActivityLogDTO activityLogDTO = new AssignmentSlideActivityLogDTO();
        activityLogDTO.setId(id);
        activityLogDTO.setCommaSeparatedFileIds(commaSeparatedFileIds);
        activityLogDTO.setDateSubmitted(activityLog.getCreatedAt());
        activityLogDTO.setMarks(marks);
        activityLogDTO.setFeedback(feedback);
        activityLogDTO.setCheckedFileId(checkedFileId);
        activityLogDTO.setLateSubmission(lateSubmission);
        return activityLogDTO;
    }

    public String getId() { return id; }
    public ActivityLog getActivityLog() { return activityLog; }
    public Timestamp getCreatedAt() { return createdAt; }
    public void setMarks(Double marks) { this.marks = marks; }
    public void setFeedback(String feedback) { this.feedback = feedback; }
    public void setCheckedFileId(String checkedFileId) { this.checkedFileId = checkedFileId; }

}
