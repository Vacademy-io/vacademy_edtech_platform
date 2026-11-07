package vacademy.io.admin_core_service.features.product_page.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Prices a basket as a WHOLE, instead of adding up what each course costs.
 *
 * Some catalogues do not sell courses at a price each — they sell "pick any 3
 * for ₹799, ₹150 for each one after that". iThinkers Olympiad is one: every
 * course on the page is ₹0 because the money is a function of how many subjects
 * the parent picks, not which. Summing item prices there yields ₹0 forever, so
 * when this is configured it REPLACES the sum rather than discounting it.
 *
 * Configured under `basketPricing` in the product page's settings_json:
 *
 *   pricingBasis      FLAT (default) reads `ladder` as ABSOLUTE prices — the
 *                     only thing that works when the courses are ₹0 and carry
 *                     no price to discount. DISCOUNT reads `tiers` as a
 *                     reduction off what the selected courses actually cost on
 *                     their enroll invites, so the money has ONE source: the
 *                     payment plan. Prefer DISCOUNT wherever the courses are
 *                     priced — under FLAT the single-subject rate is written
 *                     down twice (here and on the plan) and the two drift.
 *   tiers             for DISCOUNT. Each is
 *                       {minCourses?, minAmount?, maxAmount?,
 *                        type: PERCENT|AMOUNT, value, maxDiscount?}
 *                     gated on count, on spend, or on both (both must hold
 *                     when both are set). maxAmount closes a band; maxDiscount
 *                     caps a percentage. The BEST qualifying tier wins, so a
 *                     bigger basket never loses a discount it had.
 *   ladder            prices[] for a basket of 1, 2, 3 … plus perExtra for each
 *                     one beyond the last listed price. FLAT basis only.
 *   groups            label → the level names belonging to it. No groups
 *                     configured means the whole basket is one group.
 *   ladderScope       GROUP (default) runs the ladder inside each group, so a
 *                     parent buying one subject each for two children pays two
 *                     single-subject prices rather than collecting a sibling
 *                     discount. BASKET runs it across everything, so those two
 *                     subjects reach the two-subject price. Which one is right
 *                     is a commercial decision, not a technical one — hence the
 *                     switch. Full packs and combos stay per-group either way,
 *                     because a "full grade pack" only means something within
 *                     one grade.
 *   groups[].packPrice  price for taking EVERY level in that group — the "full
 *                     grade pack". Exact per group, so it keeps working when a
 *                     class gains or loses a subject.
 *   wholeGroupPrices  count → price, the older fallback for groups with no
 *                     packPrice of their own. Fragile: a class that gains a
 *                     subject lands on a different count's price.
 *   combos            a named set of package names at a fixed price, matched
 *                     within a group ("English + Maths + Science = ₹749").
 *                     Matched on package rather than level so one entry covers
 *                     every class.
 *
 * Whichever of those yields the LOWEST price for a group wins — a bigger
 * selection must never cost more than a smaller one.
 *
 * Groups are matched against admin-authored level lists, never by parsing a
 * class out of a level name: the real names drift ("Cyber AI- Class 6",
 * "Social Science Class - 5") and one course is filed under another subject's
 * level entirely.
 *
 * THIS IS THE AUTHORITATIVE COPY — ProductPageEnrollmentService overwrites the
 * client's amount with what this returns. basket-pricing.ts mirrors it for
 * display and the two must be changed together.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class BasketPricingCalculator {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * One selected course. `price` is what its payment plan charges on the
     * enroll invite — the base a DISCOUNT basis reduces, and the honest
     * "before" figure the checkout shows even under a FLAT basis.
     */
    public record BasketItem(String levelName, String packageName, double price) {
        /** Kept for callers that price on count alone (FLAT pages with ₹0 courses). */
        public BasketItem(String levelName, String packageName) {
            this(levelName, packageName, 0d);
        }
    }

    /** What a basket costs, and the per-group breakdown behind it. */
    @Getter
    public static class BasketPrice {
        private final double total;
        /**
         * What the same courses cost bought separately. The checkout needs it to
         * say "₹1,047 → ₹799, you save ₹248" instead of quoting a bare ₹799 the
         * parent has no way to judge.
         */
        private final double itemTotal;
        private final List<String> breakdown = new ArrayList<>();
        /**
         * The rule that priced each item, in the order the items were passed in
         * ("Class 5 — EMS combo + 1 more", "Class 5 — full pack", "Class 5 — 4
         * subjects"). The caller books a per-course reduction on the learner's
         * invoice and needs to say WHY it is there; taking the reason from the
         * engine that decided it means the label always names the rule the admin
         * actually configured, instead of a phrase hard-coded somewhere else.
         */
        private final List<String> itemLabels = new ArrayList<>();

        BasketPrice(double total, double itemTotal) {
            this.total = total;
            this.itemTotal = itemTotal;
        }
    }

    private static String key(String value) {
        return value == null ? "" : value.trim().toLowerCase();
    }

    /**
     * The basket's price, or null when this page does not use basket pricing —
     * in which case the caller keeps summing item prices as before.
     */
    public BasketPrice price(String settingsJson, List<BasketItem> items) {
        if (settingsJson == null || settingsJson.isBlank() || items == null || items.isEmpty()) {
            return null;
        }

        try {
            JsonNode cfg = objectMapper.readTree(settingsJson).path("basketPricing");
            if (!cfg.path("enabled").asBoolean(false)) {
                return null;
            }

            List<Double> ladder = new ArrayList<>();
            for (JsonNode p : cfg.path("ladder").path("prices")) {
                ladder.add(p.asDouble(0));
            }
            double perExtra = cfg.path("ladder").path("perExtra").asDouble(0);
            if (ladder.isEmpty() && !discountBasis(cfg)) {
                // A FLAT page prices by count alone, so an empty ladder has
                // nothing to price with. Better to fall back to item prices than
                // to hand back a free basket. A DISCOUNT page needs no ladder —
                // its base is what the courses cost on their enroll invites.
                return null;
            }

            Map<String, List<BasketItem>> grouped = groupItems(cfg.path("groups"), items);
            boolean ladderAcrossBasket = "BASKET".equalsIgnoreCase(cfg.path("ladderScope").asText("GROUP"));

            double total = 0;
            double itemTotal = 0;
            List<String> lines = new ArrayList<>();
            Map<String, String> labelByGroup = new LinkedHashMap<>();

            for (Map.Entry<String, List<BasketItem>> entry : grouped.entrySet()) {
                GroupQuote quote = priceGroup(cfg, entry.getKey(), entry.getValue(), ladder, perExtra);
                total += quote.amount;
                itemTotal += quote.baseAmount;
                lines.add(quote.label);
                labelByGroup.put(entry.getKey(), quote.label);
            }

            // Back to the ORIGINAL item order, so the caller can zip these
            // against the courses it passed in without re-deriving the grouping.
            Map<String, String> levelToGroup = levelToGroup(cfg.path("groups"));
            List<String> itemLabels = new ArrayList<>();
            for (BasketItem item : items) {
                String group = levelToGroup.getOrDefault(key(item.levelName()), "");
                itemLabels.add(labelByGroup.getOrDefault(group, ""));
            }

            if (ladderAcrossBasket) {
                // One ladder over every subject in the basket. Still never worse
                // than pricing the groups apart — a full pack or combo inside one
                // group can beat it, so take whichever is cheaper.
                double whole = discountBasis(cfg)
                        ? itemTotal - tierDiscount(cfg, itemTotal, items.size())
                        : ladderPrice(ladder, perExtra, items.size());
                if (whole < total) {
                    total = whole;
                    String wholeLabel = items.size() + " subject" + (items.size() == 1 ? "" : "s");
                    lines.clear();
                    lines.add(wholeLabel);
                    // One rule priced the whole basket, so it is every item's rule.
                    itemLabels.replaceAll(ignored -> wholeLabel);
                }
            }

            BasketPrice priced = new BasketPrice(
                    Math.max(0, Math.round(total)),
                    Math.max(0, Math.round(itemTotal)));
            priced.breakdown.addAll(lines);
            priced.itemLabels.addAll(itemLabels);
            return priced;

        } catch (Exception e) {
            // A page must stay sellable through a bad settings blob.
            log.warn("Could not read basketPricing from product page settings: {}", e.getMessage());
            return null;
        }
    }

    /** Which configured group each level name belongs to; unlisted levels share "". */
    private Map<String, String> levelToGroup(JsonNode groups) {
        Map<String, String> levelToGroup = new LinkedHashMap<>();
        if (groups.isArray()) {
            for (JsonNode group : groups) {
                String label = group.path("label").asText("");
                for (JsonNode level : group.path("levels")) {
                    levelToGroup.put(key(level.asText()), label);
                }
            }
        }
        return levelToGroup;
    }

    /** Splits the basket by configured group; anything unmatched shares one bucket. */
    private Map<String, List<BasketItem>> groupItems(JsonNode groups, List<BasketItem> items) {
        Map<String, List<BasketItem>> out = new LinkedHashMap<>();
        Map<String, String> levelToGroup = levelToGroup(groups);
        for (BasketItem item : items) {
            String label = levelToGroup.getOrDefault(key(item.levelName()), "");
            out.computeIfAbsent(label, k -> new ArrayList<>()).add(item);
        }
        return out;
    }

    private record GroupQuote(double amount, double baseAmount, String label) {
    }

    private boolean discountBasis(JsonNode cfg) {
        return "DISCOUNT".equalsIgnoreCase(cfg.path("pricingBasis").asText("FLAT"));
    }

    /**
     * What the courses in a group cost on their own.
     *
     * Falls back to the ladder's single-subject rate when the courses are ₹0 —
     * a FLAT page with free courses still needs SOMETHING to measure the saving
     * against, and the one-subject rung is the figure its own price card
     * advertises.
     */
    private double baseFor(List<BasketItem> picked, List<Double> ladder) {
        double sum = 0;
        for (BasketItem item : picked) {
            sum += item.price();
        }
        if (sum > 0) {
            return sum;
        }
        double single = ladder.isEmpty() ? 0 : ladder.get(0);
        return single * picked.size();
    }

    /**
     * The discount for this basket: the BEST of every tier it qualifies for.
     *
     * A tier is gated on how MANY courses (minCourses), on how MUCH they cost
     * (minAmount / maxAmount), or on both — and when both are set both must
     * hold, the same reading OfferCalculator gives the same two field names. A
     * closed band makes "₹500–₹999 → 10%, ₹1,000+ → 15%" expressible without
     * the two rules fighting.
     *
     * A PERCENT tier may carry maxDiscount, a ceiling in currency; absent or
     * zero means no ceiling, again matching OfferCalculator.
     *
     * Best, not highest-threshold: a tier list where a later rung happens to be
     * worth less ("2+ → ₹500 off, 5+ → 10% off") would otherwise take the
     * discount AWAY from a parent for adding a fifth subject. Picking the best
     * qualifying tier makes that misconfiguration merely useless rather than
     * punitive, and is identical for the normal increasing ladder.
     *
     * `base` is the group's own item total under GROUP scope, so an amount
     * threshold is judged against what THAT class costs — the same figure the
     * tier then discounts. Judging it against the whole basket would let one
     * child's subjects unlock a band for another's.
     */
    private double tierDiscount(JsonNode cfg, double base, int count) {
        double best = 0;
        for (JsonNode tier : cfg.path("tiers")) {
            if (!tierApplies(tier, base, count)) {
                continue;
            }
            best = Math.max(best, tierAmount(tier, base));
        }
        return Math.min(Math.max(0, best), base);
    }

    /** Whether a basket of this size and value reaches a tier's conditions. */
    private boolean tierApplies(JsonNode tier, double base, int count) {
        int minCourses = tier.path("minCourses").asInt(0);
        double minAmount = tier.path("minAmount").asDouble(0);
        // A tier with neither condition would fire on any basket at all,
        // including a single free course. Treat it as unconfigured rather than
        // as "always on" — an admin who wants that writes minCourses 1.
        if (minCourses <= 0 && minAmount <= 0) {
            return false;
        }
        if (minCourses > 0 && count < minCourses) {
            return false;
        }
        if (minAmount > 0 && base < minAmount) {
            return false;
        }
        double maxAmount = tier.path("maxAmount").asDouble(0);
        // Zero means open-ended, so only a positive ceiling closes the band.
        return !(maxAmount > 0 && base > maxAmount);
    }

    /** What a qualifying tier takes off, before the caller caps it at the base. */
    private double tierAmount(JsonNode tier, double base) {
        double value = tier.path("value").asDouble(0);
        if (value <= 0) {
            return 0;
        }
        double off = "PERCENT".equalsIgnoreCase(tier.path("type").asText("PERCENT"))
                ? base * value / 100.0
                : value;
        double cap = tier.path("maxDiscount").asDouble(0);
        if (cap > 0) {
            off = Math.min(off, cap);
        }
        return Math.max(0, off);
    }

    /**
     * What a set of courses costs under the page's ordinary rule - the ladder
     * under FLAT, the item sum less its best tier under DISCOUNT - before full
     * packs and combos get their turn at beating it.
     *
     * Factored out because a combo now prices its EXTENSION with it: growing a
     * matched combo by one subject must cost what growing any basket by one
     * subject costs, and the only honest source for that is this function.
     */
    private double ordinaryPrice(JsonNode cfg, List<BasketItem> picked,
            List<Double> ladder, double perExtra) {
        if (picked.isEmpty()) {
            return 0;
        }
        if (discountBasis(cfg)) {
            // The courses' own prices are the base, so the single-subject rate
            // lives in exactly one place: the payment plan on the enroll invite.
            double base = baseFor(picked, ladder);
            return base - tierDiscount(cfg, base, picked.size());
        }
        return ladderPrice(ladder, perExtra, picked.size());
    }

    private GroupQuote priceGroup(JsonNode cfg, String groupLabel, List<BasketItem> picked,
            List<Double> ladder, double perExtra) {
        int count = picked.size();
        double base = baseFor(picked, ladder);

        // Kept separate from `best`: a full pack may lower `best` below it, and
        // the combo extension below has to measure against the ORDINARY price
        // of this group, not against whatever rule is currently winning.
        double ordinary = ordinaryPrice(cfg, picked, ladder, perExtra);
        double best = ordinary;
        String how = count + " subject" + (count == 1 ? "" : "s");

        // Full pack: every level configured for this group is in the basket.
        Double wholeGroup = wholeGroupPrice(cfg, groupLabel, picked, count);
        if (wholeGroup != null && wholeGroup < best) {
            best = wholeGroup;
            how = "full pack";
        }

        // Named combo: the group CONTAINS a combo's packages.
        //
        // A subset, not an exact set. All-or-nothing matching is what made a
        // Class 5 basket jump by Rs 200 for the fourth subject: English+Maths+
        // Science took the Rs 749 EMS combo, adding G.K. stopped the combo
        // matching, and the basket fell back onto the plain Rs 949 rung - so a
        // page advertising "+Rs 150 for each extra subject" charged Rs 200.
        //
        // The extension is priced at exactly what this page charges to grow a
        // basket from the combo's size to this one, so the combo's own saving
        // rides along instead of evaporating: 749 + (949 - 799) = 899. At an
        // exact match the extension is 0, which is the old behaviour untouched.
        for (JsonNode combo : cfg.path("combos")) {
            Set<String> comboPackages = new LinkedHashSet<>();
            for (JsonNode name : combo.path("packages")) {
                comboPackages.add(key(name.asText()));
            }
            if (comboPackages.isEmpty()) {
                continue;
            }
            List<BasketItem> inCombo = new ArrayList<>();
            for (BasketItem item : picked) {
                if (comboPackages.contains(key(item.packageName()))) {
                    inCombo.add(item);
                }
            }
            // One basket line per named package, or the combo is ambiguous -
            // which of two courses sharing a package name did the price cover?
            if (inCombo.size() != comboPackages.size()) {
                continue;
            }
            double comboPrice = combo.path("price").asDouble(Double.MAX_VALUE);
            if (comboPrice == Double.MAX_VALUE) {
                continue;
            }
            double price = comboPrice + (ordinary - ordinaryPrice(cfg, inCombo, ladder, perExtra));
            if (price < best) {
                best = price;
                int extras = count - inCombo.size();
                how = combo.path("label").asText("combo") + (extras > 0 ? " + " + extras + " more" : "");
            }
        }

        String label = (groupLabel == null || groupLabel.isBlank() ? "Basket" : groupLabel)
                + " — " + how;
        // Under DISCOUNT the base IS the starting point, so a misconfigured tier
        // must never push the basket above it. Under FLAT the ladder deliberately
        // REPLACES the item sum in both directions — capping there would silently
        // reprice every existing page whose courses undercut its own ladder.
        if (discountBasis(cfg) && base > 0) {
            best = Math.min(best, base);
        }
        return new GroupQuote(best, base, label);
    }

    private Double wholeGroupPrice(JsonNode cfg, String groupLabel, List<BasketItem> picked, int count) {
        if (groupLabel == null || groupLabel.isBlank()) {
            return null;
        }
        Set<String> configured = new LinkedHashSet<>();
        Double ownPackPrice = null;
        for (JsonNode group : cfg.path("groups")) {
            if (groupLabel.equals(group.path("label").asText(""))) {
                for (JsonNode level : group.path("levels")) {
                    configured.add(key(level.asText()));
                }
                JsonNode own = group.path("packPrice");
                if (!own.isMissingNode() && own.asDouble(0) > 0) {
                    ownPackPrice = own.asDouble();
                }
            }
        }
        if (configured.isEmpty()) {
            return null;
        }
        Set<String> pickedLevels = new LinkedHashSet<>();
        for (BasketItem item : picked) {
            pickedLevels.add(key(item.levelName()));
        }
        if (!pickedLevels.containsAll(configured)) {
            return null;
        }
        // A price on the group itself is exact and survives the catalogue
        // changing shape. The count map is the older, fragile fallback: add one
        // subject to a class and its count silently lands on another class's
        // price.
        if (ownPackPrice != null) {
            return ownPackPrice;
        }
        JsonNode price = cfg.path("wholeGroupPrices").path(String.valueOf(count));
        return price.isMissingNode() ? null : price.asDouble();
    }

    /** prices[n-1] while the list lasts, then the last price plus perExtra each. */
    private double ladderPrice(List<Double> prices, double perExtra, int count) {
        if (count <= 0) {
            return 0;
        }
        if (count <= prices.size()) {
            return prices.get(count - 1);
        }
        return prices.get(prices.size() - 1) + perExtra * (count - prices.size());
    }
}
