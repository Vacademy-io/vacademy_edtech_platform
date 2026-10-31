package vacademy.io.assessment_service.features.assessment_folder.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** A named group of assessments (e.g. "English") shown to admins and learners. */
@Entity
@Table(name = "assessment_folder")
@Data
@Builder
// @Builder drops the no-arg constructor JPA needs to load the entity.
@NoArgsConstructor
@AllArgsConstructor
public class AssessmentFolder {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "parent_id")
    private String parentId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "image_url")
    private String imageUrl;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    /** ACTIVE or HIDDEN. Hidden folders are not listed to learners. */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false)
    private Date updatedAt;
}
