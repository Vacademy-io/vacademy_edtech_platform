package vacademy.io.admin_core_service.features.commerce.notify;

import java.util.List;

/**
 * The nine order events the buyer hears about, in the order the settings show them. Each has a
 * WhatsApp template name (the same in Hindi and English), a two-letter tag carried in its order
 * links (for support reading only), the variables its WhatsApp message may use, and the lines
 * only its email adds.
 */
public enum CommerceNotificationTrigger {

    ORDER_CONFIRMED("OC", "commerce_order_confirmed",
            List.of("customer_name", "shop_name", "order_number", "order_total", "order_link"), List.of(), true),
    COD_CONFIRMATION_NEEDED("CN", "commerce_cod_confirmation_needed",
            List.of("customer_name", "shop_name", "order_number", "order_total", "order_link"), List.of(), true),
    ORDER_SHIPPED("OS", "commerce_order_shipped",
            List.of("customer_name", "shop_name", "order_number", "courier", "tracking_number", "amount_due",
                    "order_link"), List.of(), false),
    ORDER_DELIVERED("OD", "commerce_order_delivered",
            List.of("customer_name", "shop_name", "order_number", "order_link"), List.of("return_days"), false),
    ORDER_CANCELLED("OX", "commerce_order_cancelled",
            List.of("customer_name", "shop_name", "order_number", "cancel_reason", "order_link"), List.of(), false),
    ORDER_RTO("OR", "commerce_order_rto",
            List.of("customer_name", "shop_name", "order_number", "order_link"), List.of(), false),
    RETURN_APPROVED("RA", "commerce_return_approved",
            List.of("customer_name", "shop_name", "order_number", "return_number", "order_link"), List.of(), false),
    REFUND_PROCESSED("RP", "commerce_refund_processed",
            List.of("customer_name", "shop_name", "order_number", "refund_amount", "refund_method", "order_link"),
            List.of("refund_reference"), false),
    POS_BILL_ISSUED("PB", "commerce_pos_bill_issued",
            List.of("shop_name", "order_number", "order_total", "order_link"), List.of(), true);

    private final String tag;
    private final String templateName;
    private final List<String> variables;
    private final List<String> emailOnly;
    private final boolean itemsTable;

    CommerceNotificationTrigger(String tag, String templateName, List<String> variables, List<String> emailOnly,
                                boolean itemsTable) {
        this.tag = tag;
        this.templateName = templateName;
        this.variables = variables;
        this.emailOnly = emailOnly;
        this.itemsTable = itemsTable;
    }

    /** Two letters in the order link, for support reading only. */
    public String tag() {
        return tag;
    }

    /** The default WhatsApp template name (the same in both languages). */
    public String templateName() {
        return templateName;
    }

    /** The variables of the message, the only ones a WhatsApp template of the trigger may ask for. */
    public List<String> variables() {
        return variables;
    }

    /** Variables only the email has. */
    public List<String> emailOnly() {
        return emailOnly;
    }

    /** Whether the email adds the table of items. */
    public boolean itemsTable() {
        return itemsTable;
    }

    /** The trigger of a code, or null. */
    public static CommerceNotificationTrigger of(String code) {
        if (code == null) {
            return null;
        }
        for (CommerceNotificationTrigger t : values()) {
            if (t.name().equals(code)) {
                return t;
            }
        }
        return null;
    }
}
