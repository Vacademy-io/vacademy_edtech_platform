package vacademy.io.admin_core_service.features.slide_activity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.sql.Timestamp;

/** A learner's vote on a Poll slide or result on a Game slide (V729). */
@Entity
@Table(name = "slide_activity_response")
@Getter
@Setter
@NoArgsConstructor
public class SlideActivityResponse {

    public static final String POLL = "POLL";
    public static final String GAME = "GAME";

    @Id
    private String id;

    @Column(name = "slide_id", nullable = false)
    private String slideId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "option_id")
    private String optionId;

    @Column(name = "score")
    private Double score;

    @Column(name = "max_score")
    private Double maxScore;

    @Column(name = "best_score")
    private Double bestScore;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
