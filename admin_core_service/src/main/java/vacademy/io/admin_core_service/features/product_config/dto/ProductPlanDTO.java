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
}
