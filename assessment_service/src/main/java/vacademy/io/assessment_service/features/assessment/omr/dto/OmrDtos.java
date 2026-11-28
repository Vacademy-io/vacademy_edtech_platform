package vacademy.io.assessment_service.features.assessment.omr.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;
import java.util.Map;

/** Wire shapes for OMR sheets. snake_case like the rest of the API. */
public final class OmrDtos {

    private OmrDtos() {
    }

    // ------------------------------------------------------------ config / sets

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ConfigRequest {
        private Integer setCount;
        private Boolean shuffleQuestions;
        private Boolean shuffleOptions;
    }

    /** OMR state of an assessment: settings, whether the paper can go on a sheet, and the sets. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OverviewDto {
        private Boolean omrMode;
        private OmrConfig config;
        /** True once a scan was uploaded: sets and sheets can no longer change. */
        private Boolean locked;
        private Integer questionCount;
        /** Why this paper cannot be printed as an OMR sheet yet (empty = it can). */
        private List<String> paperIssues;
        private List<SetDto> sets;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SetDto {
        private String id;
        private String setCode;
        private Integer questionCount;
        private String density;
        private Integer rollDigits;
        private Date createdAt;
    }

    /** One set's printed paper, for the dashboard's question paper and answer key export. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PaperDto {
        private String setId;
        private String setCode;
        private Integer rollDigits;
        private List<PaperItemDto> items;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PaperItemDto {
        private Integer no;
        private String questionId;
        private String sectionId;
        /** Option ids in printed order: [0] is A. */
        private List<String> optionIds;
        private String correctLetter;
    }

    // -------------------------------------------------------------- roll check

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RollCheckDto {
        private Integer participantCount;
        /** Digits the roll grid will have (the longest valid number). */
        private Integer rollDigits;
        /** True when every participant has a usable number: the sheets can be downloaded. */
        private Boolean ok;
        private List<RollIssueDto> issues;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RollIssueDto {
        /** MISSING | NOT_NUMERIC | TOO_LONG | DUPLICATE | CONFLICTING */
        private String problem;
        private String userId;
        private String name;
        private String enrollmentNumber;
        private String detail;
    }

    // -------------------------------------------------------------------- scans

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StartScanRequest {
        private String setId;
        private List<UploadedFile> files;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class UploadedFile {
        private String fileId;
        private String fileName;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchDto {
        private String id;
        private String setId;
        private String setCode;
        private String status;
        private Integer totalFiles;
        private Counts counts;
        private String createdByName;
        private String errorMessage;
        private Date createdAt;
        private Date completedAt;
        /** Sheets, only on the single-batch read. */
        private List<SheetDto> sheets;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Counts {
        private int files;
        private int sheets;
        private int reading;
        private int graded;
        private int needsReview;
        private int failed;
        private int skipped;
        /** Graded sheets with at least one flagged question. */
        private int flagged;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SheetDto {
        private String id;
        private String fileName;
        private Integer pageNo;
        private String status;
        private String reasonCode;
        private String reason;
        private String sheetFileId;
        private String markedFileId;
        private String nameCropFileId;
        private String readRoll;
        private String readSet;
        private Boolean rollLowConfidence;
        /** question number -> letter read ("" = blank, "AC" = several bubbles) */
        private Map<String, String> answers;
        /** question number -> MULTI | LOW_CONFIDENCE */
        private Map<String, String> flags;
        /** question number -> the letter the admin set ("" = not attempted) */
        private Map<String, String> fixes;
        private String matchedUserId;
        private String matchedName;
        private String attemptId;
        private Double marks;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ResolveRequest {
        private String userId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FixAnswersRequest {
        /** question number -> letter ("" = not attempted). Only flagged questions are accepted. */
        private Map<String, String> answers;
    }

    /** A participant the admin can assign a parked sheet to. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ParticipantDto {
        private String userId;
        private String name;
        private String enrollmentNumber;
        private Boolean hasOmrSheet;
    }
}
