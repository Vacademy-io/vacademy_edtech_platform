package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

/** What the staff redirect endpoints answer (snake_case JSON). */
public final class SiteRedirectDtos {

    private SiteRedirectDtos() {
    }

    /** One stored row. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RedirectRow {
        private String id;
        private String fromPath;
        /** Null for a 410 row. */
        private String toPath;
        private int statusCode;
        private String matchType;
        private Date createdAt;
        private Date updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RedirectPage {
        private List<RedirectRow> redirects;
        private int page;
        private int pageSize;
        private long total;
    }

    /** A problem of one row; row 0 is the whole file. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RedirectIssue {
        private int row;
        /** "error" (blocks the commit) or "warning". */
        private String severity;
        private String code;
        private String message;
    }

    /** A row a commit wrote, with what it held before (null for a new row): the caller's undo file. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class WrittenRow {
        private int row;
        private String id;
        private String matchType;
        private String fromPath;
        private String toPath;
        private int statusCode;
        private String oldToPath;
        private Integer oldStatusCode;
    }

    /** The answer of mode=validate (nothing written) and of mode=commit. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RedirectImportResult {
        /** "validate" or "commit". */
        private String mode;
        private boolean committed;
        private String fileName;
        private String fileSha256;
        /** Data rows read (blank rows not counted). */
        private int rowsTotal;
        private int rowsSkipped;
        private int toCreate;
        private int toUpdate;
        private int unchanged;
        private int errorCount;
        private int warningCount;
        /** Errors first, then warnings, by row; capped, see issues_truncated. */
        private List<RedirectIssue> issues;
        private boolean issuesTruncated;
        /**
         * validate, only when the file has no error: the value mode=commit takes as
         * commit_token. It stands for this file planned against the rows stored right now;
         * once either changes, the commit is refused and the file has to be validated again.
         */
        private String commitToken;
        /** commit: the rows created (ids, so each can be removed again). */
        private List<WrittenRow> created;
        /** commit: the rows changed, with their old target and status. */
        private List<WrittenRow> updated;
    }
}
