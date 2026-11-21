package vacademy.io.admin_core_service.features.commerce.returns.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.admin_core_service.features.commerce.returns.enums.ReturnReason;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The shop's return policy ({@code COMMERCE_SETTING.returns}) and the warnings a return gets
 * against it. Pure: no database, no clock of its own. A warning does not refuse a return; a
 * manager overrides it with a written reason.
 */
public final class CommerceReturnPolicy {

    public static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    public static final int DEFAULT_WINDOW_DAYS = 7;
    public static final int MAX_WINDOW_DAYS = 365;
    public static final int MAX_POLICY_TEXT = 2000;
    public static final List<String> DEFAULT_ALLOWED = List.of("DEFECTIVE", "WRONG_ITEM", "DAMAGED_IN_TRANSIT");

    public static final String OUTSIDE_WINDOW = "OUTSIDE_WINDOW";
    public static final String COLLECTION_NO_RETURNS = "COLLECTION_NO_RETURNS";
    public static final String REASON_NOT_ALLOWED = "REASON_NOT_ALLOWED";
    public static final String PHOTO_MISSING = "PHOTO_MISSING";

    private CommerceReturnPolicy() {
    }

    /** The policy in force. {@code policyText} holds the keys {@code hi} and {@code en}. */
    public record Settings(int windowDays, List<String> allowedReasons, boolean photoRequired,
                           String returnShippingPaidBy, Map<String, String> policyText) {
    }

    public static Settings defaults() {
        Map<String, String> text = new LinkedHashMap<>();
        text.put("hi", "");
        text.put("en", "");
        return new Settings(DEFAULT_WINDOW_DAYS, DEFAULT_ALLOWED, false, "SELLER", text);
    }

    /** The stored {@code returns} object (camelCase keys); a missing or bad value takes its default. */
    public static Settings parse(JsonNode node) {
        Settings d = defaults();
        if (node == null || !node.isObject()) {
            return d;
        }
        int window = d.windowDays();
        JsonNode w = node.get("windowDays");
        if (w != null && w.isIntegralNumber() && w.asInt() >= 0 && w.asInt() <= MAX_WINDOW_DAYS) {
            window = w.asInt();
        }
        List<String> allowed = d.allowedReasons();
        JsonNode a = node.get("allowedReasons");
        if (a != null && a.isArray()) {
            Set<String> out = new LinkedHashSet<>();
            boolean bad = false;
            for (JsonNode item : a) {
                ReturnReason reason = item.isTextual() ? ReturnReason.of(item.asText()) : null;
                if (reason == null) {
                    bad = true;
                    break;
                }
                out.add(reason.name());
            }
            if (!bad) {
                allowed = List.copyOf(out);
            }
        }
        boolean photo = node.path("photoRequired").isBoolean() ? node.path("photoRequired").asBoolean()
                : d.photoRequired();
        String paidBy = node.path("returnShippingPaidBy").asText("");
        if (!"SELLER".equals(paidBy) && !"BUYER".equals(paidBy)) {
            paidBy = d.returnShippingPaidBy();
        }
        Map<String, String> text = new LinkedHashMap<>(d.policyText());
        JsonNode t = node.get("policyText");
        if (t != null && t.isObject()) {
            for (String lang : List.of("hi", "en")) {
                JsonNode value = t.get(lang);
                if (value != null && value.isTextual() && value.asText().length() <= MAX_POLICY_TEXT) {
                    text.put(lang, value.asText());
                }
            }
        }
        return new Settings(window, allowed, photo, paidBy, text);
    }

    /**
     * The policy after a staff write ({@code returns} of {@code PUT /checkout-settings},
     * snake_case keys); a key left out keeps its value.
     *
     * @throws InvalidRequestException for a value out of range
     */
    public static Settings fromBody(JsonNode body, Settings current) {
        if (body == null || !body.isObject()) {
            throw new InvalidRequestException("invalid_request: returns is a JSON object");
        }
        int window = current.windowDays();
        if (body.has("window_days")) {
            JsonNode w = body.get("window_days");
            if (!w.isIntegralNumber() || w.asInt() < 0 || w.asInt() > MAX_WINDOW_DAYS) {
                throw new InvalidRequestException("invalid_request: returns.window_days is a whole number from 0 to "
                        + MAX_WINDOW_DAYS);
            }
            window = w.asInt();
        }
        List<String> allowed = current.allowedReasons();
        if (body.has("allowed_reasons")) {
            JsonNode a = body.get("allowed_reasons");
            if (!a.isArray()) {
                throw new InvalidRequestException("invalid_request: returns.allowed_reasons is a list of reasons");
            }
            Set<String> out = new LinkedHashSet<>();
            for (JsonNode item : a) {
                ReturnReason reason = item.isTextual() ? ReturnReason.of(item.asText()) : null;
                if (reason == null) {
                    throw new InvalidRequestException("invalid_request: returns.allowed_reasons holds DEFECTIVE, "
                            + "WRONG_ITEM, DAMAGED_IN_TRANSIT, SIZE, CHANGED_MIND or OTHER");
                }
                out.add(reason.name());
            }
            allowed = List.copyOf(out);
        }
        boolean photo = current.photoRequired();
        if (body.has("photo_required")) {
            if (!body.get("photo_required").isBoolean()) {
                throw new InvalidRequestException("invalid_request: returns.photo_required is true or false");
            }
            photo = body.get("photo_required").asBoolean();
        }
        String paidBy = current.returnShippingPaidBy();
        if (body.has("return_shipping_paid_by")) {
            String v = body.get("return_shipping_paid_by").asText("");
            if (!"SELLER".equals(v) && !"BUYER".equals(v)) {
                throw new InvalidRequestException("invalid_request: returns.return_shipping_paid_by is SELLER or BUYER");
            }
            paidBy = v;
        }
        Map<String, String> text = new LinkedHashMap<>(current.policyText());
        if (body.has("policy_text")) {
            JsonNode t = body.get("policy_text");
            if (!t.isObject()) {
                throw new InvalidRequestException("invalid_request: returns.policy_text is {hi, en}");
            }
            for (String lang : List.of("hi", "en")) {
                if (t.has(lang)) {
                    JsonNode value = t.get(lang);
                    if (!value.isTextual() || value.asText().length() > MAX_POLICY_TEXT) {
                        throw new InvalidRequestException("invalid_request: returns.policy_text." + lang
                                + " is text of at most " + MAX_POLICY_TEXT + " characters");
                    }
                    text.put(lang, value.asText());
                }
            }
        }
        return new Settings(window, allowed, photo, paidBy, text);
    }

    /** The stored form (camelCase). */
    public static ObjectNode toStored(Settings s) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("windowDays", s.windowDays());
        s.allowedReasons().forEach(node.putArray("allowedReasons")::add);
        node.put("photoRequired", s.photoRequired());
        node.put("returnShippingPaidBy", s.returnShippingPaidBy());
        ObjectNode text = node.putObject("policyText");
        s.policyText().forEach(text::put);
        return node;
    }

    /** The API form (snake_case). */
    public static Map<String, Object> view(Settings s) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("window_days", s.windowDays());
        out.put("allowed_reasons", s.allowedReasons());
        out.put("photo_required", s.photoRequired());
        out.put("return_shipping_paid_by", s.returnShippingPaidBy());
        out.put("policy_text", s.policyText());
        return out;
    }

    /** Days from the delivery date to today, both as days in India. */
    public static long daysSince(LocalDate deliveredOn, LocalDate today) {
        return ChronoUnit.DAYS.between(deliveredOn, today);
    }

    /** The day in India of an instant. */
    public static LocalDate indiaDay(Instant instant) {
        return instant == null ? null : instant.atZone(INDIA).toLocalDate();
    }

    /** The window that applies: the smallest collection window when one is set, else the shop's. */
    public static int windowDays(Settings s, Integer smallestCollectionWindow) {
        return smallestCollectionWindow != null ? smallestCollectionWindow : s.windowDays();
    }

    /**
     * The warnings of a return.
     *
     * @param deliveredOn              the delivery day in India; null gives no window warning
     * @param smallestCollectionWindow the smallest {@code return_window_days} of the collections of
     *                                 the returned lines' products, null when none sets one
     */
    public static List<String> check(Settings s, LocalDate deliveredOn, LocalDate today,
                                     Integer smallestCollectionWindow, String reason, int photoCount) {
        List<String> warnings = new ArrayList<>();
        int window = windowDays(s, smallestCollectionWindow);
        if (deliveredOn != null && today != null && daysSince(deliveredOn, today) > window) {
            warnings.add(OUTSIDE_WINDOW);
        }
        if (smallestCollectionWindow != null && smallestCollectionWindow == 0) {
            warnings.add(COLLECTION_NO_RETURNS);
        }
        if (reason == null || !s.allowedReasons().contains(reason)) {
            warnings.add(REASON_NOT_ALLOWED);
        }
        if (s.photoRequired() && photoCount <= 0) {
            warnings.add(PHOTO_MISSING);
        }
        return warnings;
    }
}
