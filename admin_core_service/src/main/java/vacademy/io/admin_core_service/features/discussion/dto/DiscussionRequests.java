package vacademy.io.admin_core_service.features.discussion.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/** Request bodies for the discussion endpoints. */
public final class DiscussionRequests {

    private DiscussionRequests() {
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CreatePost {
        private String slideId;
        /** Learner: the batch they are viewing in. Staff: the batch to post to, or null for every batch. */
        private String packageSessionId;
        private String chapterId;
        private String moduleId;
        private String subjectId;
        /** Null for a response to the question; a response id for a comment. */
        private String parentId;
        private String content;
        /** Learners only, and only when the discussion allows it. */
        private boolean anonymous;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class EditPost {
        private String content;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class React {
        private String reaction;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Report {
        private String reason;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Moderate {
        /** APPROVE, HIDE, UNHIDE, PIN, UNPIN, DELETE, CLEAR_REPORTS */
        private String action;
    }
}
