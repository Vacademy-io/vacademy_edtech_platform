package vacademy.io.admin_core_service.features.discussion.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

/** One post as one viewer may see it. Fields a learner must not see are left null. */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DiscussionPostView {
    private String id;
    private String parentId;
    private String content;
    private Timestamp createdAt;
    private Timestamp editedAt;

    /** Display name. "Anonymous classmate" for an anonymous post seen by another learner. */
    private String authorName;
    /** Null when the post is anonymous and the viewer is another learner. */
    private String authorUserId;
    /** LEARNER or STAFF. */
    private String authorRole;
    private boolean anonymous;
    private boolean mine;

    /** PUBLISHED, PENDING or HIDDEN. Learners only see a non-published status on their own posts. */
    private String status;
    private boolean pinned;

    private List<ReactionCount> reactions = new ArrayList<>();

    /** Staff only. */
    private Integer reportCount;
    /** Staff only: the reasons learners gave when reporting. */
    private List<String> reportReasons;
    /** Staff only: the batch this post belongs to (null = all batches). */
    private String packageSessionId;
    /** Learner only: the viewer has already reported this post. */
    private Boolean reportedByMe;

    /** Comments, oldest first. Only set on responses (parent_id null). */
    private List<DiscussionPostView> comments;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReactionCount {
        private String reaction;
        private int count;
        private boolean reactedByMe;

        public ReactionCount(String reaction, int count, boolean reactedByMe) {
            this.reaction = reaction;
            this.count = count;
            this.reactedByMe = reactedByMe;
        }
    }
}
