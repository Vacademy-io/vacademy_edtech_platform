package vacademy.io.admin_core_service.features.product_page.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * One card of the admin Product Pages list: the page's own columns and how
 * many courses it sells. No page/settings JSON and no mappings, which a store
 * page selling the whole catalogue makes heavy.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPageSummaryResponse {

    private String id;
    private String name;
    private String code;
    private String status;
    private String shortUrl;
    private long mappingCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
