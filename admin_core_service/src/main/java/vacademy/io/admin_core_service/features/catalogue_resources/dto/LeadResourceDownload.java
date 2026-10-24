package vacademy.io.admin_core_service.features.catalogue_resources.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One freebie a lead opened, for the Lead Profile. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LeadResourceDownload {
    private String title;
    private String url;
    private String downloadedAt;
}
