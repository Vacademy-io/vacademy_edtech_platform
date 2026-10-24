package vacademy.io.admin_core_service.features.fee_management.service;

import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Decides which installments a whole-plan (CPO) discount comes off, for every way of taking it
 * except the original one ({@link #ALL_PROPORTIONAL}: every installment, paid or not, in
 * proportion to its amount — still computed live in {@link CpoDiscountService}).
 *
 * <p>The other ways only touch what is still unpaid. An installment already settled (paid in
 * full, or waived) keeps exactly the discount it carries now, so it neither drops below what
 * was paid nor reopens; the rest of the discount is spread over the open installments, never
 * taking one below what has been paid on it. The result is frozen into per-installment amounts
 * when the discount is applied: a later payment must not move the discount around.
 */
public final class CpoDiscountAllocator {

    /** Original behaviour: every installment in proportion to its amount, re-derived on each edit. */
    public static final String ALL_PROPORTIONAL = "ALL_PROPORTIONAL";
    /** Unpaid installments, in proportion to what is still owed on each. */
    public static final String UNPAID_PROPORTIONAL = "UNPAID_PROPORTIONAL";
    /** Unpaid installments, the same amount off each (as far as each one allows). */
    public static final String UNPAID_EQUAL = "UNPAID_EQUAL";
    /** From the last installment backwards until the discount is used up. */
    public static final String LAST_FIRST = "LAST_FIRST";
    /** From the next installment due onwards until the discount is used up. */
    public static final String NEXT_FIRST = "NEXT_FIRST";
    /** The admin says how much comes off each installment. */
    public static final String CUSTOM = "CUSTOM";

    public static final Set<String> MODES = Set.of(
            ALL_PROPORTIONAL, UNPAID_PROPORTIONAL, UNPAID_EQUAL, LAST_FIRST, NEXT_FIRST, CUSTOM);

    private static final int SCALE = 2;
    private static final RoundingMode RM = RoundingMode.HALF_UP;

    private CpoDiscountAllocator() {
    }

    /**
     * One installment as the allocator sees it. {@code amount} is its value before the plan
     * discount; {@code currentShare} the plan discount on it now; {@code settled} = paid in full
     * or waived.
     */
    public record Row(String id, BigDecimal amount, BigDecimal paid, LocalDate dueDate, boolean settled,
                      BigDecimal currentShare) {

        /** What can still come off this installment without dropping it below what was paid. */
        BigDecimal room() {
            if (settled) return BigDecimal.ZERO;
            BigDecimal r = nz(amount).subtract(nz(paid));
            return r.signum() < 0 ? BigDecimal.ZERO : r.setScale(SCALE, RM);
        }
    }

    /** {@code null}, blank or unknown → the original behaviour. */
    public static String normalizeMode(String mode) {
        if (mode == null || mode.isBlank()) return ALL_PROPORTIONAL;
        String m = mode.trim().toUpperCase(Locale.ROOT);
        if (!MODES.contains(m)) {
            throw new VacademyException("Unknown way to apply the discount: " + mode);
        }
        return m;
    }

    /**
     * Shares of {@code requested} for a frozen mode (not {@link #ALL_PROPORTIONAL}). The total
     * is capped at what is still unpaid; ids absent from the result get nothing.
     *
     * @param custom per-installment amounts for {@link #CUSTOM}; ignored otherwise
     */
    public static Map<String, BigDecimal> allocate(String mode, List<Row> rows, BigDecimal requested,
                                                   Map<String, BigDecimal> custom) {
        String m = normalizeMode(mode);
        if (ALL_PROPORTIONAL.equals(m)) {
            throw new IllegalArgumentException("ALL_PROPORTIONAL is computed live, not allocated");
        }
        // Settled installments keep what they carry; only the rest is spread.
        Map<String, BigDecimal> kept = new LinkedHashMap<>();
        BigDecimal keptTotal = BigDecimal.ZERO;
        for (Row r : rows) {
            BigDecimal share = nz(r.currentShare()).setScale(SCALE, RM);
            if (r.settled() && share.signum() > 0) {
                kept.put(r.id(), share);
                keptTotal = keptTotal.add(share);
            }
        }
        BigDecimal capacity = rows.stream().map(Row::room).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (CUSTOM.equals(m)) {
            return merge(rows, kept, custom(rows, custom));
        }
        BigDecimal wanted = nz(requested).setScale(SCALE, RM);
        if (wanted.compareTo(keptTotal) < 0) {
            throw new VacademyException(keptTotal.toPlainString()
                    + " of the current discount is on installments already paid. Enter at least that,"
                    + " or choose all installments to take it back from them.");
        }
        BigDecimal total = wanted.subtract(keptTotal).min(capacity);
        if (capacity.signum() == 0 && wanted.compareTo(keptTotal) > 0) {
            throw new VacademyException("Nothing is left unpaid on this plan, so there is nothing more to discount");
        }
        if (total.signum() <= 0) return merge(rows, kept, Map.of());
        Map<String, BigDecimal> spread = switch (m) {
            case UNPAID_PROPORTIONAL -> proportional(rows, total, capacity);
            case UNPAID_EQUAL -> equal(rows, total);
            case LAST_FIRST -> waterfall(rows, total, true);
            case NEXT_FIRST -> waterfall(rows, total, false);
            default -> throw new IllegalStateException(m);
        };
        return merge(rows, kept, spread);
    }

    private static Map<String, BigDecimal> merge(List<Row> rows, Map<String, BigDecimal> kept,
                                                 Map<String, BigDecimal> spread) {
        Map<String, BigDecimal> all = new LinkedHashMap<>(spread);
        kept.forEach((id, v) -> all.merge(id, v, BigDecimal::add));
        return ordered(rows, all);
    }

    /** The open installments' amounts as typed; a settled one may only repeat what it carries. */
    private static Map<String, BigDecimal> custom(List<Row> rows, Map<String, BigDecimal> custom) {
        Map<String, Row> byId = new LinkedHashMap<>();
        rows.forEach(r -> byId.put(r.id(), r));
        Map<String, BigDecimal> in = custom == null ? Map.of() : custom;
        for (String id : in.keySet()) {
            if (!byId.containsKey(id)) throw new VacademyException("Installment not in this plan: " + id);
        }
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        BigDecimal sum = BigDecimal.ZERO;
        for (Row r : rows) {
            BigDecimal v = in.get(r.id());
            if (r.settled()) {
                if (v != null && v.setScale(SCALE, RM).compareTo(nz(r.currentShare()).setScale(SCALE, RM)) != 0) {
                    throw new VacademyException("An installment that is already paid keeps its discount");
                }
                sum = sum.add(nz(r.currentShare()));
                continue;
            }
            if (v == null || v.signum() == 0) continue;
            if (v.signum() < 0) throw new VacademyException("A discount amount cannot be negative");
            BigDecimal share = v.setScale(SCALE, RM);
            if (share.compareTo(r.room()) > 0) {
                throw new VacademyException("Only " + r.room().toPlainString()
                        + " is unpaid on an installment you gave " + share.toPlainString() + " off");
            }
            out.put(r.id(), share);
            sum = sum.add(share);
        }
        if (sum.signum() == 0) throw new VacademyException("Enter how much comes off at least one installment");
        return out;
    }

    private static Map<String, BigDecimal> proportional(List<Row> rows, BigDecimal total, BigDecimal capacity) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        List<Row> open = rows.stream().filter(r -> r.room().signum() > 0).toList();
        Row absorber = open.stream().max(byDue()).orElseThrow();
        BigDecimal allocated = BigDecimal.ZERO;
        for (Row r : open) {
            if (r == absorber) continue;
            BigDecimal share = r.room().multiply(total).divide(capacity, SCALE, RM);
            out.put(r.id(), share);
            allocated = allocated.add(share);
        }
        out.put(absorber.id(), total.subtract(allocated).min(absorber.room()).max(BigDecimal.ZERO));
        return ordered(rows, out);
    }

    /** Equal shares in paise; an installment with less room takes all it has and the rest is re-shared. */
    private static Map<String, BigDecimal> equal(List<Row> rows, BigDecimal total) {
        List<Row> open = new ArrayList<>(rows.stream().filter(r -> r.room().signum() > 0).toList());
        open.sort(Comparator.comparing(Row::room));
        long rest = toPaise(total);
        Map<String, Long> paise = new LinkedHashMap<>();
        for (int i = 0; i < open.size(); i++) {
            long fair = rest / (open.size() - i);
            long take = Math.min(toPaise(open.get(i).room()), fair);
            paise.put(open.get(i).id(), take);
            rest -= take;
        }
        // Leftover paise from the division go one each to the latest-due installments with room.
        List<Row> latestFirst = new ArrayList<>(open);
        latestFirst.sort(byDue().reversed());
        while (rest > 0) {
            boolean placed = false;
            for (Row r : latestFirst) {
                if (rest == 0) break;
                long cur = paise.get(r.id());
                if (cur < toPaise(r.room())) {
                    paise.put(r.id(), cur + 1);
                    rest--;
                    placed = true;
                }
            }
            if (!placed) break;
        }
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        paise.forEach((id, p) -> out.put(id, BigDecimal.valueOf(p, SCALE)));
        return ordered(rows, out);
    }

    private static Map<String, BigDecimal> waterfall(List<Row> rows, BigDecimal total, boolean lastFirst) {
        List<Row> open = new ArrayList<>(rows.stream().filter(r -> r.room().signum() > 0).toList());
        open.sort(lastFirst ? byDue().reversed() : byDue());
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        BigDecimal rest = total;
        for (Row r : open) {
            if (rest.signum() <= 0) break;
            BigDecimal take = r.room().min(rest);
            out.put(r.id(), take);
            rest = rest.subtract(take);
        }
        return ordered(rows, out);
    }

    /** Due date order; an installment with no due date counts as due first (paid upfront). */
    private static Comparator<Row> byDue() {
        return Comparator.comparing(Row::dueDate, Comparator.nullsFirst(Comparator.<LocalDate>naturalOrder()))
                .thenComparing(Row::id);
    }

    /** Same order as the plan's rows, zero shares dropped. */
    private static Map<String, BigDecimal> ordered(List<Row> rows, Map<String, BigDecimal> shares) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        for (Row r : rows) {
            BigDecimal s = shares.get(r.id());
            if (s != null && s.signum() > 0) out.put(r.id(), s.setScale(SCALE, RM));
        }
        return out;
    }

    private static long toPaise(BigDecimal v) {
        return v.setScale(SCALE, RM).movePointRight(SCALE).longValueExact();
    }

    private static BigDecimal nz(BigDecimal b) {
        return b == null ? BigDecimal.ZERO : b;
    }
}
