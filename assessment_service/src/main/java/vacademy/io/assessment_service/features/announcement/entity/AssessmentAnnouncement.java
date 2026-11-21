package vacademy.io.assessment_service.features.announcement.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;

import java.util.Date;

@Entity
@Table(name = "assessment_announcement")
@Data
@Builder
// @Builder suppresses the no-arg constructor @Data would otherwise supply, and JPA
// cannot materialise an entity without one. This entity is read on the learner
// autosave path, so a single announcement row made every /status/update fail with
// "No default constructor" — verified against production 2026-08-28.
@NoArgsConstructor
@AllArgsConstructor
public class AssessmentAnnouncement {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne
    @JoinColumn(name = "assessment_id")
    @JsonIgnore
    private Assessment assessment;

    @ManyToOne(cascade = CascadeType.ALL)
    @JoinColumn(name = "rich_text_id")
    @JsonIgnore
    private AssessmentRichTextData assessmentRichTextData;

    @ManyToOne
    @JoinColumn(name = "attempt_id")
    @JsonIgnore
    private StudentAttempt studentAttempt;

    @Column(name = "sent_time")
    private Date sentTime;

    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "type")
    private String type;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
