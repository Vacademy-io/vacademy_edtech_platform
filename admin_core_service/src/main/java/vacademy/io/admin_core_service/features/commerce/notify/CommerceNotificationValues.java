package vacademy.io.admin_core_service.features.commerce.notify;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;

/**
 * The values put into a buyer's message: money in the Indian way, the order's language, the
 * fixed phrases of a cancel reason and a refund method, and the cleaning every value gets
 * before it reaches a template (no line breaks, no placeholder braces, a length cap, a
 * fallback when nothing is left: Meta refuses an empty parameter).
 */
public final class CommerceNotificationValues {

    public static final int CAP_NAME = 60;
    public static final int CAP_COURIER = 40;
    public static final int CAP_TRACKING = 40;
    public static final int CAP_NUMBER = 32;
    public static final int CAP_PHRASE = 120;
    public static final int CAP_LINK = 300;
    public static final int CAP_SUBJECT = 150;

    private CommerceNotificationValues() {
    }

    // ------------------------------------------------------------------ language

    /** {@code hi*} to hi, {@code en*} to en (any case, {@code -} or {@code _}); anything else null. */
    public static String normaliseLocale(String raw) {
        if (raw == null) {
            return null;
        }
        String l = raw.trim().toLowerCase(Locale.ROOT);
        if (l.equals("hi") || l.startsWith("hi-") || l.startsWith("hi_")) {
            return CommerceNotificationTexts.HI;
        }
        if (l.equals("en") || l.startsWith("en-") || l.startsWith("en_")) {
            return CommerceNotificationTexts.EN;
        }
        return null;
    }

    /** The order's language, else the shop's base language, else Hindi. Never the other language as a fallback. */
    public static String messageLocale(String orderLocale, String shopBaseLocale) {
        String order = normaliseLocale(orderLocale);
        if (order != null) {
            return order;
        }
        String base = normaliseLocale(shopBaseLocale);
        return base != null ? base : CommerceNotificationTexts.HI;
    }

    // ------------------------------------------------------------------ money

    /**
     * {@code ₹1,499}, {@code ₹1,499.50}, {@code ₹1,23,456}: Indian grouping, Latin digits, no
     * decimals for whole rupees. Another currency: its ISO code, a space and the amount.
     */
    public static String money(BigDecimal amount, String currency) {
        BigDecimal value = (amount == null ? BigDecimal.ZERO : amount).setScale(2, RoundingMode.HALF_UP);
        boolean negative = value.signum() < 0;
        value = value.abs();
        boolean whole = value.remainder(BigDecimal.ONE).signum() == 0;
        String integer = value.setScale(0, RoundingMode.DOWN).toPlainString();
        String fraction = whole ? "" : "." + value.toPlainString().substring(value.toPlainString().indexOf('.') + 1);
        boolean rupees = currency == null || currency.isBlank() || "INR".equalsIgnoreCase(currency.trim());
        String grouped = rupees ? indianGrouping(integer) : westernGrouping(integer);
        String number = (negative ? "-" : "") + grouped + fraction;
        return rupees ? "₹" + number : currency.trim().toUpperCase(Locale.ROOT) + " " + number;
    }

    private static String indianGrouping(String digits) {
        if (digits.length() <= 3) {
            return digits;
        }
        String last3 = digits.substring(digits.length() - 3);
        String rest = digits.substring(0, digits.length() - 3);
        StringBuilder out = new StringBuilder();
        int first = rest.length() % 2;
        if (first > 0) {
            out.append(rest, 0, first);
        }
        for (int i = first; i < rest.length(); i += 2) {
            if (out.length() > 0) {
                out.append(',');
            }
            out.append(rest, i, i + 2);
        }
        return out.append(',').append(last3).toString();
    }

    private static String westernGrouping(String digits) {
        StringBuilder out = new StringBuilder();
        int lead = digits.length() % 3;
        if (lead > 0) {
            out.append(digits, 0, lead);
        }
        for (int i = lead; i < digits.length(); i += 3) {
            if (out.length() > 0) {
                out.append(',');
            }
            out.append(digits, i, i + 3);
        }
        return out.toString();
    }

    // ------------------------------------------------------------------ cleaning

    /**
     * CR, LF and TAB become spaces, runs of spaces one, the ends are trimmed, {@code {{} and
     * {@code }}} removed, the result cut to {@code cap}. Blank after cleaning: {@code fallback}.
     */
    public static String clean(String value, int cap, String fallback) {
        String v = value == null ? "" : value;
        v = v.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ');
        v = v.replace("{{", "").replace("}}", "");
        v = v.replaceAll(" {2,}", " ").trim();
        if (v.length() > cap) {
            v = v.substring(0, cap).trim();
        }
        return v.isEmpty() ? fallback : v;
    }

    /** As {@link #clean}, then HTML-escaped ({@code & < > " '}). */
    public static String cleanHtml(String value, int cap, String fallback) {
        return escapeHtml(clean(value, cap, fallback));
    }

    public static String escapeHtml(String value) {
        if (value == null) {
            return null;
        }
        StringBuilder out = new StringBuilder(value.length() + 16);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }

    /** A subject: one line, at most {@value #CAP_SUBJECT} characters. */
    public static String subjectLine(String subject) {
        String s = subject == null ? "" : subject.replace('\r', ' ').replace('\n', ' ').replaceAll(" {2,}", " ").trim();
        return s.length() > CAP_SUBJECT ? s.substring(0, CAP_SUBJECT).trim() : s;
    }

    // ------------------------------------------------------------------ fallbacks and phrases

    public static String customerFallback(String locale) {
        return CommerceNotificationTexts.EN.equals(locale) ? "Customer" : "ग्राहक";
    }

    public static String courierFallback(String locale) {
        return CommerceNotificationTexts.EN.equals(locale) ? "our courier" : "हमारा कूरियर";
    }

    public static String trackingFallback(String locale) {
        return CommerceNotificationTexts.EN.equals(locale) ? "not given" : "उपलब्ध नहीं";
    }

    /** The phrase of a cancel reason; an unknown reason reads as cancelled by the shop. */
    public static String cancelReason(String code, String locale) {
        boolean en = CommerceNotificationTexts.EN.equals(locale);
        String c = code == null ? "" : code.trim();
        return switch (c) {
            case "LINES_CANCELLED" -> en ? "the items are not available" : "सामान उपलब्ध नहीं है";
            case "COD_NOT_CONFIRMED" -> en ? "we could not confirm it by phone" : "फ़ोन पर पुष्टि नहीं हो सकी";
            case "OVERSOLD_PAID" -> en ? "the item sold out before your payment reached us"
                    : "आपका भुगतान पहुँचने से पहले सामान बिक गया";
            default -> en ? "cancelled by the shop" : "दुकान द्वारा रद्द";
        };
    }

    /** The phrase of a refund method; null for a method the buyer gets no message for (cash, exchange credit). */
    public static String refundMethod(String method, String locale) {
        boolean en = CommerceNotificationTexts.EN.equals(locale);
        String m = method == null ? "" : method.trim();
        return switch (m) {
            case "GATEWAY" -> en ? "the way you paid" : "आपके भुगतान के तरीके";
            case "BANK_TRANSFER" -> en ? "bank transfer" : "बैंक ट्रांसफ़र";
            case "UPI" -> "UPI";
            default -> null;
        };
    }

    /** Whether a refund of this method is messaged (GATEWAY, BANK_TRANSFER, UPI). */
    public static boolean refundMessaged(String method) {
        return refundMethod(method, CommerceNotificationTexts.EN) != null;
    }

    /**
     * A provider's error text as it may be stored: every run of six or more digits becomes
     * {@code #}, every e-mail address {@code [email]}, at most 300 characters.
     */
    public static String errorDetail(String text) {
        if (text == null) {
            return null;
        }
        String t = text.replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+", "[email]").replaceAll("\\d{6,}", "#")
                .replace('\r', ' ').replace('\n', ' ');
        return t.length() > 300 ? t.substring(0, 300) : t;
    }
}
