package vacademy.io.assessment_service.features.question_library.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** One topic in an institute's question library tree (a subject, chapter, topic...). */
@Entity
@Table(name = "question_library_node")
@Data
@Builder
// @Builder drops the no-arg constructor JPA needs to load the entity.
@NoArgsConstructor
@AllArgsConstructor
public class QuestionLibraryNode {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** Null for a top-level node. */
    @Column(name = "parent_id")
    private String parentId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    /** ACTIVE or DELETED. */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false)
    private Date updatedAt;
}
