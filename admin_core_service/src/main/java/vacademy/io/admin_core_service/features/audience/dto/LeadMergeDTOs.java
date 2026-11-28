package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.sql.Timestamp;
import java.util.List;

/** Requests and answers of the person-merge endpoints ({@code /v1/audience/lead-merge}). */
public final class LeadMergeDTOs {

    private LeadMergeDTOs() {
    }

    /** Merge (or preview merging) the duplicate person into the person to keep. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MergeRequest(String keepUserId, String duplicateUserId) {
    }

    /** Undo the merge of this person. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UnmergeRequest(String duplicateUserId) {
    }

    /** Why a merge cannot be done: a stable code and the reason in plain words. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Refusal(String code, String message) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Enquiry(String responseId, String listId, String listName, String name, String phone, String email,
                          String sourceType, String statusKey, String audienceStatus, Timestamp submittedAt) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Person(String userId, String profileId, String name, String conversionStatus, String leadTier,
                         String counsellorName, Timestamp createdAt, String mergedIntoUserId, Timestamp mergedAt,
                         List<Enquiry> enquiries) {
    }

    /**
     * Both people side by side and what a merge would do. {@code canMerge} is false when
     * {@code refusals} is not empty; nothing changes on a preview.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Preview(Person keep, Person duplicate, boolean canMerge, List<Refusal> refusals,
                          List<String> effects) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MergeResult(String keepUserId, String duplicateUserId, int enquiriesMoved, Timestamp mergedAt) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record UnmergeResult(String keepUserId, String duplicateUserId, int enquiriesMovedBack) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MergedPerson(String userId, String name, Timestamp mergedAt, String mergedByUserId,
                               int enquiries) {
    }

    /** Merge state of one person: whom they were merged into, and who was merged into them. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MergeState(String userId, String mergedIntoUserId, Timestamp mergedAt,
                             List<MergedPerson> mergedPeople) {
    }

    /**
     * A lead like the one being added: a live, open lead with the same phone or email, or a live
     * lead with a similar name. reason says which ("same phone", "same email", "same phone and
     * email", "same name" or "similar name"); contact is masked.
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record NameMatch(String responseId, String userId, String name, String phone, String email,
                            String listName, String statusKey, Timestamp submittedAt, boolean exactName,
                            String reason) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record SimilarNames(List<NameMatch> matches, int notShown, int days) {
    }
}
