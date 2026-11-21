package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A short link on the product's website: &lt;website&gt;/&lt;code&gt; opens the site with this source and
 * campaign as its utm tags, so a sign-up from a post shows where it came from.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductShortLinkDTO {
    /** The path after the domain. Lowercase letters, numbers and -. */
    private String code;
    /** utm_source of the visit. */
    private String source;
    /** utm_campaign of the visit. Optional. */
    private String campaign;
}
