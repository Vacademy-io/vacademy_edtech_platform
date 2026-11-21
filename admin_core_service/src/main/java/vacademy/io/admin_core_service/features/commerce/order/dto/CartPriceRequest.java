package vacademy.io.admin_core_service.features.commerce.order.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * What a cart sends to be priced. The server prices every line itself: {@code unitPrice} is
 * only what the cart last showed, used to report a change, and no total is accepted at all.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CartPriceRequest {

    public static final String PREPAID = "PREPAID";
    public static final String COD = "COD";

    private List<Line> lines;
    private String couponCode;
    /** Delivery pincode; optional. Decides the tax head and the COD pincode rule. */
    private String pincode;
    /** GST state code of the delivery address, when the shopper has entered one; wins over the pincode. */
    private String stateCode;
    /** PREPAID (default) or COD. */
    private String paymentMethod;
    private String locale;
    /** Only for a coupon that is limited to named e-mail addresses. */
    private String email;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Line {
        /** The cart's own key for the line; echoed back. Defaults to the variant id. */
        private String lineRef;
        /** The variant id of the product response; or send {@code sku}. */
        private String variantId;
        private String sku;
        /** In base units (10 cm steps for cloth sold by the metre with qty scale 10). */
        private Integer quantity;
        /** What the cart showed for one base unit; never trusted. */
        private BigDecimal unitPrice;
    }
}
