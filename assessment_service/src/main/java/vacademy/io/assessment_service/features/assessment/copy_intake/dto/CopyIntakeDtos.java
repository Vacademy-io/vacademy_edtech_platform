package vacademy.io.assessment_service.features.assessment.copy_intake.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckConfig;

import java.util.Date;
import java.util.List;

/** Wire shapes for the bulk copy intake. snake_case like the rest of the API. */
public final class CopyIntakeDtos {

    private CopyIntakeDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StartRequest {
        private List<UploadedFile> files;
        private String preferredModel;
        /** Email the person who started the batch when it finishes (default true). */
        private Boolean notifyEmail;
        /** Checked-copy template: INSIDE (remarks on the copy) or OUTSIDE (panel beside it). */
        private String commentPlacement;
        /** How the AI checks this paper (subject, instructions, language feedback); null keeps what is set. */
        private CopyCheckConfig.Settings copyCheckConfig;
    }

    /**
     * Check copies the learners submitted themselves. Either the checked rows of
     * the submissions table ({@code attempt_ids}) or, when that is empty, every
     * submitted copy on the assessment.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubmittedRequest {
        private List<String> attemptIds;
        /** Also queue copies the AI has already checked (a re-check). Default false. */
        private Boolean includeChecked;
        private String preferredModel;
        private Boolean notifyEmail;
        /** Checked-copy template: INSIDE (remarks on the copy) or OUTSIDE (panel beside it). */
        private String commentPlacement;
        /** How the AI checks this paper (subject, instructions, language feedback); null keeps what is set. */
        private CopyCheckConfig.Settings copyCheckConfig;
    }

    /** One checked copy of a batch, for "Download checked copies". */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CheckedCopyDto {
        private String itemId;
        private String fileName;
        private String studentName;
        private String roll;
        private String evaluatedFileId;
    }

    /** What a submitted-copies check would do, before any credit is spent. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubmittedPreviewDto {
        /** Attempts looked at (the selection, or every attempt on the assessment). */
        private int considered;
        /** Attempts with an uploaded answer sheet. */
        private int withCopy;
        /** ... of which the AI has already checked (queued only with include_checked). */
        private int alreadyChecked;
        /** ... of which a check is running right now (never queued twice). */
        private int inProgress;
        /** Attempts with no uploaded sheet (an online attempt, or not submitted yet). */
        private int noCopy;
        /** Copies that would be queued. */
        private int toCheck;
        private List<String> attemptIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UploadedFile {
        private String fileId;
        private String fileName;
        private Integer pageCount;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ResolveRequest {
        /** The student the admin picked: a registration of this assessment, or a batch learner's user id. */
        private String registrationId;
        private String userId;
        private String fullName;
        private String email;
        private String username;
        private String batchId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CandidateDto {
        private String userId;
        private String registrationId;
        private String name;
        private String rollNumber;
        private String email;
        private String batchId;
        private Double score;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ItemDto {
        private String id;
        private String fileId;
        private String fileName;
        private Integer pageCount;
        private String status;
        private String extractedName;
        private String extractedRoll;
        private String extractedClass;
        private Double extractConfidence;
        private Double matchScore;
        private String matchedUserId;
        private String matchedName;
        private String registrationId;
        private String attemptId;
        private String processId;
        private String errorMessage;
        private List<CandidateDto> candidates;
        private Date updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchDto {
        private String id;
        private String assessmentId;
        private String status;
        /** UPLOAD (admin-uploaded PDFs) or SUBMITTED (the learners' own uploads). */
        private String source;
        private int totalItems;
        /** Copies whose header has been read (everything past PENDING / IDENTIFYING). */
        private int identified;
        /** Placed on a student and not yet queued (a moment's state). */
        private int matched;
        private int ambiguous;
        private int unmatched;
        /** Waiting for a free slot with the AI service. */
        private int queued;
        /** With the AI service right now. */
        private int evaluating;
        private int evaluated;
        private int failed;
        private int skipped;
        /** Still moving on its own; the batch cannot settle while this is > 0. */
        private int inProgress;
        private String createdBy;
        private String createdByName;
        private String emailStatus;
        private Date createdAt;
        private Date completedAt;
        private String errorMessage;
        private List<ItemDto> items;
    }
}
