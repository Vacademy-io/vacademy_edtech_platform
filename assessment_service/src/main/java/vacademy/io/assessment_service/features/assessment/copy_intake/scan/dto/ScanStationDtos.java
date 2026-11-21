package vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckConfig;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Wire shapes of the scan station API (contract C3), plus the decision documents
 * kept in decisions_json. snake_case like the rest of the copy-intake API.
 */
public final class ScanStationDtos {

    private ScanStationDtos() {
    }

    // ------------------------------------------------------------------ requests

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LoadRequest {
        private List<Pass> passes;
        /** TWO_PASSES, ONE_FOLDER or DUPLEX. */
        private String intakeMode;
        /** IMAGE_CAPTURE_SUFFIX, NUMERIC_SUFFIX, MODIFIED_TIME or NAME. */
        private String orderSource;
        /** e.g. MTIME_DISAGREES. */
        private List<String> clientWarnings;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Pass {
        private Integer passNo;
        private List<PassFile> files;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PassFile {
        private String fileId;
        private String fileName;
        /** IMAGE or PDF. */
        private String kind;
        private Integer orderIndex;
        private Long lastModified;
        private Integer pageCount;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DecisionRequest {
        /**
         * ACCEPT_COPY, EXCLUDE_COPY, INCLUDE_COPY, MERGE_WITH_PREVIOUS, SPLIT_BEFORE_SHEET,
         * CLEAR_SHEET, KEEP_PAGE, DROP_PAGE, ACCEPT_LOAD_FLAG or SET_FRONTS_DIRECTION.
         */
        private String action;
        private Integer loadNo;
        /** Copy actions name the copy by its first sheet. */
        private Integer sheetNo;
        private String ref;
        private String code;
        /** FORWARD or REVERSED for SET_FRONTS_DIRECTION. */
        private String value;
        /**
         * Optional, for ACCEPT_COPY and ACCEPT_LOAD_FLAG (a load's flag): the
         * fingerprint of the copy or flag the clerk was shown. When it is sent and
         * the plan has moved on, the accept is refused (409 PLAN_CHANGED) instead
         * of accepting a copy nobody saw. Additive to contract C3.
         *
         * <p>For ACCEPT_LOAD_FLAG it also says WHICH flag: a load can carry several
         * flags with one code (two sheets with ORDER_UNCERTAIN, say), and the one
         * whose fingerprint this is gets accepted. Without it the accept works only
         * while the load has a single flag with that code (422 AMBIGUOUS_FLAG
         * otherwise); with it and no such flag any more, 409 PLAN_CHANGED.
         */
        private String expectedFingerprint;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StartRequest {
        private String preferredModel;
        private Boolean notifyEmail;
        /** INSIDE or OUTSIDE; null keeps what the assessment has. */
        private String commentPlacement;
        private CopyCheckConfig.Settings copyCheckConfig;
        /** Default true; false checks the copies without matching students. */
        private Boolean mapStudents;
    }

    // ----------------------------------------------------------------- responses

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ConfigDto {
        private boolean enabled;
        private int maxLoads;
        private int maxPagesPerPass;
        private int maxCopies;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SessionSummaryDto {
        private String id;
        private String status;
        private String verdict;
        private Date createdAt;
        private int loads;
        private int copies;
        private String intakeBatchId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class StartResponse {
        private SessionDto session;
        private CopyIntakeDtos.BatchDto batch;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SessionDto {
        private String id;
        private String assessmentId;
        /** OPEN, BUILDING, BUILT, STARTING, STARTED or FAILED. */
        private String status;
        /** EMPTY, ANALYSING, READY, NEEDS_REVIEW or BLOCKED. */
        private String verdict;
        private List<VerdictReason> verdictReasons;
        /** FORWARD or REVERSED. */
        private String frontsDirection;
        /** CLERK, LOAD1, AGGREGATE or DEFAULT. */
        private String frontsDirectionSource;
        private List<SessionFlag> sessionFlags;
        private List<LoadDto> loads;
        private List<CopyDto> copies;
        private List<BuiltDto> built;
        private String intakeBatchId;
        private String errorMessage;
        private Totals totals;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class VerdictReason {
        private String code;
        private String severity;
        private Integer loadNo;
        private String copyKey;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SessionFlag {
        private String code;
        private String severity;
        private String detail;
        private boolean accepted;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LoadDto {
        private int loadNo;
        /** PENDING, ANALYSING, DONE or FAILED. */
        private String status;
        private int attempts;
        private String errorMessage;
        private List<PassDto> passes;
        private ScanAnalysis.Layout layout;
        private List<PageDto> pages;
        private List<ScanAnalysis.Sheet> sheets;
        private List<LoadFlag> flags;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PassDto {
        private int passNo;
        private int pageCount;
        private List<PassFileDto> files;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PassFileDto {
        private String fileId;
        private String fileName;
        private String kind;
    }

    /** One page as ai_service read it, plus the class the plan uses after the clerk's overrides. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PageDto {
        private String ref;
        private Integer passNo;
        private String fileId;
        private Integer pageIndex;
        private String kind;
        private Integer dpi;
        private String dpiSource;
        private Integer widthPx;
        private Integer heightPx;
        @JsonProperty("ink_per_10k")
        private Double inkPer10k;
        private String blankClass;
        private String error;
        /** BLANK, UNSURE or WRITTEN. */
        private String blankEffective;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LoadFlag {
        private String code;
        private String severity;
        private Integer sheetNo;
        private String detail;
        private boolean accepted;
        /** What ACCEPT_LOAD_FLAG stores; send it back as expected_fingerprint. Additive to C3. */
        private String fingerprint;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CopyDto {
        private String copyKey;
        private int loadNo;
        private int firstSheetNo;
        private List<SheetRefDto> sheets;
        private List<CopyPageDto> pages;
        private List<LeftOutPageDto> leftOut;
        private int pageCount;
        private String nameText;
        private List<CopyFlag> flags;
        /** NONE, ACCEPTED or EXCLUDED. */
        private String decision;
        private boolean needsReview;
        /** What ACCEPT_COPY stores; send it back as expected_fingerprint. Additive to C3. */
        private String fingerprint;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SheetRefDto {
        private int loadNo;
        private int sheetNo;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CopyPageDto {
        private int loadNo;
        private String ref;
        private String fileId;
        private Integer pageIndex;
        private String kind;
        private int rotation;
        /** FRONT or BACK. */
        private String side;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LeftOutPageDto {
        private int loadNo;
        private String ref;
        private String fileId;
        private Integer pageIndex;
        private String kind;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class CopyFlag {
        private String code;
        private String severity;
        private Integer sheetNo;
        private String detail;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuiltDto {
        private String copyKey;
        private String fileId;
        private int pageCount;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Totals {
        private int loads;
        private int sheets;
        private int pages;
        private int copies;
        private int blankLeftOut;
        private int excluded;
    }

    // ----------------------------------------------------------- stored built doc

    /** One entry of ai_scan_session.built_json: a copy's PDF and where each of its pages came from. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuiltEntry {
        private String copyKey;
        private String fileId;
        private int pageCount;
        /** The name the copy goes to the intake with: "Load 3 copy 5". */
        private String fileName;
        /** The pass pages in PDF order, kept for printing checked copies back later. */
        private List<PageMapEntry> pageMap;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PageMapEntry {
        private int loadNo;
        private String ref;
        private String fileId;
        private Integer pageIndex;
        private int rotation;
        private String side;
    }

    // ------------------------------------------------------ stored decision docs

    /** ai_scan_session.decisions_json. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SessionDecisions {
        /** FORWARD, REVERSED, or null to let the planner decide. */
        private String frontsDirection;
    }

    /** ai_scan_load.decisions_json. Keys are strings because they come back from JSON. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LoadDecisions {
        /** sheet_no -> true (a copy starts here) or false (joins the copy before). */
        private Map<String, Boolean> startOverrides = new LinkedHashMap<>();
        /** First sheet_no of every copy left out of the build. */
        private List<Integer> excluded = new ArrayList<>();
        /** first sheet_no -> fingerprint of the copy the clerk accepted. */
        private Map<String, String> accepted = new LinkedHashMap<>();
        /** page ref -> KEEP or DROP. */
        private Map<String, String> pageOverrides = new LinkedHashMap<>();
        /**
         * The load flags the clerk accepted: fingerprint -> flag code, one entry per
         * flag, so two REVIEW flags with the same code are accepted separately.
         * (An entry keyed by code, code -> fingerprint, is the first format and is
         * still read as an accept of that one fingerprint.)
         */
        private Map<String, String> acceptedFlags = new LinkedHashMap<>();

        /** Never null maps, whatever the stored JSON held. */
        public LoadDecisions normalized() {
            if (startOverrides == null) startOverrides = new LinkedHashMap<>();
            if (excluded == null) excluded = new ArrayList<>();
            if (accepted == null) accepted = new LinkedHashMap<>();
            if (pageOverrides == null) pageOverrides = new LinkedHashMap<>();
            if (acceptedFlags == null) acceptedFlags = new LinkedHashMap<>();
            return this;
        }
    }
}
