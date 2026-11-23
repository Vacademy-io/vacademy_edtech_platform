package vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Wire shapes between assessment_service and ai_service's scan routes:
 * POST /copy-check/scan/analyse-load (contract C1) and POST /copy-check/scan/build
 * (contract C2). snake_case; unknown fields are ignored so ai_service can add some.
 */
public final class ScanAnalysis {

    private ScanAnalysis() {
    }

    public static final String STATUS_OK = "OK";
    public static final String STATUS_REVIEW = "REVIEW";
    public static final String STATUS_BLOCKED = "BLOCKED";

    public static final String BLANK = "BLANK";
    public static final String UNSURE = "UNSURE";
    public static final String WRITTEN = "WRITTEN";

    public static final String LABEL_PRINTED_FIELD = "PRINTED_FIELD";

    // ---------------------------------------------------------------- C1 request

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AnalyseRequest {
        private String instituteId;
        private String sessionId;
        private Integer loadNo;
        private String preferredModel;
        private List<PassRef> passes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class PassRef {
        private Integer passNo;
        private List<FileRef> files;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FileRef {
        private String fileId;
        private String url;
        /** IMAGE or PDF. */
        private String kind;
        private String name;
    }

    // --------------------------------------------------------------- C1 response

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Result {
        private String analyserVersion;
        private Integer loadNo;
        /** OK, REVIEW or BLOCKED. */
        private String status;
        /** Null on COUNT_MISMATCH. */
        private Layout layout;
        private Evidence evidence;
        private List<Page> pages;
        private List<Sheet> sheets;
        private List<Flag> flags;
        private Map<String, Object> usage;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Layout {
        private Integer frontsPass;
        /** 0 or 180. */
        private Integer frontsRotation;
        /** SAME or REVERSED. */
        private String backsOrder;
        private Integer backsRotation;
        private Double orderMargin;
        private Shift shift;
        /** Too many fronts looked blank: the blank rule is not trusted and no page is left out. */
        private Boolean blankRuleSuspect;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Shift {
        private Integer fromSheet;
        private Integer offset;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Evidence {
        /** The first front in fronts scan order carries a printed name label. */
        private Boolean firstFrontLabel;
        /** The last front in fronts scan order carries a printed name label. */
        private Boolean lastFrontLabel;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Page {
        /** "p{pass_no}.{index within pass}". */
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
        /** BLANK, UNSURE or WRITTEN. */
        private String blankClass;
        private String error;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Sheet {
        /** Index in the FRONTS pass scan order. */
        private Integer sheetNo;
        private String front;
        private String back;
        private Double pairScore;
        private Double pairRunnerUp;
        private Boolean pairIsRowMax;
        /** PRINTED_FIELD, QUESTION_TEXT or NONE. */
        private String labelKind;
        private Boolean labelPresent;
        private String nameText;
        private Boolean nameReadable;
        private String rollText;
        private Double labelTemplateSim;
        private Boolean backLabelLike;
        private String frontBlankClass;
        private String backBlankClass;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Flag {
        private String code;
        /** BLOCK, REVIEW or INFO. */
        private String severity;
        private Integer sheetNo;
        private String detail;
    }

    // ---------------------------------------------------------------- C2 build

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuildRequest {
        private String instituteId;
        private String sessionId;
        private String sourceId;
        private List<BuildCopy> copies;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuildCopy {
        private String copyKey;
        private String fileName;
        private List<BuildPage> pages;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuildPage {
        private String url;
        private String kind;
        private Integer pageIndex;
        /** 0, 90, 180 or 270. */
        private Integer rotation;
        private Integer dpi;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuildResult {
        private List<BuiltCopy> copies;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BuiltCopy {
        private String copyKey;
        private String fileId;
        private Integer pageCount;
        private Long bytes;
        /** Null when the copy was made; otherwise why not (COPY_TOO_LARGE, ...). */
        private String error;
    }
}
