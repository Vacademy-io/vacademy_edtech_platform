package vacademy.io.admin_core_service.features.commerce.notify;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds one message from the facts of an order event: the named WhatsApp variables (cleaned,
 * only the trigger's own), and the email (the shop's override or the default text, rendered to
 * HTML). The same code serves a real message and a staff member's test message.
 */
@Component
public class CommerceNotificationMessages {

    /** The raw facts of one message; null where the trigger has no such value. */
    public record Facts(String customerName, String shopName, String orderNumber, String orderTotal, String link,
                        String courier, String trackingNumber, String amountDue, String cancelReasonCode,
                        String returnNumber, String refundAmount, String refundMethodCode, Integer returnDays,
                        String refundReference, List<CommerceNotificationEmailRenderer.Item> items,
                        String itemsTotal) {
    }

    private final CommerceNotificationEmailRenderer renderer;

    public CommerceNotificationMessages(CommerceNotificationEmailRenderer renderer) {
        this.renderer = renderer;
    }

    /** Every value the trigger may use, cleaned; {@code order_link} absent when there is no link. */
    public static Map<String, String> values(CommerceNotificationTrigger trigger, String locale, Facts f) {
        Map<String, String> all = new LinkedHashMap<>();
        all.put("customer_name", CommerceNotificationValues.clean(f.customerName(), CommerceNotificationValues.CAP_NAME,
                CommerceNotificationValues.customerFallback(locale)));
        all.put("shop_name", CommerceNotificationValues.clean(f.shopName(), CommerceNotificationValues.CAP_NAME,
                CommerceNotificationTexts.EN.equals(locale) ? "our shop" : "हमारी दुकान"));
        all.put("order_number", CommerceNotificationValues.clean(f.orderNumber(), CommerceNotificationValues.CAP_NUMBER,
                "-"));
        all.put("order_total", CommerceNotificationValues.clean(f.orderTotal(), CommerceNotificationValues.CAP_NUMBER,
                "-"));
        if (f.link() != null) {
            all.put("order_link", CommerceNotificationValues.clean(f.link(), CommerceNotificationValues.CAP_LINK, "-"));
        }
        all.put("courier", CommerceNotificationValues.clean(f.courier(), CommerceNotificationValues.CAP_COURIER,
                CommerceNotificationValues.courierFallback(locale)));
        all.put("tracking_number", CommerceNotificationValues.clean(f.trackingNumber(),
                CommerceNotificationValues.CAP_TRACKING, CommerceNotificationValues.trackingFallback(locale)));
        all.put("amount_due", CommerceNotificationValues.clean(f.amountDue(), CommerceNotificationValues.CAP_NUMBER,
                "₹0"));
        all.put("cancel_reason", CommerceNotificationValues.cancelReason(f.cancelReasonCode(), locale));
        all.put("return_number", CommerceNotificationValues.clean(f.returnNumber(),
                CommerceNotificationValues.CAP_NUMBER, "-"));
        all.put("refund_amount", CommerceNotificationValues.clean(f.refundAmount(),
                CommerceNotificationValues.CAP_NUMBER, "-"));
        String method = CommerceNotificationValues.refundMethod(f.refundMethodCode(), locale);
        all.put("refund_method", method == null ? "-" : method);
        if (f.returnDays() != null && f.returnDays() > 0) {
            all.put("return_days", String.valueOf(f.returnDays()));
        }
        String reference = CommerceNotificationValues.clean(f.refundReference(), CommerceNotificationValues.CAP_TRACKING,
                "");
        if (!reference.isEmpty()) {
            all.put("refund_reference", reference);
        }
        Map<String, String> out = new LinkedHashMap<>();
        for (String name : trigger.variables()) {
            if (all.containsKey(name)) {
                out.put(name, all.get(name));
            }
        }
        for (String name : trigger.emailOnly()) {
            if (all.containsKey(name)) {
                out.put(name, all.get(name));
            }
        }
        return out;
    }

    /** The named variables of the WhatsApp message: the trigger's own, never the email-only ones. */
    public static Map<String, String> whatsappVariables(CommerceNotificationTrigger trigger, String locale, Facts f) {
        Map<String, String> values = values(trigger, locale, f);
        Map<String, String> out = new LinkedHashMap<>();
        for (String name : trigger.variables()) {
            if (values.containsKey(name)) {
                out.put(name, values.get(name));
            }
        }
        return out;
    }

    /** The email: the shop's override of the language when there is one, else the default. */
    public CommerceNotificationEmailRenderer.Email email(CommerceNotificationTrigger trigger, String locale, Facts f,
                                                         CommerceNotificationSetting setting) {
        CommerceNotificationTexts.Text text = CommerceNotificationTexts.of(trigger, locale);
        String subject = setting != null && setting.subject(locale) != null ? setting.subject(locale) : text.subject();
        String body = setting != null && setting.body(locale) != null ? setting.body(locale) : text.body();
        Map<String, String> values = values(trigger, locale, f);
        String line = null;
        if (text.emailLine() != null) {
            boolean present = CommerceNotificationTexts.placeholders(text.emailLine()).stream()
                    .allMatch(values::containsKey);
            line = present ? text.emailLine() : null;
        }
        List<CommerceNotificationEmailRenderer.Item> items = trigger.itemsTable() ? f.items() : null;
        return renderer.render(new CommerceNotificationEmailRenderer.Input(locale, values.get("shop_name"), subject,
                body, values, values.get("order_link"), line, items, trigger.itemsTable() ? f.itemsTotal() : null));
    }
}
