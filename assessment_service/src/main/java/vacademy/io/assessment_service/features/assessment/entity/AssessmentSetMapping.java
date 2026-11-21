package vacademy.io.assessment_service.features.assessment.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.AssessmentSetDto;

import java.util.Date;

@Entity
@Table(name = "assessment_set_mapping")
@Data
@Builder
// @Builder suppresses the no-arg constructor @Data would otherwise supply, and
// JPA cannot materialise an entity without one: reading any existing row threw
// "No default constructor", which failed every PDF answer-sheet submission on an
// assessment that has sets. Both constructors are required — keep them.
@NoArgsConstructor
@AllArgsConstructor
public class AssessmentSetMapping {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @ManyToOne
    @JoinColumn(name = "assessment_id")
    private Assessment assessment;

    @Column(name = "set_name")
    private String setName;

    @Column(name = "status")
    private String status;

    @Column(name = "json")
    private String json;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;


    public AssessmentSetDto getSetDto() {
        return AssessmentSetDto.builder()
                .id(this.id)
                .assessmentId(this.assessment != null ? this.assessment.getId() : null)
                .setName(this.getSetName())
                .json(this.getJson())
                .status(this.getStatus()).build();
    }
}
