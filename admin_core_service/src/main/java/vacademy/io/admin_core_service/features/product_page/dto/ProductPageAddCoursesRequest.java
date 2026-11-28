package vacademy.io.admin_core_service.features.product_page.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/**
 * POST /v1/product-page/{id}/add-courses: the courses to put on the page, each
 * as the row it is sold through. The page's other courses are left as they are.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPageAddCoursesRequest {

    /**
     * ps_invite_payment_option_id + payment_plan_id (+ preselected) per course
     * batch, in the order they should appear. display_order is ignored: the
     * position decides where the new rows go.
     */
    private List<ProductPageInviteMappingRequest> mappings;

    /**
     * FIRST (default): the new courses go to the top and the page's courses
     * shift down, the way the editor adds a course. LAST: after the page's courses.
     */
    private String position;
}
