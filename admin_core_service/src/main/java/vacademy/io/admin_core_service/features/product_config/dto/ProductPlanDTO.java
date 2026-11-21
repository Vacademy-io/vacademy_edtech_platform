package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One paid plan of a product, as the health dashboard sets it and the product's website shows it. */
@Data
@Builder(toBuilder = true)
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPlanDTO {
    /** Short id used in sign-up links, like starter or team. */
    private String key;
    private String name;
    /** Price for one plan period, in rupees, before GST. */
    private Integer priceInr;
    /** AI credits included for the plan period (1 credit checks 1 page). */
    private Integer credits;
    /** How many users (teachers) can use it. */
    private Integer users;
    /**
     * Who the plan is for, on a product sold two ways: PLATFORM (the dashboard) or API (calls from the
     * customer's own software). Null = every workspace of the product (Evalezy, VoomSales).
     */
    private String accessMode;
    /**
     * Months one plan period lasts, when it differs from the product's plan_validity_months (a monthly
     * and a yearly plan side by side). The storefront's period wins when the plan is on sale there.
     */
    private Integer validityMonths;
}
