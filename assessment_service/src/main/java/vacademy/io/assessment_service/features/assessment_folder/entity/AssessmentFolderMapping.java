package vacademy.io.assessment_service.features.assessment_folder.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** Puts one assessment in one folder (assessment_id is unique). */
@Entity
@Table(name = "assessment_folder_mapping")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssessmentFolderMapping {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "folder_id", nullable = false)
    private String folderId;

    @Column(name = "assessment_id", nullable = false)
    private String assessmentId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
