package vacademy.io.admin_core_service.features.catalogue_resources.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Freebie downloads for the admin: per file, and per lead. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResourceDownloadReport {

    private long totalDownloads;
    private long leadsWithDownloads;
    private List<ResourceRow> resources;
    private List<LeadRow> leads;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResourceRow {
        private String title;
        private String url;
        private long downloads;
        /** Distinct leads; anonymous downloads are not counted here. */
        private long leads;
        private String lastDownloadedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LeadRow {
        private String responseId;
        private String userId;
        private String name;
        private String email;
        private String mobileNumber;
        private String audienceName;
        private long downloads;
        /** Distinct freebies, newest first. */
        private List<String> resources;
        private String lastDownloadedAt;
    }
}
