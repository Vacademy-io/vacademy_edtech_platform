package vacademy.io.admin_core_service.features.commerce.storefront.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * What the storefront and the cart read from the institute setting {@code COMMERCE_SETTING}
 * (the same blob the stock code reads):
 * <pre>
 * { "baseLocale": "hi",
 *   "lowStockThreshold": 3,
 *   "leadMediaTag": "REAL",
 *   "mediaTags": ["REAL", "RENDER"],
 *   "maxOrderQuantity": 25,
 *   "priceBands": [1000, 2500, 5000],
 *   "dispatchPromise": { "hi": "...", "en": "Ships in 2 working days" },
 *   "cod": { "enabled": true, "maxOrderValue": 5000, "staffConfirmThreshold": 3000,
 *            "blockedPincodes": ["190001"], "maxOpenOrdersPerPhone": 2, "maxRefusals": 2 },
 *   "buyerIdentity": "EITHER",
 *   "otp": { "instituteHourlyCap": 300 },
 *   "offers": { ... as on a product page ... },
 *   "basketPricing": { ... as on a product page ... } }
 * </pre>
 * A missing or unreadable value takes its default; nothing here can switch a check off by being
 * broken (COD stays off, the low-stock threshold stays 3, the largest quantity of one cart
 * line stays 25).
 *
 * <p>{@code baseLocale} here is only the fallback for a shop without a site: the base language
 * of a shop is the one of its site ({@code globalSettings.i18n.defaultLocale}), which
 * {@code CommerceStorefrontSettings} puts in its place when the site names one.
 *
 * <p>{@code maxOrderQuantity} is the largest quantity of one variant in a cart, in units (25
 * metres for cloth sold by length). A cart line above it is refused with a reason of its own
 * whatever the stock is, so that trying quantities cannot be used to read the stock count.
 *
 * <p>{@code buyerIdentity} ({@link BuyerIdentity}) says who the buyer of a shop order is; missing
 * or unknown is {@code EITHER}. {@code otp.instituteHourlyCap} is how many OTP messages the shop
 * may send in one hour (10 to 2000; missing or out of range is 300).
 *
 * <p>{@code orders.refundShippingOnRto} (the order desk): when a prepaid parcel comes back, the
 * delivery charge is refunded too (true, the default) or kept (false). Only a JSON false keeps it.
 */
public record StorefrontSettings(String baseLocale, int lowStockThreshold, String leadMediaTag,
                                 List<BigDecimal> priceBands, Map<String, String> dispatchPromise,
                                 Cod cod, String pricingRulesJson, int maxOrderQuantity,
                                 List<String> mediaTags, BuyerIdentity buyerIdentity,
                                 int otpInstituteHourlyCap, boolean refundShippingOnRto) {

    /** Without the order-desk keys: the delivery charge is refunded on an RTO. */
    public StorefrontSettings(String baseLocale, int lowStockThreshold, String leadMediaTag,
                              List<BigDecimal> priceBands, Map<String, String> dispatchPromise, Cod cod,
                              String pricingRulesJson, int maxOrderQuantity, List<String> mediaTags,
                              BuyerIdentity buyerIdentity, int otpInstituteHourlyCap) {
        this(baseLocale, lowStockThreshold, leadMediaTag, priceBands, dispatchPromise, cod, pricingRulesJson,
                maxOrderQuantity, mediaTags, buyerIdentity, otpInstituteHourlyCap, true);
    }

    public static final String DEFAULT_BASE_LOCALE = "en";
    public static final int DEFAULT_LOW_STOCK_THRESHOLD = 3;
    public static final BigDecimal DEFAULT_COD_MAX_ORDER_VALUE = new BigDecimal("5000.00");
    public static final BigDecimal DEFAULT_COD_STAFF_CONFIRM_THRESHOLD = new BigDecimal("3000.00");
    public static final int DEFAULT_MAX_ORDER_QUANTITY = 25;
    /** Offered in the product editor when the institute has no list of its own. */
    public static final List<String> DEFAULT_MEDIA_TAGS = List.of("HERO", "SWATCH", "SIZE_CHART");
    private static final int MAX_MAX_ORDER_QUANTITY = 10_000;
    private static final int MAX_MEDIA_TAGS = 20;
    private static final int MAX_LOW_STOCK_THRESHOLD = 100;
    private static final int MAX_BLOCKED_PINCODES = 20_000;
    public static final int DEFAULT_OTP_INSTITUTE_HOURLY_CAP = 300;
    public static final int MIN_OTP_INSTITUTE_HOURLY_CAP = 10;
    public static final int MAX_OTP_INSTITUTE_HOURLY_CAP = 2000;
    public static final int DEFAULT_COD_MAX_OPEN_ORDERS_PER_PHONE = 2;
    public static final int MAX_COD_MAX_OPEN_ORDERS_PER_PHONE = 20;
    public static final int DEFAULT_COD_MAX_REFUSALS = 2;
    public static final int MAX_COD_MAX_REFUSALS = 20;

    /** The settings without the checkout keys: buyer identity and OTP cap take their defaults. */
    public StorefrontSettings(String baseLocale, int lowStockThreshold, String leadMediaTag,
                              List<BigDecimal> priceBands, Map<String, String> dispatchPromise, Cod cod,
                              String pricingRulesJson, int maxOrderQuantity, List<String> mediaTags) {
        this(baseLocale, lowStockThreshold, leadMediaTag, priceBands, dispatchPromise, cod, pricingRulesJson,
                maxOrderQuantity, mediaTags, BuyerIdentity.DEFAULT, DEFAULT_OTP_INSTITUTE_HOURLY_CAP);
    }

    /** Cash on delivery: off unless the seller switched it on. */
    public record Cod(boolean enabled, BigDecimal maxOrderValue, BigDecimal staffConfirmThreshold,
                      Set<String> blockedPincodes, int maxOpenOrdersPerPhone, int maxRefusals) {

        /** Without the two per-phone limits: they take their defaults. */
        public Cod(boolean enabled, BigDecimal maxOrderValue, BigDecimal staffConfirmThreshold,
                   Set<String> blockedPincodes) {
            this(enabled, maxOrderValue, staffConfirmThreshold, blockedPincodes, DEFAULT_COD_MAX_OPEN_ORDERS_PER_PHONE,
                    DEFAULT_COD_MAX_REFUSALS);
        }
    }

    public static StorefrontSettings defaults() {
        return new StorefrontSettings(DEFAULT_BASE_LOCALE, DEFAULT_LOW_STOCK_THRESHOLD, null, List.of(), Map.of(),
                new Cod(false, DEFAULT_COD_MAX_ORDER_VALUE, DEFAULT_COD_STAFF_CONFIRM_THRESHOLD, Set.of()), null,
                DEFAULT_MAX_ORDER_QUANTITY, List.of(), BuyerIdentity.DEFAULT, DEFAULT_OTP_INSTITUTE_HOURLY_CAP);
    }

    /** The same settings with the base language of the shop's site. */
    public StorefrontSettings withBaseLocale(String locale) {
        if (locale == null || locale.isBlank() || locale.trim().equalsIgnoreCase(baseLocale)) {
            return this;
        }
        return new StorefrontSettings(locale.trim().toLowerCase(Locale.ROOT), lowStockThreshold, leadMediaTag,
                priceBands, dispatchPromise, cod, pricingRulesJson, maxOrderQuantity, mediaTags, buyerIdentity,
                otpInstituteHourlyCap, refundShippingOnRto);
    }

    /**
     * The tags the product editor offers for a photo: the institute's list with the lead tag in
     * it, or the built-in three when the institute has neither.
     */
    public List<String> offeredMediaTags() {
        List<String> tags = new ArrayList<>();
        if (leadMediaTag != null) {
            tags.add(leadMediaTag.toUpperCase(Locale.ROOT));
        }
        for (String tag : mediaTags) {
            if (!tags.contains(tag)) {
                tags.add(tag);
            }
        }
        return tags.isEmpty() ? DEFAULT_MEDIA_TAGS : List.copyOf(tags);
    }

    /** The largest quantity of one cart line in base units, for a product with this quantity scale. */
    public long maxLineBaseUnits(int qtyScale) {
        return (long) maxOrderQuantity * Math.max(1, qtyScale);
    }

    /** Reads the setting blob; {@code null} or a non-object gives the defaults. */
    public static StorefrontSettings parse(JsonNode root) {
        if (root == null || !root.isObject()) {
            return defaults();
        }
        String baseLocale = text(root.path("baseLocale"));
        baseLocale = baseLocale == null ? DEFAULT_BASE_LOCALE : baseLocale.toLowerCase(Locale.ROOT);

        int threshold = DEFAULT_LOW_STOCK_THRESHOLD;
        BigDecimal rawThreshold = number(root.path("lowStockThreshold"));
        if (rawThreshold != null && rawThreshold.signum() >= 0
                && rawThreshold.compareTo(BigDecimal.valueOf(MAX_LOW_STOCK_THRESHOLD)) <= 0) {
            threshold = rawThreshold.intValue();
        }

        List<BigDecimal> bands = new ArrayList<>();
        if (root.path("priceBands").isArray()) {
            for (JsonNode band : root.path("priceBands")) {
                BigDecimal value = number(band);
                if (value != null && value.signum() > 0) {
                    bands.add(value.setScale(2, RoundingMode.HALF_UP));
                }
            }
            bands.sort(BigDecimal::compareTo);
        }

        Map<String, String> promise = new LinkedHashMap<>();
        JsonNode promiseNode = root.path("dispatchPromise");
        if (promiseNode.isObject()) {
            promiseNode.fields().forEachRemaining(e -> {
                String value = text(e.getValue());
                if (value != null) {
                    promise.put(e.getKey().toLowerCase(Locale.ROOT), value);
                }
            });
        } else if (text(promiseNode) != null) {
            promise.put(baseLocale, text(promiseNode));
        }

        JsonNode codNode = root.path("cod");
        BigDecimal max = positive(number(codNode.path("maxOrderValue")), DEFAULT_COD_MAX_ORDER_VALUE);
        BigDecimal confirm = positive(number(codNode.path("staffConfirmThreshold")),
                DEFAULT_COD_STAFF_CONFIRM_THRESHOLD);
        Set<String> blocked = new LinkedHashSet<>();
        if (codNode.path("blockedPincodes").isArray()) {
            for (JsonNode pin : codNode.path("blockedPincodes")) {
                String value = pin.isNumber() ? pin.asText() : text(pin);
                if (value != null && blocked.size() < MAX_BLOCKED_PINCODES) {
                    blocked.add(value.replace(" ", ""));
                }
            }
        }
        // Only a real JSON true switches COD on; "yes", 1 or a broken value leave it off.
        Cod cod = new Cod(codNode.path("enabled").isBoolean() && codNode.path("enabled").asBoolean(),
                max, confirm, Set.copyOf(blocked),
                bounded(number(codNode.path("maxOpenOrdersPerPhone")), 1, MAX_COD_MAX_OPEN_ORDERS_PER_PHONE,
                        DEFAULT_COD_MAX_OPEN_ORDERS_PER_PHONE),
                bounded(number(codNode.path("maxRefusals")), 0, MAX_COD_MAX_REFUSALS, DEFAULT_COD_MAX_REFUSALS));

        String rules = null;
        if (root.path("offers").isObject() || root.path("basketPricing").isObject()) {
            ObjectNode only = ((ObjectNode) root).objectNode();
            if (root.path("offers").isObject()) {
                only.set("offers", root.path("offers"));
            }
            if (root.path("basketPricing").isObject()) {
                only.set("basketPricing", root.path("basketPricing"));
            }
            rules = only.toString();
        }
        int maxQuantity = DEFAULT_MAX_ORDER_QUANTITY;
        BigDecimal rawMax = number(root.path("maxOrderQuantity"));
        if (rawMax != null && rawMax.compareTo(BigDecimal.ONE) >= 0
                && rawMax.compareTo(BigDecimal.valueOf(MAX_MAX_ORDER_QUANTITY)) <= 0) {
            maxQuantity = rawMax.intValue();
        }

        List<String> tags = new ArrayList<>();
        if (root.path("mediaTags").isArray()) {
            for (JsonNode tag : root.path("mediaTags")) {
                String value = text(tag);
                if (value != null && value.length() <= 32 && tags.size() < MAX_MEDIA_TAGS
                        && !tags.contains(value.toUpperCase(Locale.ROOT))) {
                    tags.add(value.toUpperCase(Locale.ROOT));
                }
            }
        }
        BuyerIdentity buyerIdentity = BuyerIdentity.parse(text(root.path("buyerIdentity")));
        int otpCap = bounded(number(root.path("otp").path("instituteHourlyCap")), MIN_OTP_INSTITUTE_HOURLY_CAP,
                MAX_OTP_INSTITUTE_HOURLY_CAP, DEFAULT_OTP_INSTITUTE_HOURLY_CAP);
        // Only a real JSON false keeps the delivery charge; anything else refunds it.
        JsonNode refundShipping = root.path("orders").path("refundShippingOnRto");
        boolean refundShippingOnRto = !(refundShipping.isBoolean() && !refundShipping.asBoolean());
        return new StorefrontSettings(baseLocale, threshold, text(root.path("leadMediaTag")), List.copyOf(bands),
                Map.copyOf(promise), cod, rules, maxQuantity, List.copyOf(tags), buyerIdentity, otpCap,
                refundShippingOnRto);
    }

    /** A whole number within [min, max]; anything else (a fraction too) is the fallback. */
    private static int bounded(BigDecimal value, int min, int max, int fallback) {
        if (value == null || value.stripTrailingZeros().scale() > 0) {
            return fallback;
        }
        if (value.compareTo(BigDecimal.valueOf(min)) < 0 || value.compareTo(BigDecimal.valueOf(max)) > 0) {
            return fallback;
        }
        return value.intValue();
    }

    private static BigDecimal positive(BigDecimal value, BigDecimal fallback) {
        return value != null && value.signum() > 0 ? value.setScale(2, RoundingMode.HALF_UP) : fallback;
    }

    private static String text(JsonNode node) {
        if (node == null || !node.isTextual()) {
            return null;
        }
        String trimmed = node.asText().trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** A number, or a string holding one; anything else is null. */
    private static BigDecimal number(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.isNumber()) {
            return node.decimalValue();
        }
        if (node.isTextual()) {
            try {
                return new BigDecimal(node.asText().trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }
}
