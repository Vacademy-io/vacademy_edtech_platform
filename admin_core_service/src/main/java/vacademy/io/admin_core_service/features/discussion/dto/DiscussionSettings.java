package vacademy.io.admin_core_service.features.discussion.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * A discussion's rules, as the teacher set them. Stored under "settings" in the
 * slide's document data JSON; the server always enforces the PUBLISHED copy for
 * learners. Every field has a safe default so an older or partial JSON still works.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DiscussionSettings {

    /** Classmates see each other's replies straight away. */
    public static final String VISIBILITY_OPEN = "OPEN";
    /** A learner sees classmates' replies only after posting their own. */
    public static final String VISIBILITY_AFTER_REPLY = "AFTER_REPLY";
    /** Only the teacher sees a learner's reply (a private reflection with teacher feedback). */
    public static final String VISIBILITY_PRIVATE = "PRIVATE";

    /** The supported reactions. Kept supportive on purpose: there is no dislike. */
    public static final List<String> ALL_REACTIONS = List.of("HEART", "HUG", "THANKS", "INSIGHT", "RELATE",
            "STRENGTH");

    private String visibility = VISIBILITY_OPEN;
    private boolean allowComments = true;
    private boolean allowReactions = true;
    private List<String> reactions = new ArrayList<>(ALL_REACTIONS);
    private boolean allowAnonymous = false;
    private boolean requireApproval = false;
    private boolean allowEditOwn = true;
    private boolean locked = false;
    /** Optional supportive note shown above the reply box, e.g. a helpline. Plain text. */
    private String careNote;

    /** Clamp unknown values to the defaults so a bad JSON can never widen access. */
    public DiscussionSettings normalised() {
        if (!VISIBILITY_OPEN.equals(visibility) && !VISIBILITY_AFTER_REPLY.equals(visibility)
                && !VISIBILITY_PRIVATE.equals(visibility)) {
            // Unknown visibility: fall back to the most private choice, not the most open.
            visibility = VISIBILITY_PRIVATE;
        }
        List<String> clean = new ArrayList<>();
        if (reactions != null) {
            for (String r : reactions) {
                if (r != null && ALL_REACTIONS.contains(r) && !clean.contains(r)) {
                    clean.add(r);
                }
            }
        }
        reactions = clean;
        if (careNote != null && careNote.length() > 1000) {
            careNote = careNote.substring(0, 1000);
        }
        return this;
    }

    public boolean othersVisibleBy(boolean viewerHasResponded) {
        return VISIBILITY_OPEN.equals(visibility)
                || (VISIBILITY_AFTER_REPLY.equals(visibility) && viewerHasResponded);
    }
}
