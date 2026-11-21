package vacademy.io.admin_core_service.features.product_page.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/**
 * A page of the admin Product Pages list. totalElements and totalPages count
 * the pages matching every filter. activeCount and draftCount match the
 * search but ignore the status filter, so the status chips keep their
 * numbers while one of them is selected.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPageListResponse {

    private List<ProductPageSummaryResponse> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private long activeCount;
    private long draftCount;
}
