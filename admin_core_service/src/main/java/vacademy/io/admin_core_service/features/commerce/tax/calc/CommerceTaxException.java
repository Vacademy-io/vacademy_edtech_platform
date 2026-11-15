package vacademy.io.admin_core_service.features.commerce.tax.calc;

import vacademy.io.common.exceptions.InvalidRequestException;

/**
 * A tax calculation that cannot be made (no tax class, no rate in force, a discount larger than
 * the goods). It is the standard 400; the message starts with the code.
 */
public class CommerceTaxException extends InvalidRequestException {

    public static final String INVALID_INPUT = "TAX_INVALID_INPUT";
    public static final String TAX_CLASS_MISSING = "TAX_CLASS_MISSING";
    public static final String NO_RATE_IN_FORCE = "TAX_NO_RATE_IN_FORCE";
    public static final String NO_SLAB = "TAX_NO_SLAB";
    public static final String SELLER_STATE_MISSING = "TAX_SELLER_STATE_MISSING";

    private final String code;

    public CommerceTaxException(String code, String message) {
        super(code + ": " + message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
