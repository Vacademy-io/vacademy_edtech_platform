package vacademy.io.admin_core_service.features.discussion.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** Everything a discussion screen needs in one response. */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DiscussionThreadView {
    private String slideId;
    /** The batch this view is for (learner), or the filter applied (staff, null = all). */
    private String packageSessionId;
    private DiscussionSettings settings;
    private Viewer viewer;
    private Stats stats;
    /** Responses, pinned first then newest first, each with its comments. */
    private List<DiscussionPostView> posts = new ArrayList<>();
    /** Staff only: batches whose courses hold this slide. */
    private List<Batch> batches;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Viewer {
        private String userId;
        private boolean staff;
        private boolean hasResponded;
        /** False when replies are hidden from this viewer (AFTER_REPLY before replying, or PRIVATE). */
        private boolean canSeeOthers;
        private boolean canRespond;
        /** Whether the viewer may comment on classmates' responses (own response is always allowed unless locked). */
        private boolean canCommentOnOthers;
    }

    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Stats {
        /** Published learner responses in scope. */
        private int responses;
        /** Distinct learners with a published response. */
        private int participants;
        /** Staff only. */
        private Integer pending;
        private Integer flagged;
        private Integer hidden;
    }

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Batch {
        private String packageSessionId;
        private String name;
    }
}
