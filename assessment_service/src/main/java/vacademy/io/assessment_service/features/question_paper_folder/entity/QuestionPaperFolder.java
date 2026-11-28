package vacademy.io.assessment_service.features.question_paper_folder.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** A named group of question papers (e.g. "Class 10 Maths") on the Question Banks and Papers page. */
@Entity
@Table(name = "question_paper_folder")
@Data
@Builder
// @Builder drops the no-arg constructor JPA needs to load the entity.
@NoArgsConstructor
@AllArgsConstructor
public class QuestionPaperFolder {

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

    /** Always ACTIVE today; kept so folders can be hidden later without a migration. */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false)
    private Date updatedAt;
}
