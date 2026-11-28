package vacademy.io.admin_core_service.features.catalog_api.rules;

import java.util.List;

/**
 * What a course card says about price and availability.
 *
 * <p>Ports of {@code priceStateOf} and {@code editorialPriceRow}
 * ({@code -components/components/catalog/catalog-card-view.ts}), {@code isBuyableNowRow},
 * {@code cardPriceView} and the card's {@code sortPrice} ({@code catalog/catalog-cards.ts}) and
 * {@code resolveInviteAvailability} ({@code src/lib/invite-availability.ts}).
 */
public final class CatalogPricing {

    private CatalogPricing() {
    }

    public enum Kind { FREE, AMOUNT, COMING_SOON, NOT_STARTED, CLOSED, HIDDEN }

    /** The DISPLAYED version's price (no "from", no MRP), or its status. */
    public record PriceState(Kind kind, double amount, String currency, String launchDate) {
    }

    /** Server availability → AVAILABLE / EXPIRED / NOT_STARTED / INACTIVE; missing or unknown is AVAILABLE. */
    public static String resolveInviteAvailability(String raw) {
        if ("EXPIRED".equals(raw) || "NOT_STARTED".equals(raw) || "INACTIVE".equals(raw)) return raw;
        return "AVAILABLE";
    }

    public static PriceState priceStateOf(CatalogRow row, boolean paymentEnabled) {
        if (row.comingSoon() != null) return new PriceState(Kind.COMING_SOON, 0, null, row.comingSoon().launchDate());
        String availability = resolveInviteAvailability(row.enrollInviteAvailability());
        if ("NOT_STARTED".equals(availability)) return new PriceState(Kind.NOT_STARTED, 0, null, null);
        if (!"AVAILABLE".equals(availability)) return new PriceState(Kind.CLOSED, 0, null, null);
        double amount = row.price();
        if (amount == 0) return new PriceState(Kind.FREE, 0, row.currency(), null);
        if (!paymentEnabled) return new PriceState(Kind.HIDDEN, amount, row.currency(), null);
        return new PriceState(Kind.AMOUNT, amount, row.currency(), null);
    }

    /** The API's availability word for a price state. */
    public static String availabilityOf(PriceState state) {
        return switch (state.kind()) {
            case COMING_SOON -> "coming_soon";
            case NOT_STARTED -> "not_started";
            case CLOSED -> "closed";
            default -> "available";
        };
    }

    /** A version that can be bought right now: not coming soon, and its enrolment window is open. */
    public static boolean isBuyableNow(CatalogRow row) {
        return row.comingSoon() == null
                && "AVAILABLE".equals(resolveInviteAvailability(row.enrollInviteAvailability()));
    }

    /** The version a merged card's price area shows, the lowest price on offer, and whether prices differ. */
    public record CardPriceView(CatalogRow row, double minPrice, boolean from) {
    }

    /**
     * The versions in {@code rows} that can be bought now; null when none can (the card then
     * shows its own version's status).
     */
    public static CardPriceView cardPriceView(CatalogRow primary, List<CatalogRow> rows) {
        List<CatalogRow> buyable = rows.stream().filter(CatalogPricing::isBuyableNow).toList();
        if (buyable.isEmpty()) return null;
        double min = Double.POSITIVE_INFINITY;
        double max = Double.NEGATIVE_INFINITY;
        for (CatalogRow r : buyable) {
            min = Math.min(min, r.price());
            max = Math.max(max, r.price());
        }
        final double minPrice = min;
        CatalogRow row = buyable.stream().filter(r -> r == primary && r.price() == minPrice).findFirst()
                .orElseGet(() -> buyable.stream().filter(r -> r.price() == minPrice).findFirst().orElse(buyable.get(0)));
        return new CardPriceView(row, minPrice, minPrice != max);
    }

    /**
     * Which version a merged card prices by: under a price sort the cheapest buyable one; else
     * the displayed version when it matches the filters and can be bought now; else the matched
     * one. Null = price the primary.
     */
    public static CatalogRow editorialPriceRow(CatalogRow primary, CardPriceView view, List<CatalogRow> matchingRows,
                                               boolean priceSort) {
        if (view == null) return null;
        if (priceSort) return view.row();
        if (matchingRows.contains(primary) && isBuyableNow(primary)) return primary;
        return view.row();
    }

    /** Price used by the price sorts: the lowest buyable price, else the lowest version price. */
    public static double sortPrice(List<CatalogRow> rows) {
        double min = Double.POSITIVE_INFINITY;
        boolean any = false;
        for (CatalogRow r : rows) {
            if (isBuyableNow(r)) {
                min = Math.min(min, r.price());
                any = true;
            }
        }
        if (any) return min;
        for (CatalogRow r : rows) min = Math.min(min, r.price());
        return rows.isEmpty() ? 0 : min;
    }
}
