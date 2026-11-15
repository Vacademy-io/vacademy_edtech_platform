package vacademy.io.admin_core_service.features.commerce.customer;

/**
 * One spelling of a phone number for the shop, so that the number typed at checkout, the
 * number an OTP was sent to and the number on an order compare equal. Digits only; an Indian
 * mobile (ten digits starting 6 to 9, with or without 0, 91 or +91 in front) becomes
 * {@code 91XXXXXXXXXX}; any other number keeps its digits with the country code as typed.
 */
public final class CommercePhones {

    private CommercePhones() {
    }

    /** The stored spelling, or null when the text is not a usable phone number. */
    public static String normalise(String raw) {
        if (raw == null) {
            return null;
        }
        StringBuilder digits = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c >= '0' && c <= '9') {
                digits.append(c);
            } else if (c != '+' && c != ' ' && c != '-' && c != '(' && c != ')') {
                return null;
            }
        }
        String d = digits.toString();
        if (d.length() == 11 && d.charAt(0) == '0') {
            d = d.substring(1);
        }
        if (d.length() == 12 && d.startsWith("91")) {
            d = d.substring(2);
        }
        if (d.length() == 10) {
            return d.charAt(0) >= '6' ? "91" + d : null;
        }
        // A number of another country, typed with its country code.
        return d.length() >= 11 && d.length() <= 15 && raw.trim().startsWith("+") ? d : null;
    }

    /** The last four digits behind dots, for a page a buyer opens from a link. */
    public static String mask(String phone) {
        if (phone == null || phone.length() < 4) {
            return null;
        }
        return "••••••" + phone.substring(phone.length() - 4);
    }
}
