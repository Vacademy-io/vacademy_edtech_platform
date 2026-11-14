package vacademy.io.admin_core_service.features.learner_notes.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/** One of a learner's own marks on a lesson. Only its owner ever reads it. */
@Entity
@Table(name = "learner_note")
@Getter
@Setter
@NoArgsConstructor
public class LearnerNote {

    @Id
    @Column(length = 36, nullable = false)
    private String id;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "slide_id", nullable = false)
    private String slideId;

    @Column(name = "slide_type", length = 50)
    private String slideType;

    @Column(name = "slide_title", length = 500)
    private String slideTitle;

    @Column(name = "chapter_name", length = 500)
    private String chapterName;

    @Column(name = "course_name", length = 500)
    private String courseName;

    @Column(name = "course_id")
    private String courseId;

    @Column(name = "level_id")
    private String levelId;

    @Column(name = "subject_id")
    private String subjectId;

    @Column(name = "module_id")
    private String moduleId;

    @Column(name = "chapter_id")
    private String chapterId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    /** HIGHLIGHT | AREA | BOOKMARK | NOTE. */
    @Column(nullable = false, length = 20)
    private String kind;

    /** yellow | green | blue | pink. */
    @Column(length = 20)
    private String color;

    /** Zero-based page of a document, when the mark has one. */
    @Column(name = "page_index")
    private Integer pageIndex;

    /** Position in a video, when the mark has one. */
    @Column(name = "time_ms")
    private Long timeMs;

    /** Where the mark sits on the page. Written and read by the app; opaque here. */
    @Column(name = "anchor_json", columnDefinition = "TEXT")
    private String anchorJson;

    @Column(name = "quote_text", columnDefinition = "TEXT")
    private String quoteText;

    @Column(name = "note_text", columnDefinition = "TEXT")
    private String noteText;

    @Column(name = "review_stage", nullable = false)
    private int reviewStage;

    @Column(name = "next_review_at")
    private Instant nextReviewAt;

    @Column(name = "last_reviewed_at")
    private Instant lastReviewedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
