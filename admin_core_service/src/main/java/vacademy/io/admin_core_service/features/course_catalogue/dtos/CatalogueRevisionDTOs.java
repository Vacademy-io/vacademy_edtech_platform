package vacademy.io.admin_core_service.features.course_catalogue.dtos;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

public class CatalogueRevisionDTOs {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SaveDraftRequest {
        private String catalogueJson;
        /** MANUAL | AI_WIZARD | AI_COPILOT (defaults to MANUAL). */
        private String source;
        private String aiRunId;
        /**
         * "Keep my draft": the editor saw that the live site changed after this
         * draft began and keeps the draft anyway. A stale draft is then
         * re-based on the current live site, so it stops being reported stale
         * (and the AI tools stop refusing it) until the live site moves again.
         */
        private Boolean acknowledgeLive;
        /**
         * Only start a NEW draft: refuse (409 DRAFT_EXISTS) when one is open
         * instead of overwriting it. An MCP rollback sets it, so an admin's
         * unpublished work is never replaced by an old version.
         */
        private Boolean createOnly;

        public SaveDraftRequest(String catalogueJson, String source, String aiRunId) {
            this(catalogueJson, source, aiRunId, null, null);
        }

        public SaveDraftRequest(String catalogueJson, String source, String aiRunId, Boolean acknowledgeLive) {
            this(catalogueJson, source, aiRunId, acknowledgeLive, null);
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class RevisionResponse {
        private String id;
        private Integer revisionNo;
        private String status;
        private String source;
        private String aiRunId;
        private String createdByUserId;
        private Date createdAt;
        private Date updatedAt;
        /** Full config JSON — only populated on single-revision fetches. */
        private String catalogueJson;

        /* Draft fetch only: did the live site change after this draft was
         * started? Publishing such a draft would undo those live changes. */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Boolean liveChangedSinceDraft;
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Integer liveRevisionNo;
        @JsonInclude(JsonInclude.Include.NON_NULL)
        private Date liveUpdatedAt;
    }
}
