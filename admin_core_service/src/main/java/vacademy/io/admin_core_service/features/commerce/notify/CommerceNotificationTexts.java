package vacademy.io.admin_core_service.features.commerce.notify;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The default texts of the buyer's messages: one per trigger and language (Hindi and English),
 * the email subjects, and the lines only the email has. Named placeholders ({@code {{order_number}}})
 * are written here; the positional WhatsApp form ({@code {{1}}}) and its list of variable names
 * are made from them. Every text is transactional: no offer, no advertising.
 */
public final class CommerceNotificationTexts {

    public static final String HI = "hi";
    public static final String EN = "en";
    public static final List<String> LOCALES = List.of(HI, EN);

    /** {@code {{name}}}: a named placeholder. */
    public static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*([A-Za-z0-9_]+)\\s*\\}\\}");

    /** One language of one trigger. */
    public record Text(String body, String subject, String emailLine) {
    }

    /** The positional form of a body and the variable name of each position (1-based, in order). */
    public record Positional(String body, List<String> names) {
    }

    private static final Map<CommerceNotificationTrigger, Map<String, Text>> TEXTS =
            new EnumMap<>(CommerceNotificationTrigger.class);

    static {
        put(CommerceNotificationTrigger.ORDER_CONFIRMED,
                new Text("Hello {{customer_name}}, thank you for shopping with {{shop_name}}. Your order {{order_number}} "
                        + "for {{order_total}} is confirmed. See your order: {{order_link}} We will message you again "
                        + "when it is on its way.", "Order {{order_number}} confirmed", null),
                new Text("नमस्ते {{customer_name}}, आपकी {{shop_name}} से ख़रीदारी के लिए धन्यवाद। आपका ऑर्डर {{order_number}} "
                        + "(राशि {{order_total}}) पक्का हो गया है। अपना ऑर्डर देखें: {{order_link}} पार्सल भेजते ही हम आपको "
                        + "फिर संदेश भेजेंगे।", "ऑर्डर {{order_number}} पक्का हो गया", null));
        put(CommerceNotificationTrigger.COD_CONFIRMATION_NEEDED,
                new Text("Hello {{customer_name}}, we have received your cash on delivery order {{order_number}} for "
                        + "{{order_total}} at {{shop_name}}. Our team will call you to confirm it before packing. See "
                        + "your order: {{order_link}} Thank you.", "Order {{order_number}}: we will call to confirm", null),
                new Text("नमस्ते {{customer_name}}, हमें {{shop_name}} पर आपका कैश ऑन डिलीवरी ऑर्डर {{order_number}} (राशि "
                        + "{{order_total}}) मिल गया है। पैक करने से पहले हमारी टीम आपको फ़ोन करके पुष्टि करेगी। अपना ऑर्डर "
                        + "देखें: {{order_link}} धन्यवाद।", "ऑर्डर {{order_number}}: पुष्टि के लिए हम फ़ोन करेंगे", null));
        put(CommerceNotificationTrigger.ORDER_SHIPPED,
                new Text("Hello {{customer_name}}, your order {{order_number}} has been sent. Courier: {{courier}}, "
                        + "tracking number: {{tracking_number}}. Amount to pay at delivery: {{amount_due}}. See your "
                        + "order: {{order_link}} Thank you for shopping with us.", "Order {{order_number}} is on its way",
                        null),
                new Text("नमस्ते {{customer_name}}, आपका ऑर्डर {{order_number}} भेज दिया गया है। कूरियर: {{courier}}, "
                        + "ट्रैकिंग नंबर: {{tracking_number}}। डिलीवरी पर देने की राशि: {{amount_due}}। अपना ऑर्डर देखें: "
                        + "{{order_link}} हमसे ख़रीदारी के लिए धन्यवाद।", "ऑर्डर {{order_number}} भेज दिया गया", null));
        put(CommerceNotificationTrigger.ORDER_DELIVERED,
                new Text("Hello {{customer_name}}, your order {{order_number}} from {{shop_name}} has been delivered. "
                        + "We hope you like it. If anything is wrong, open your order and message us from there: "
                        + "{{order_link}} Thank you.", "Order {{order_number}} delivered",
                        "You can ask for a return within {{return_days}} days of delivery."),
                new Text("नमस्ते {{customer_name}}, आपका {{shop_name}} से मँगाया गया ऑर्डर {{order_number}} पहुँच गया "
                        + "है। उम्मीद है आपको पसंद आएगा। कोई भी कमी हो तो अपना ऑर्डर खोलें और वहीं से हमें संदेश भेजें: {{order_link}} "
                        + "धन्यवाद।", "ऑर्डर {{order_number}} पहुँच गया",
                        "डिलीवरी के {{return_days}} दिन के भीतर आप वापसी के लिए कह सकते हैं।"));
        put(CommerceNotificationTrigger.ORDER_CANCELLED,
                new Text("Hello {{customer_name}}, your order {{order_number}} from {{shop_name}} has been cancelled. "
                        + "Reason: {{cancel_reason}}. If you have paid, the money will come back to you within 5 to 7 "
                        + "working days. Details: {{order_link}} Sorry for the trouble.",
                        "Order {{order_number}} cancelled", null),
                new Text("नमस्ते {{customer_name}}, आपका {{shop_name}} से मँगाया गया ऑर्डर {{order_number}} रद्द कर "
                        + "दिया गया है। कारण: {{cancel_reason}}। अगर आपने भुगतान किया है, तो पैसा 5 से 7 कामकाजी दिनों में आपको वापस "
                        + "मिल जाएगा। विवरण: {{order_link}} असुविधा के लिए खेद है।", "ऑर्डर {{order_number}} रद्द", null));
        put(CommerceNotificationTrigger.ORDER_RTO,
                new Text("Hello {{customer_name}}, the parcel of your order {{order_number}} could not be delivered and "
                        + "is going back to {{shop_name}}. If you paid online, we will refund you once it reaches us. To "
                        + "have it sent again, open your order and message us: {{order_link}} Thank you.",
                        "Order {{order_number}}: parcel returning to us", null),
                new Text("नमस्ते {{customer_name}}, आपके ऑर्डर {{order_number}} का पार्सल डिलीवर नहीं हो सका और "
                        + "{{shop_name}} को वापस जा रहा है। अगर आपने ऑनलाइन भुगतान किया था, तो पार्सल हमारे पास पहुँचते "
                        + "ही पैसा लौटा दिया जाएगा। दोबारा मँगवाने के लिए अपना ऑर्डर खोलें और हमें संदेश भेजें: "
                        + "{{order_link}} धन्यवाद।", "ऑर्डर {{order_number}}: पार्सल वापस आ रहा है", null));
        put(CommerceNotificationTrigger.RETURN_APPROVED,
                new Text("Hello {{customer_name}}, your return {{return_number}} for order {{order_number}} is "
                        + "approved. Our team will contact you about sending the item back. Please keep the return "
                        + "number with the parcel. Details: {{order_link}} Thank you.",
                        "Return {{return_number}} approved", null),
                new Text("नमस्ते {{customer_name}}, ऑर्डर {{order_number}} के लिए आपकी वापसी {{return_number}} मंज़ूर हो "
                        + "गई है। सामान वापस भेजने के बारे में हमारी टीम आपसे संपर्क करेगी। पार्सल के साथ वापसी नंबर ज़रूर "
                        + "रखें। विवरण: {{order_link}} धन्यवाद।", "वापसी {{return_number}} मंज़ूर", null));
        put(CommerceNotificationTrigger.REFUND_PROCESSED,
                new Text("Hello {{customer_name}}, we have refunded {{refund_amount}} for your order {{order_number}} "
                        + "by {{refund_method}}. It can take up to 7 working days to show in your account. Details: "
                        + "{{order_link}} Thank you.", "Refund of {{refund_amount}} for order {{order_number}}",
                        "Reference: {{refund_reference}}"),
                new Text("नमस्ते {{customer_name}}, आपके ऑर्डर {{order_number}} के लिए {{refund_amount}} की राशि "
                        + "{{refund_method}} से लौटा दी गई है। आपके खाते में दिखने में 7 कामकाजी दिन तक लग सकते हैं। "
                        + "विवरण: {{order_link}} धन्यवाद।", "ऑर्डर {{order_number}} का {{refund_amount}} रिफ़ंड",
                        "संदर्भ: {{refund_reference}}"));
        put(CommerceNotificationTrigger.POS_BILL_ISSUED,
                new Text("Hello, thank you for shopping at {{shop_name}}. Your bill {{order_number}} is for "
                        + "{{order_total}}. See your bill: {{order_link}} Please keep it for any return or exchange.",
                        "Your bill {{order_number}} from {{shop_name}}", null),
                new Text("नमस्ते, {{shop_name}} से ख़रीदारी के लिए धन्यवाद। आपके बिल {{order_number}} की राशि "
                        + "{{order_total}} है। बिल देखें: {{order_link}} वापसी या बदलाव के लिए इसे सँभालकर रखें।",
                        "{{shop_name}} का बिल {{order_number}}", null));
    }

    private CommerceNotificationTexts() {
    }

    private static void put(CommerceNotificationTrigger trigger, Text en, Text hi) {
        Map<String, Text> byLocale = new LinkedHashMap<>();
        byLocale.put(HI, hi);
        byLocale.put(EN, en);
        TEXTS.put(trigger, byLocale);
    }

    /** The default text of a trigger in {@code hi} or {@code en}. */
    public static Text of(CommerceNotificationTrigger trigger, String locale) {
        Text text = TEXTS.get(trigger).get(locale);
        if (text == null) {
            throw new IllegalArgumentException("no text for locale " + locale);
        }
        return text;
    }

    /** The named placeholders of a text, in order of appearance (repeats kept). */
    public static List<String> placeholders(String text) {
        List<String> names = new ArrayList<>();
        if (text == null) {
            return names;
        }
        Matcher m = PLACEHOLDER.matcher(text);
        while (m.find()) {
            names.add(m.group(1));
        }
        return names;
    }

    /** {@code {{1}} ... {{n}}} numbered in order of first appearance; a repeated name keeps its number. */
    public static Positional positional(String namedBody) {
        List<String> names = new ArrayList<>();
        Matcher m = PLACEHOLDER.matcher(namedBody);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String name = m.group(1);
            int index = names.indexOf(name);
            if (index < 0) {
                names.add(name);
                index = names.size() - 1;
            }
            m.appendReplacement(out, Matcher.quoteReplacement("{{" + (index + 1) + "}}"));
        }
        m.appendTail(out);
        return new Positional(out.toString(), List.copyOf(names));
    }

    /** The text with each {@code {{name}}} replaced by its value; an unknown name becomes empty. */
    public static String fill(String text, Map<String, String> values) {
        if (text == null) {
            return null;
        }
        Matcher m = PLACEHOLDER.matcher(text);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String value = values == null ? null : values.get(m.group(1));
            m.appendReplacement(out, Matcher.quoteReplacement(value == null ? "" : value));
        }
        m.appendTail(out);
        return out.toString();
    }
}
