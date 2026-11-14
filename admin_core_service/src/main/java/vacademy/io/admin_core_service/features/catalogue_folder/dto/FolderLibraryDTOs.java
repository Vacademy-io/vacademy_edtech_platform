package vacademy.io.admin_core_service.features.catalogue_folder.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Wire shapes of the folder library — snake_case like every catalogue API. */
public class FolderLibraryDTOs {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LibraryRequest {
        private String name;
        private String description;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class LibraryResponse {
        private String id;
        private String instituteId;
        private String name;
        private String description;
        private long nodeCount;
        private String createdAt;
        private String updatedAt;
    }

    /**
     * Create and update. On update a null field means "leave as is"; an empty
     * string clears description / image_url and every knowledge-stream text
     * field (slug ... audience_id), and an empty `view` clears the folder's
     * display override. coming_soon: null leaves it, true/false sets it.
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class NodeRequest {
        /** Create only: null = top level. Moving goes through {@link MoveRequest}. */
        private String parentId;
        /** Create only: FOLDER | PRODUCT_PAGE. */
        private String nodeType;
        private String title;
        private String description;
        private String imageUrl;
        private String productPageId;
        /** ACTIVE | HIDDEN. */
        private String status;
        private Map<String, Object> view;

        /* Knowledge-stream fields (all optional). */

        /** URL key ([a-z0-9-]{1,120}, lower-cased on save); unique within the library. */
        private String slug;
        /** Course tag the folder filters by (max 191, no commas); empty = the slug. */
        private String courseTag;
        /** Max 255. */
        private String subtitle;
        /** Max 255. */
        private String tagline;
        /** Max 120. */
        private String ctaLabel;
        /** A site route starting with "/" or an http(s):// URL. */
        private String linkUrl;
        /** #rgb, #rrggbb or #rrggbbaa. */
        private String accentColor;
        private Boolean comingSoon;
        /** One of the institute's audiences (lead campaigns). */
        private String audienceId;

        /** The fields every request carried before the knowledge-stream fields existed. */
        public NodeRequest(String parentId, String nodeType, String title, String description, String imageUrl,
                           String productPageId, String status, Map<String, Object> view) {
            this.parentId = parentId;
            this.nodeType = nodeType;
            this.title = title;
            this.description = description;
            this.imageUrl = imageUrl;
            this.productPageId = productPageId;
            this.status = status;
            this.view = view;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class MoveRequest {
        /** Destination folder; null = top level. */
        private String parentId;
        /** Position among the destination's children; past the end appends. */
        private Integer index;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class NodeResponse {
        private String id;
        private String parentId;
        private String nodeType;
        private String title;
        private String description;
        private String imageUrl;
        /** Admin reads only — learners address product pages by code. */
        private String productPageId;
        private String productPageCode;
        private String productPageName;
        /** Admin reads only: lets the manager flag a DRAFT or deleted product page. */
        private String productPageStatus;
        private Integer displayOrder;
        private String status;
        private Map<String, Object> view;
        /* Knowledge-stream fields: omitted while unset, like every other optional field. */
        private String slug;
        private String courseTag;
        private String subtitle;
        private String tagline;
        private String ctaLabel;
        private String linkUrl;
        private String accentColor;
        /**
         * Admin reads always carry it; the public tree only when true, so a
         * library that never uses it serves exactly the payload it did before.
         */
        private Boolean comingSoon;
        private String audienceId;
        @Builder.Default
        private List<NodeResponse> children = new ArrayList<>();
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TreeResponse {
        private LibraryResponse library;
        /** Top-level nodes, each nesting its children in display order. */
        private List<NodeResponse> roots;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DeleteResponse {
        private int deleted;
        private TreeResponse tree;
    }
}
