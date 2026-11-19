package vacademy.io.admin_core_service.features.commerce.common;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * How a quantity and a rate are printed. Quantities are stored in base units: 1/{@code qty_scale}
 * of the unit (10 cm for a metre at scale 10). A measured item ({@code qty_scale > 1}) prints in
 * its display unit with a short sign ("2.5 m"); a counted item keeps its old text ("2 PCS").
 *
 * <p>The stored unit code stays the GST unit code (MTR); only the printed sign changes. The admin
 * screens keep the same table in {@code commerce/-shared/units.ts}.
 */
public final class CommerceUnits {

    private static final Map<String, String> SIGNS = Map.ofEntries(
            Map.entry("MTR", "m"),
            Map.entry("M", "m"),
            Map.entry("METER", "m"),
            Map.entry("METRE", "m"),
            Map.entry("CM", "cm"),
            Map.entry("CMS", "cm"),
            Map.entry("KG", "kg"),
            Map.entry("KGS", "kg"),
            Map.entry("G", "g"),
            Map.entry("GM", "g"),
            Map.entry("GMS", "g"),
            Map.entry("LTR", "l"),
            Map.entry("L", "l"),
            Map.entry("ML", "ml"),
            Map.entry("MLT", "ml"));

    /**
     * Codes that count pieces: no sign after the number, and never the unit of a measured item.
     * The same list as the admin ({@code -shared/units.ts}) and the shop ({@code logic/format.ts}).
     */
    public static final Set<String> PIECE_CODES = Set.of("PCS", "PC", "NOS", "NO", "PIECE", "PIECES");

    /** The shop's Hindi short words for the signs it names ("मी" for a metre); other signs print as they are. */
    private static final Map<String, String> HINDI_SIGNS = Map.of(
            "m", "मी",
            "kg", "किग्रा",
            "cm", "सेमी",
            "g", "ग्राम",
            "l", "ली",
            "ml", "मिली");

    /**
     * The largest quantity in base units a stock request may name (receipt, transfer, adjustment,
     * count, reorder level): 1,000 km of cloth at scale 10, 10 t at scale 1000, well inside an
     * {@code int}. A sale or return line stays at 100,000 base units.
     */
    public static final int MAX_BASE_UNITS = 10_000_000;

    private CommerceUnits() {
    }

    /**
     * The printed sign of a unit code ("MTR" gives "m"); null for a piece code ({@link #PIECE_CODES})
     * and a blank code.
     */
    public static String sign(String unit) {
        if (unit == null || unit.isBlank()) {
            return null;
        }
        String code = unit.trim().toUpperCase(Locale.ROOT);
        if (PIECE_CODES.contains(code)) {
            return null;
        }
        return SIGNS.getOrDefault(code, code.toLowerCase(Locale.ROOT));
    }

    /** Whether a unit code can carry a measured item: not blank and not a piece code. */
    public static boolean measuredUnit(String unit) {
        return sign(unit) != null;
    }

    /** The sign in Hindi, as the shop prints it ("मी" for MTR); a sign the shop has no word for as in English. */
    public static String hindiSign(String unit) {
        String sign = sign(unit);
        return sign == null ? null : HINDI_SIGNS.getOrDefault(sign, sign);
    }

    /** The scales a product may have: 1 (counted), 10, 100 or 1000 (measured). */
    public static boolean allowedScale(int qtyScale) {
        return qtyScale == 1 || qtyScale == 10 || qtyScale == 100 || qtyScale == 1000;
    }

    /** Is a line of this scale measured (sold by length, weight or volume)? */
    public static boolean measured(int qtyScale) {
        return qtyScale > 1;
    }

    /**
     * The number of display units in {@code base} base units, trailing zeros dropped: 25 at scale 10
     * gives "2.5", 30 gives "3", 7 at scale 100 gives "0.07". Scale 1 (or less) gives the base count.
     */
    public static String number(long base, int qtyScale) {
        int scale = Math.max(qtyScale, 1);
        if (scale == 1) {
            return Long.toString(base);
        }
        BigDecimal shown = BigDecimal.valueOf(base)
                .divide(BigDecimal.valueOf(scale), decimals(scale), RoundingMode.HALF_UP)
                .stripTrailingZeros();
        return (shown.scale() < 0 ? shown.setScale(0) : shown).toPlainString();
    }

    /**
     * A quantity as printed on paper: "2.5 m" for 25 base units of a scale-10 MTR item; for a
     * scale-1 item the old text, the count and the raw code ("2 PCS", or "2" with no unit).
     */
    public static String quantity(long base, int qtyScale, String unit) {
        String number = number(base, qtyScale);
        if (measured(qtyScale)) {
            String sign = sign(unit);
            return sign == null ? number : number + " " + sign;
        }
        return unit == null || unit.isBlank() ? number : number + " " + unit.trim();
    }

    /**
     * A quantity in a short list (emails, screens): "2.5 m" for a measured line, the bare count
     * ("2") for a counted one.
     */
    public static String shortQuantity(long base, int qtyScale, String unit) {
        return measured(qtyScale) ? quantity(base, qtyScale, unit) : number(base, qtyScale);
    }

    /**
     * {@link #shortQuantity} for a reader of Hindi: "2.5 मी" as the shop prints it. The bare count
     * for a counted line, as in English.
     */
    public static String shortQuantityHindi(long base, int qtyScale, String unit) {
        if (!measured(qtyScale)) {
            return number(base, qtyScale);
        }
        String sign = hindiSign(unit);
        String number = number(base, qtyScale);
        return sign == null ? number : number + " " + sign;
    }

    /** The price of one display unit: the per-base-unit price × scale, to paise (12.34 at scale 10 gives 123.40). */
    public static BigDecimal perUnit(BigDecimal basePrice, int qtyScale) {
        if (basePrice == null) {
            return null;
        }
        return basePrice.multiply(BigDecimal.valueOf(Math.max(qtyScale, 1))).setScale(2, RoundingMode.HALF_UP);
    }

    /** What follows a rate: " / m" for a measured line, nothing for a counted one. */
    public static String rateSuffix(int qtyScale, String unit) {
        if (!measured(qtyScale)) {
            return "";
        }
        String sign = sign(unit);
        return sign == null ? "" : " / " + sign;
    }

    /** Decimals a display value of this scale can need: 1 at 10, 2 at 100, 3 at 1000 (3 for any other scale). */
    public static int decimals(int qtyScale) {
        return switch (Math.max(qtyScale, 1)) {
            case 1 -> 0;
            case 10 -> 1;
            case 100 -> 2;
            default -> 3;
        };
    }
}
