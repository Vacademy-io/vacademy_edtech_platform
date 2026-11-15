package vacademy.io.admin_core_service.features.commerce.order.service;

/**
 * A cart that cannot be priced at all: a malformed request ({@link #CART_INVALID}) or a shop
 * whose setup does not allow a price yet ({@link #NOT_PRICEABLE}: no tax class, no rate in
 * force, no seller state). A line that cannot be bought is not this; it is reported on the
 * line.
 */
public class CartPricingException extends RuntimeException {

    public static final String CART_INVALID = "CART_INVALID";
    public static final String NOT_PRICEABLE = "NOT_PRICEABLE";

    private final String code;

    public CartPricingException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
