package vacademy.io.assessment_service.features.question_paper_folder.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/** Puts one question paper in one folder ((institute_id, question_paper_id) is unique). */
@Entity
@Table(name = "question_paper_folder_mapping")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QuestionPaperFolderMapping {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "folder_id", nullable = false)
    private String folderId;

    @Column(name = "question_paper_id", nullable = false)
    private String questionPaperId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "display_order", nullable = false)
    private Integer displayOrder;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;
}
