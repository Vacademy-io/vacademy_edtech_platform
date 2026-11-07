package vacademy.io.admin_core_service.features.fee_management.service;

import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Turns one admission package — several courses sold together, with one schedule and one
 * discount — into what each course already understands: its own installment rows (due date,
 * gross amount, discount) and its share of the money paid at admission.
 *
 * <p>Each package installment is split across the courses in proportion to their fees, and so
 * is its discount. The split is exact in both directions: every course's rows add up to that
 * course's fee, and every package installment's parts add up to the installment. Amounts are in
 * whole rupees when the inputs are, otherwise in paise. The course with the largest fee absorbs
 * the rounding, so its share moves by at most a rupee per installment.
 *
 * <p>Money is placed installment by installment, earliest due first: an installment is paid off
 * across every course before the next one is touched, and a part-payment of an installment is
 * shared between the courses in proportion to what each still owes on it. That is what each
 * course's own oldest-first allocation then does with its share, both for the payment taken at
 * admission ({@link #split}) and for a later package payment ({@link #allocatePayment}). Pure and
 * free of I/O: see AdmissionPackageSplitterTest.
 */
public final class AdmissionPackageSplitter {

    private AdmissionPackageSplitter() {
    }

    /** One package installment: due date, gross amount and the discount taken off it. */
    public record PackageRow(LocalDate dueDate, BigDecimal amount, BigDecimal discount) {
    }

    /** One course's part of one package installment. */
    public record CourseRow(int packageRowIndex, LocalDate dueDate, BigDecimal amount, BigDecimal discount) {
        public BigDecimal net() {
            return amount.subtract(discount);
        }
    }

    /** One course's part of the package. */
    public record CourseShare(int courseIndex, BigDecimal fee, BigDecimal discount, List<CourseRow> rows,
                              BigDecimal paidAtAdmission) {
        public BigDecimal net() {
            return fee.subtract(discount);
        }
    }

    /**
     * @param courseFees      each course's fee (gross), in the order the courses were picked
     * @param rows            the package schedule; amounts add up to the sum of the fees
     * @param paidAtAdmission money recorded at admission (null or 0 = none)
     */
    public static List<CourseShare> split(List<BigDecimal> courseFees, List<PackageRow> rows,
                                          BigDecimal paidAtAdmission) {
        if (courseFees == null || courseFees.size() < 2) {
            throw new VacademyException("A package needs at least two courses");
        }
        if (rows == null || rows.isEmpty()) {
            throw new VacademyException("A package needs at least one installment");
        }
        for (BigDecimal fee : courseFees) {
            if (fee == null || fee.signum() <= 0) {
                throw new VacademyException("Every course in a package needs a fee above zero");
            }
        }
        BigDecimal feeTotal = sum(courseFees);
        BigDecimal rowTotal = BigDecimal.ZERO;
        BigDecimal discountTotal = BigDecimal.ZERO;
        for (int r = 0; r < rows.size(); r++) {
            PackageRow row = rows.get(r);
            if (row.dueDate() == null) {
                throw new VacademyException("Installment " + (r + 1) + " has no due date");
            }
            if (row.amount() == null || row.amount().signum() <= 0) {
                throw new VacademyException("Installment " + (r + 1) + " needs an amount above zero");
            }
            BigDecimal off = nz(row.discount());
            if (off.signum() < 0 || off.compareTo(row.amount()) > 0) {
                throw new VacademyException("Installment " + (r + 1) + " has a discount outside 0 and its amount");
            }
            if (r > 0 && row.dueDate().isBefore(rows.get(r - 1).dueDate())) {
                throw new VacademyException("Installment " + (r + 1) + " is due before installment " + r);
            }
            rowTotal = rowTotal.add(row.amount());
            discountTotal = discountTotal.add(off);
        }
        if (rowTotal.compareTo(feeTotal) != 0) {
            throw new VacademyException("The installments add up to " + rowTotal.toPlainString()
                    + " but the courses' fees add up to " + feeTotal.toPlainString());
        }

        boolean wholeRupees = courseFees.stream().allMatch(AdmissionPackageSplitter::isWhole)
                && rows.stream().allMatch(r -> isWhole(r.amount()) && isWhole(nz(r.discount())));
        int scale = wholeRupees ? 0 : 2;
        int n = courseFees.size();
        int m = rows.size();
        int absorber = 0;
        for (int c = 1; c < n; c++) {
            if (courseFees.get(c).compareTo(courseFees.get(absorber)) > 0) absorber = c;
        }

        // Gross: each course's fee spread over the installments in proportion to their amounts;
        // the largest course takes what is left of each installment.
        List<BigDecimal> rowAmounts = rows.stream().map(PackageRow::amount).toList();
        BigDecimal[][] gross = new BigDecimal[n][];
        BigDecimal[] grossLeft = rowAmounts.toArray(new BigDecimal[0]);
        for (int c = 0; c < n; c++) {
            if (c == absorber) continue;
            gross[c] = apportion(courseFees.get(c), rowAmounts, scale);
            for (int r = 0; r < m; r++) grossLeft[r] = grossLeft[r].subtract(gross[c][r]);
        }
        gross[absorber] = grossLeft;

        // Discount: the package discount split over the courses in proportion to their fees,
        // then each course's share over the installments in proportion to their discounts.
        List<BigDecimal> courseDiscounts = java.util.Arrays.asList(apportion(discountTotal, courseFees, scale));
        List<BigDecimal> rowDiscounts = rows.stream().map(r -> nz(r.discount())).toList();
        BigDecimal[][] off = new BigDecimal[n][];
        BigDecimal[] offLeft = rowDiscounts.toArray(new BigDecimal[0]);
        for (int c = 0; c < n; c++) {
            if (c == absorber) continue;
            off[c] = discountTotal.signum() == 0 ? zeros(m) : apportion(courseDiscounts.get(c), rowDiscounts, scale);
            for (int r = 0; r < m; r++) offLeft[r] = offLeft[r].subtract(off[c][r]);
        }
        off[absorber] = offLeft;

        for (int c = 0; c < n; c++) {
            for (int r = 0; r < m; r++) {
                if (gross[c][r].signum() < 0 || off[c][r].signum() < 0 || off[c][r].compareTo(gross[c][r]) > 0) {
                    throw new VacademyException("Installment " + (r + 1) + " is too small to split across the "
                            + "courses. Make it larger or merge it with the next one.");
                }
            }
        }

        // Money at admission: installment by installment, each across every course.
        BigDecimal toPlace = nz(paidAtAdmission);
        BigDecimal netTotal = feeTotal.subtract(discountTotal);
        if (toPlace.signum() < 0) {
            throw new VacademyException("The payment at admission cannot be negative");
        }
        if (toPlace.compareTo(netTotal) > 0) {
            throw new VacademyException("The payment at admission (" + toPlace.toPlainString()
                    + ") is more than the package total (" + netTotal.toPlainString() + ")");
        }
        BigDecimal[] paid = zeros(n);
        int payScale = scale == 0 && isWhole(toPlace) ? 0 : 2;
        for (int r = 0; r < m && toPlace.signum() > 0; r++) {
            List<BigDecimal> cellNets = new ArrayList<>(n);
            for (int c = 0; c < n; c++) cellNets.add(gross[c][r].subtract(off[c][r]));
            BigDecimal[] parts = placeOnInstallment(cellNets, toPlace, payScale);
            for (int c = 0; c < n; c++) {
                paid[c] = paid[c].add(parts[c]);
                toPlace = toPlace.subtract(parts[c]);
            }
        }

        List<CourseShare> out = new ArrayList<>(n);
        for (int c = 0; c < n; c++) {
            List<CourseRow> courseRows = new ArrayList<>();
            BigDecimal courseOff = BigDecimal.ZERO;
            for (int r = 0; r < m; r++) {
                if (gross[c][r].signum() == 0) continue; // nothing of this course in that installment
                courseRows.add(new CourseRow(r, rows.get(r).dueDate(), money(gross[c][r]), money(off[c][r])));
                courseOff = courseOff.add(off[c][r]);
            }
            out.add(new CourseShare(c, money(courseFees.get(c)), money(courseOff), courseRows, money(paid[c])));
        }
        return out;
    }

    /** One course's unpaid balance on one bill, for {@link #allocatePayment}. */
    public record OpenBill(int courseIndex, LocalDate dueDate, BigDecimal outstanding) {
    }

    /**
     * Splits a payment made against the whole package across its courses: due dates earliest
     * first (a bill with no due date last), each date paid off across the courses before the next,
     * a part-payment of a date shared in proportion to what each course owes on it.
     *
     * @return each course's share, indexed by {@link OpenBill#courseIndex}
     */
    public static BigDecimal[] allocatePayment(int courseCount, List<OpenBill> bills, BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new VacademyException("Enter an amount above zero");
        }
        java.util.TreeMap<LocalDate, BigDecimal[]> byDate = new java.util.TreeMap<>();
        BigDecimal owed = BigDecimal.ZERO;
        boolean whole = isWhole(amount);
        for (OpenBill b : bills) {
            BigDecimal o = nz(b.outstanding());
            if (o.signum() <= 0) continue;
            LocalDate due = b.dueDate() != null ? b.dueDate() : LocalDate.MAX;
            BigDecimal[] perCourse = byDate.computeIfAbsent(due, d -> zeros(courseCount));
            perCourse[b.courseIndex()] = perCourse[b.courseIndex()].add(o);
            owed = owed.add(o);
            whole &= isWhole(o);
        }
        if (amount.compareTo(owed) > 0) {
            throw new VacademyException("The payment (" + amount.toPlainString()
                    + ") is more than what is still owed on the package (" + owed.toPlainString() + ")");
        }
        int scale = whole ? 0 : 2;
        BigDecimal[] shares = zeros(courseCount);
        BigDecimal left = amount;
        for (BigDecimal[] perCourse : byDate.values()) {
            if (left.signum() <= 0) break;
            BigDecimal[] parts = placeOnInstallment(java.util.Arrays.asList(perCourse), left, scale);
            for (int c = 0; c < courseCount; c++) {
                shares[c] = shares[c].add(parts[c]);
                left = left.subtract(parts[c]);
            }
        }
        for (int c = 0; c < courseCount; c++) shares[c] = money(shares[c]);
        return shares;
    }

    /**
     * Shares {@code amount} between the bills of one package installment in proportion to what
     * each still owes: how part of a package installment moves to a new date. Whole rupees when
     * the amount and every bill are whole.
     *
     * @throws VacademyException when the amount is not positive or more than the bills owe
     */
    public static BigDecimal[] shareOfInstallment(List<BigDecimal> owedPerBill, BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new VacademyException("Amount must be greater than zero");
        }
        BigDecimal owed = sum(owedPerBill);
        if (amount.compareTo(owed) > 0) {
            throw new VacademyException("Only " + money(owed).toPlainString()
                    + " is unpaid on this installment, so that is the most that can be moved");
        }
        return shareByWeight(owedPerBill, amount);
    }

    /**
     * Shares {@code amount} in proportion to {@code weights} — equally when every weight is zero.
     * Whole rupees when the amount and every weight are whole; the parts add up to the amount.
     */
    public static BigDecimal[] shareByWeight(List<BigDecimal> weights, BigDecimal amount) {
        List<BigDecimal> w = sum(weights).signum() > 0 ? weights
                : weights.stream().map(x -> BigDecimal.ONE).toList();
        boolean whole = isWhole(amount) && w.stream().allMatch(AdmissionPackageSplitter::isWhole);
        BigDecimal[] parts = apportion(amount, w, whole ? 0 : 2);
        for (int i = 0; i < parts.length; i++) parts[i] = money(parts[i]);
        return parts;
    }

    /**
     * What of {@code available} goes to each course on one installment: all of it when the money
     * covers the installment, otherwise shared in proportion to what each course owes on it.
     */
    private static BigDecimal[] placeOnInstallment(List<BigDecimal> owedPerCourse, BigDecimal available, int scale) {
        BigDecimal owed = sum(owedPerCourse);
        if (available.compareTo(owed) >= 0) {
            return owedPerCourse.toArray(new BigDecimal[0]);
        }
        return apportion(available, owedPerCourse, scale);
    }

    /**
     * Splits {@code total} in proportion to {@code weights} at {@code scale} decimals (largest
     * remainder): the parts add up to {@code total} exactly.
     */
    static BigDecimal[] apportion(BigDecimal total, List<BigDecimal> weights, int scale) {
        int k = weights.size();
        BigDecimal[] parts = zeros(k);
        BigDecimal weightSum = sum(weights);
        if (total.signum() == 0 || weightSum.signum() == 0) return parts;
        BigDecimal unit = BigDecimal.ONE.movePointLeft(scale);
        BigDecimal[] remainders = new BigDecimal[k];
        BigDecimal placed = BigDecimal.ZERO;
        for (int i = 0; i < k; i++) {
            BigDecimal exact = total.multiply(weights.get(i)).divide(weightSum, 12, RoundingMode.HALF_UP);
            parts[i] = exact.setScale(scale, RoundingMode.FLOOR);
            remainders[i] = exact.subtract(parts[i]);
            placed = placed.add(parts[i]);
        }
        BigDecimal left = total.setScale(scale, RoundingMode.HALF_UP).subtract(placed);
        while (left.compareTo(unit) >= 0) {
            int best = -1;
            for (int i = 0; i < k; i++) {
                if (weights.get(i).signum() <= 0) continue;
                if (best < 0 || remainders[i].compareTo(remainders[best]) > 0) best = i;
            }
            if (best < 0) break;
            parts[best] = parts[best].add(unit);
            remainders[best] = remainders[best].subtract(unit);
            left = left.subtract(unit);
        }
        return parts;
    }

    private static boolean isWhole(BigDecimal v) {
        return v != null && v.stripTrailingZeros().scale() <= 0;
    }

    private static BigDecimal[] zeros(int k) {
        BigDecimal[] z = new BigDecimal[k];
        java.util.Arrays.fill(z, BigDecimal.ZERO);
        return z;
    }

    private static BigDecimal sum(List<BigDecimal> values) {
        return values.stream().map(AdmissionPackageSplitter::nz).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    private static BigDecimal money(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP);
    }
}
