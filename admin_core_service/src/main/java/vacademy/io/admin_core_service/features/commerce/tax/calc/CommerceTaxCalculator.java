package vacademy.io.admin_core_service.features.commerce.tax.calc;

import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The only place tax is computed for a sale. Used
 * by cart, checkout, POS and invoice.
 *
 * <p>Pure and deterministic: no clock, no database, no settings lookup. The caller passes the
 * tax mode, the settings, the rules and the date, and stores the {@link TaxResult} it gets back.
 * No rate, HSN code or slab limit is written in this class; they come from the tax classes the
 * institute typed in from its CA.
 *
 * <p>Order of calculation. Prices are tax-inclusive.
 * <ol>
 *   <li>Line gross = unit price x quantity. A set with components is split first by its price
 *       shares, the remainder on the largest share.</li>
 *   <li>Line discounts are subtracted.</li>
 *   <li>The order-level discount is spread over the ITEM lines in proportion to their value
 *       after step 2, rounded to paise, the remainder on the largest line. Shipping and the COD
 *       charge take no share.</li>
 *   <li>The slab is picked per line from the unit value named by the slab basis.</li>
 *   <li>Tax is backed out: taxable = round(net / (1 + rate), 2), tax = net - taxable. CGST and
 *       SGST are halves with the odd paisa on CGST; IGST when the seller state differs from the
 *       place of supply.</li>
 *   <li>Shipping and the COD charge are lines of their own with their own tax class.</li>
 *   <li>The document round-off is computed last and never touches a line.</li>
 * </ol>
 *
 * <p>Outside REGULAR mode there are no tax lines: taxable = net, every tax is zero, the head is
 * NONE.
 */
public class CommerceTaxCalculator {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal TWO = BigDecimal.valueOf(2);
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);
    private static final int DIVISION_SCALE = 12;

    // ------------------------------------------------------------------ sale

    public TaxResult calculate(TaxRequest request) {
        require(request != null, "request is required");
        require(request.getMode() != null, "tax mode is required");
        require(request.getLines() != null && !request.getLines().isEmpty(), "at least one line is required");
        TaxMode mode = request.getMode();
        SlabBasis basis = request.getSlabBasis() != null ? request.getSlabBasis() : SlabBasis.NET_UNIT_PRICE;
        SlabCompare compare = request.getSlabCompare() != null ? request.getSlabCompare() : SlabCompare.TAX_EXCLUSIVE;
        RoundTotalTo roundTo = request.getRoundTotalTo() != null ? request.getRoundTotalTo() : RoundTotalTo.NONE;
        TaxHead head = taxHead(mode, request.getSellerStateCode(), request.getPlaceOfSupplyState());
        if (mode == TaxMode.REGULAR) {
            require(request.getDate() != null, "the document date is required to pick a tax rate");
        }

        // Steps 1 and 2.
        List<Work> works = new ArrayList<>();
        for (TaxLineInput line : request.getLines()) {
            works.addAll(expand(line));
        }

        // Step 3.
        BigDecimal orderDiscount = money(request.getOrderDiscount(), "order discount");
        List<Work> items = works.stream().filter(w -> w.lineType == TaxLineType.ITEM).toList();
        if (orderDiscount.signum() > 0) {
            BigDecimal itemValue = items.stream().map(w -> w.afterLineDiscount).reduce(ZERO, BigDecimal::add);
            if (orderDiscount.compareTo(itemValue) > 0) {
                throw new CommerceTaxException(CommerceTaxException.INVALID_INPUT,
                        "the order discount is larger than the value of the items");
            }
            List<BigDecimal> shares = allocate(orderDiscount,
                    items.stream().map(w -> w.afterLineDiscount).toList());
            for (int i = 0; i < items.size(); i++) {
                items.get(i).orderDiscount = shares.get(i);
            }
        }

        // Steps 4, 5 and 6.
        List<TaxLineResult> lines = new ArrayList<>();
        for (Work work : works) {
            lines.add(taxLine(work, mode, head, basis, compare, request.getDate()));
        }

        // Step 7.
        BigDecimal netTotal = sum(lines, TaxLineResult::getNet);
        BigDecimal total = roundTo == RoundTotalTo.RUPEE
                ? netTotal.setScale(0, RoundingMode.HALF_UP).setScale(2)
                : netTotal;

        return TaxResult.builder()
                .version(TaxResult.CURRENT_VERSION)
                .mode(mode)
                .taxHead(head)
                .sellerStateCode(state(request.getSellerStateCode()))
                .placeOfSupplyState(state(request.getPlaceOfSupplyState()) != null
                        ? state(request.getPlaceOfSupplyState()) : state(request.getSellerStateCode()))
                .date(request.getDate())
                .slabBasis(basis)
                .slabCompare(compare)
                .roundTotalTo(roundTo)
                .lines(lines)
                .rateRows(mode == TaxMode.REGULAR ? groupRows(lines, false) : List.of())
                .hsnRows(mode == TaxMode.REGULAR ? groupRows(lines, true) : List.of())
                .subtotal(sumOfType(lines, TaxLineType.ITEM, TaxLineResult::getGross))
                .discount(sumOfType(lines, TaxLineType.ITEM, TaxLineResult::getLineDiscount)
                        .add(sumOfType(lines, TaxLineType.ITEM, TaxLineResult::getOrderDiscount)))
                .shipping(sumOfType(lines, TaxLineType.SHIPPING, TaxLineResult::getNet))
                .codCharge(sumOfType(lines, TaxLineType.COD_CHARGE, TaxLineResult::getNet))
                .taxableValue(sum(lines, TaxLineResult::getTaxableValue))
                .cgst(sum(lines, TaxLineResult::getCgst))
                .sgst(sum(lines, TaxLineResult::getSgst))
                .igst(sum(lines, TaxLineResult::getIgst))
                .cess(sum(lines, TaxLineResult::getCess))
                .taxAmount(sum(lines, TaxLineResult::getTaxAmount))
                .roundOff(total.subtract(netTotal))
                .total(total)
                .build();
    }

    /** CGST and SGST inside one state, IGST across states, NONE outside REGULAR mode. */
    public TaxHead taxHead(TaxMode mode, String sellerStateCode, String placeOfSupplyState) {
        if (mode != TaxMode.REGULAR) {
            return TaxHead.NONE;
        }
        String seller = state(sellerStateCode);
        if (seller == null) {
            throw new CommerceTaxException(CommerceTaxException.SELLER_STATE_MISSING,
                    "the seller state is required in REGULAR tax mode");
        }
        String supply = state(placeOfSupplyState);
        return supply == null || supply.equals(seller) ? TaxHead.CGST_SGST : TaxHead.IGST;
    }

    // ------------------------------------------------------------------ credit note

    /**
     * A credit note against an invoice, full or part. It mirrors the invoice: a line that this
     * note finishes takes exactly what is left of the stored amounts, so the credit notes of a
     * fully returned invoice add up to the invoice to the paisa, round-off included. A part of a
     * line takes its share of the line net by quantity and backs the tax out at the stored rate.
     *
     * @param invoiceLines     every line of the invoice
     * @param head             the tax head stored on the invoice
     * @param invoiceRoundOff  the round-off stored on the invoice
     * @param roundOffCreditedBefore the round-off earlier credit notes already carried
     */
    public CreditResult credit(List<CreditLineInput> invoiceLines, TaxHead head,
                               BigDecimal invoiceRoundOff, BigDecimal roundOffCreditedBefore) {
        require(invoiceLines != null && !invoiceLines.isEmpty(), "the invoice has no lines");
        require(head != null, "the tax head is required");
        List<CreditLineResult> out = new ArrayList<>();
        boolean completes = true;
        for (CreditLineInput line : invoiceLines) {
            int before = line.getQuantityCreditedBefore();
            int now = line.getQuantityToCredit();
            require(line.getQuantity() > 0, "an invoice line has no quantity");
            require(before >= 0 && now >= 0, "a credited quantity cannot be negative");
            if (before + now > line.getQuantity()) {
                throw new CommerceTaxException(CommerceTaxException.INVALID_INPUT,
                        "more is credited than was invoiced on line " + line.getLineRef());
            }
            if (before + now < line.getQuantity()) {
                completes = false;
            }
            if (now == 0) {
                continue;
            }
            out.add(before + now == line.getQuantity()
                    ? remainderOfLine(line)
                    : partOfLine(line, now, head));
        }
        if (out.isEmpty()) {
            throw new CommerceTaxException(CommerceTaxException.INVALID_INPUT, "nothing to credit");
        }
        BigDecimal net = out.stream().map(CreditLineResult::getNet).reduce(ZERO, BigDecimal::add);
        BigDecimal roundOff = completes
                ? nz(invoiceRoundOff).subtract(nz(roundOffCreditedBefore))
                : ZERO;
        return CreditResult.builder()
                .taxHead(head)
                .lines(out)
                .completesInvoice(completes)
                .taxableValue(out.stream().map(CreditLineResult::getTaxableValue).reduce(ZERO, BigDecimal::add))
                .cgst(out.stream().map(CreditLineResult::getCgst).reduce(ZERO, BigDecimal::add))
                .sgst(out.stream().map(CreditLineResult::getSgst).reduce(ZERO, BigDecimal::add))
                .igst(out.stream().map(CreditLineResult::getIgst).reduce(ZERO, BigDecimal::add))
                .cess(out.stream().map(CreditLineResult::getCess).reduce(ZERO, BigDecimal::add))
                .taxAmount(out.stream().map(CreditLineResult::getTaxAmount).reduce(ZERO, BigDecimal::add))
                .roundOff(roundOff)
                .total(net.add(roundOff))
                .build();
    }

    private static CreditLineResult remainderOfLine(CreditLineInput line) {
        BigDecimal cgst = nz(line.getCgst()).subtract(nz(line.getCgstCreditedBefore()));
        BigDecimal sgst = nz(line.getSgst()).subtract(nz(line.getSgstCreditedBefore()));
        BigDecimal igst = nz(line.getIgst()).subtract(nz(line.getIgstCreditedBefore()));
        BigDecimal cess = nz(line.getCess()).subtract(nz(line.getCessCreditedBefore()));
        return CreditLineResult.builder()
                .lineRef(line.getLineRef())
                .quantity(line.getQuantityToCredit())
                .net(nz(line.getNet()).subtract(nz(line.getNetCreditedBefore())))
                .taxableValue(nz(line.getTaxableValue()).subtract(nz(line.getTaxableCreditedBefore())))
                .cgst(cgst).sgst(sgst).igst(igst).cess(cess)
                .taxAmount(cgst.add(sgst).add(igst).add(cess))
                .ratePercent(rate(line.getRatePercent()))
                .cessPercent(rate(line.getCessPercent()))
                .build();
    }

    private static CreditLineResult partOfLine(CreditLineInput line, int quantity, TaxHead head) {
        BigDecimal net = nz(line.getNet()).multiply(BigDecimal.valueOf(quantity))
                .divide(BigDecimal.valueOf(line.getQuantity()), 2, RoundingMode.HALF_UP);
        Split split = backOut(net, rate(line.getRatePercent()), rate(line.getCessPercent()), head);
        return CreditLineResult.builder()
                .lineRef(line.getLineRef())
                .quantity(quantity)
                .net(net)
                .taxableValue(split.taxable)
                .cgst(split.cgst).sgst(split.sgst).igst(split.igst).cess(split.cess)
                .taxAmount(net.subtract(split.taxable))
                .ratePercent(rate(line.getRatePercent()))
                .cessPercent(rate(line.getCessPercent()))
                .build();
    }

    // ------------------------------------------------------------------ steps

    /** Steps 1 and 2: gross, the split of a set into its components, and the line discount. */
    private static List<Work> expand(TaxLineInput line) {
        require(line != null, "a line is null");
        require(line.getQuantity() > 0, "quantity must be at least 1");
        BigDecimal unitPrice = money(line.getUnitPrice(), "unit price");
        BigDecimal gross = unitPrice.multiply(BigDecimal.valueOf(line.getQuantity())).setScale(2);
        BigDecimal lineDiscount = money(line.getLineDiscount(), "line discount");
        if (lineDiscount.compareTo(gross) > 0) {
            throw new CommerceTaxException(CommerceTaxException.INVALID_INPUT,
                    "a line discount is larger than the line");
        }
        int qtyScale = line.getQtyScale() == null ? 1 : line.getQtyScale();
        require(qtyScale >= 1, "qty scale must be at least 1");
        TaxLineType type = line.getLineType() != null ? line.getLineType() : TaxLineType.ITEM;

        List<TaxComponentInput> components = line.getComponents();
        if (components == null || components.isEmpty()) {
            Work work = new Work();
            work.lineRef = line.getLineRef();
            work.lineType = type;
            work.description = line.getDescription();
            work.taxClass = line.getTaxClass();
            work.quantity = line.getQuantity();
            work.qtyScale = qtyScale;
            work.unit = line.getUnit();
            work.unitPrice = unitPrice;
            work.gross = gross;
            work.lineDiscount = lineDiscount;
            work.afterLineDiscount = gross.subtract(lineDiscount);
            return List.of(work);
        }

        List<BigDecimal> shares = new ArrayList<>();
        BigDecimal shareTotal = BigDecimal.ZERO;
        for (TaxComponentInput component : components) {
            BigDecimal share = component.getPriceSharePercent();
            require(share != null && share.signum() > 0, "a component needs a price share above zero");
            shares.add(share);
            shareTotal = shareTotal.add(share);
        }
        require(shareTotal.compareTo(HUNDRED) == 0, "the price shares of a set must add up to 100");
        List<BigDecimal> grossParts = allocate(gross, shares);
        List<BigDecimal> discountParts = allocate(lineDiscount, shares);
        List<Work> out = new ArrayList<>();
        for (int i = 0; i < components.size(); i++) {
            TaxComponentInput component = components.get(i);
            Work work = new Work();
            work.lineRef = line.getLineRef();
            work.componentRef = component.getComponentRef();
            work.lineType = type;
            work.description = component.getDescription() != null ? component.getDescription() : line.getDescription();
            work.taxClass = component.getTaxClass();
            work.quantity = line.getQuantity();
            work.qtyScale = qtyScale;
            work.unit = line.getUnit();
            work.unitPrice = grossParts.get(i)
                    .divide(BigDecimal.valueOf(line.getQuantity()), 2, RoundingMode.HALF_UP);
            work.gross = grossParts.get(i);
            work.lineDiscount = discountParts.get(i);
            work.afterLineDiscount = work.gross.subtract(work.lineDiscount);
            out.add(work);
        }
        return out;
    }

    /** Steps 4 and 5 for one line. */
    private static TaxLineResult taxLine(Work work, TaxMode mode, TaxHead head, SlabBasis basis,
                                         SlabCompare compare, LocalDate date) {
        BigDecimal net = work.afterLineDiscount.subtract(work.orderDiscount);
        TaxClassRef taxClass = work.taxClass;
        TaxLineResult.TaxLineResultBuilder result = TaxLineResult.builder()
                .lineRef(work.lineRef)
                .componentRef(work.componentRef)
                .lineType(work.lineType)
                .description(work.description)
                .taxClassId(taxClass != null ? taxClass.getId() : null)
                .taxClassCode(taxClass != null ? taxClass.getCode() : null)
                .hsnCode(taxClass != null ? taxClass.getHsnCode() : null)
                .unit(printedUnit(work, taxClass))
                .quantity(work.quantity)
                .qtyScale(work.qtyScale)
                .unitPrice(work.unitPrice)
                .gross(work.gross)
                .lineDiscount(work.lineDiscount)
                .orderDiscount(work.orderDiscount)
                .net(net);

        if (mode != TaxMode.REGULAR) {
            return result
                    .ratePercent(BigDecimal.ZERO).cessPercent(BigDecimal.ZERO)
                    .taxableValue(net).cgst(ZERO).sgst(ZERO).igst(ZERO).cess(ZERO).taxAmount(ZERO)
                    .build();
        }
        if (taxClass == null) {
            throw new CommerceTaxException(CommerceTaxException.TAX_CLASS_MISSING,
                    "line " + work.lineRef + " has no tax class");
        }

        // Step 4. The value per unit of the tax class: base-unit value x qty scale.
        BigDecimal basisValue = basis == SlabBasis.LIST_UNIT_PRICE ? work.gross : net;
        BigDecimal slabUnitValue = basisValue.multiply(BigDecimal.valueOf(work.qtyScale))
                .divide(BigDecimal.valueOf(work.quantity), 2, RoundingMode.HALF_UP);
        TaxRateRule rule = pickRule(taxClass, date, slabUnitValue, compare);

        // Step 5.
        BigDecimal rate = rate(rule.getRatePercent());
        BigDecimal cessRate = rate(rule.getCessPercent());
        Split split = backOut(net, rate, cessRate, head);
        return result
                .slabUnitValue(slabUnitValue)
                .ratePercent(rate)
                .cessPercent(cessRate)
                .taxableValue(split.taxable)
                .cgst(split.cgst).sgst(split.sgst).igst(split.igst).cess(split.cess)
                .taxAmount(net.subtract(split.taxable))
                .build();
    }

    /**
     * The unit of a tax line, stored on the invoice and credit note rows and printed beside the
     * quantity. A measured line (qty scale above 1) is counted in its own unit (2.5 m of cloth),
     * so the item's unit wins over the tax class's: a cloth on a class quoted per piece or per kg
     * still prints "2.5 m". A counted line keeps the tax class unit, as before.
     */
    private static String printedUnit(Work work, TaxClassRef taxClass) {
        if (work.qtyScale > 1 && work.unit != null && !work.unit.isBlank()) {
            return work.unit.trim();
        }
        return taxClass != null ? taxClass.getUnit() : null;
    }

    /**
     * The rule in force on {@code date} whose slab holds {@code unitValue}.
     *
     * <p>TAX_INCLUSIVE compares the value as it is. TAX_EXCLUSIVE compares the value without
     * tax, which depends on the rate being tested, so each rule is tried with its own rate,
     * lowest slab first. A value can then fall between two slabs (too high for the lower slab
     * at the lower rate, below the upper limit at the higher rate); it takes the higher slab,
     * because it did not fit the lower one.
     */
    static TaxRateRule pickRule(TaxClassRef taxClass, LocalDate date, BigDecimal unitValue, SlabCompare compare) {
        List<TaxRateRule> inForce = new ArrayList<>();
        if (taxClass.getRules() != null) {
            for (TaxRateRule rule : taxClass.getRules()) {
                if (rule == null || rule.getEffectiveFrom() == null || rule.getRatePercent() == null) {
                    continue;
                }
                boolean started = !rule.getEffectiveFrom().isAfter(date);
                boolean notEnded = rule.getEffectiveTo() == null || !rule.getEffectiveTo().isBefore(date);
                if (started && notEnded) {
                    inForce.add(rule);
                }
            }
        }
        if (inForce.isEmpty()) {
            throw new CommerceTaxException(CommerceTaxException.NO_RATE_IN_FORCE,
                    "tax class " + taxClass.getCode() + " has no rate in force on " + date);
        }
        inForce.sort(Comparator.comparing(r -> nz(r.getMinUnitPrice())));

        boolean aboveALowerSlab = false;
        for (TaxRateRule rule : inForce) {
            BigDecimal value = compare == SlabCompare.TAX_INCLUSIVE
                    ? unitValue
                    : unitValue.divide(divisor(rate(rule.getRatePercent()), rate(rule.getCessPercent())),
                            2, RoundingMode.HALF_UP);
            boolean underMax = rule.getMaxUnitPrice() == null || value.compareTo(rule.getMaxUnitPrice()) <= 0;
            boolean overMin = value.compareTo(nz(rule.getMinUnitPrice())) >= 0;
            if (underMax && (overMin || (aboveALowerSlab && compare == SlabCompare.TAX_EXCLUSIVE))) {
                return rule;
            }
            if (!underMax) {
                aboveALowerSlab = true;
            }
        }
        throw new CommerceTaxException(CommerceTaxException.NO_SLAB,
                "tax class " + taxClass.getCode() + " has no slab for a unit value of " + unitValue);
    }

    /**
     * Step 5: the tax inside a tax-inclusive amount. taxable + cgst + sgst + igst + cess = net,
     * and cgst = sgst on every line.
     */
    private static Split backOut(BigDecimal net, BigDecimal rate, BigDecimal cessRate, TaxHead head) {
        Split split = new Split();
        if (head == TaxHead.NONE || net.signum() == 0 || rate.add(cessRate).signum() == 0) {
            split.taxable = net;
            return split;
        }
        BigDecimal taxable = net.divide(divisor(rate, cessRate), 2, RoundingMode.HALF_UP);
        BigDecimal tax = net.subtract(taxable);
        BigDecimal cess = cessRate.signum() == 0 ? ZERO
                : taxable.multiply(cessRate).divide(HUNDRED, 2, RoundingMode.HALF_UP).min(tax);
        split.cess = cess;
        if (head == TaxHead.IGST) {
            split.taxable = taxable;
            split.igst = tax.subtract(cess);
            return split;
        }
        // CGST and SGST are one rate on one value, so they are one amount: each is half the
        // GST inside the net, rounded once, and the taxable value is what is left. An odd
        // paisa of tax therefore moves the taxable value by a paisa and never splits the two.
        BigDecimal half = net.multiply(rate)
                .divide(HUNDRED.add(rate).add(cessRate).multiply(TWO), 2, RoundingMode.HALF_UP);
        split.cgst = half;
        split.sgst = half;
        split.taxable = net.subtract(half).subtract(half).subtract(cess);
        return split;
    }

    /**
     * Splits {@code total} by {@code weights}, each share rounded to paise and the remainder on
     * the largest weight (the first of equals). The shares always add up to {@code total}.
     */
    static List<BigDecimal> allocate(BigDecimal total, List<BigDecimal> weights) {
        List<BigDecimal> shares = new ArrayList<>();
        BigDecimal weightTotal = weights.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        if (total.signum() == 0) {
            weights.forEach(w -> shares.add(ZERO));
            return shares;
        }
        if (weightTotal.signum() <= 0) {
            throw new CommerceTaxException(CommerceTaxException.INVALID_INPUT,
                    "there is nothing to spread the amount over");
        }
        BigDecimal given = BigDecimal.ZERO;
        int largest = 0;
        for (int i = 0; i < weights.size(); i++) {
            BigDecimal share = total.multiply(weights.get(i)).divide(weightTotal, 2, RoundingMode.HALF_UP);
            shares.add(share);
            given = given.add(share);
            if (weights.get(i).compareTo(weights.get(largest)) > 0) {
                largest = i;
            }
        }
        shares.set(largest, shares.get(largest).add(total.subtract(given)));
        return shares;
    }

    /** One row per rate, or per HSN code and rate; lowest rate first, then HSN code. */
    private static List<TaxRateRow> groupRows(List<TaxLineResult> lines, boolean byHsn) {
        Map<String, TaxRateRow> rows = new TreeMap<>();
        for (TaxLineResult line : lines) {
            String hsn = byHsn ? (line.getHsnCode() == null ? "" : line.getHsnCode()) : "";
            String key = String.format("%012.3f|%012.3f|%s", line.getRatePercent(), line.getCessPercent(), hsn);
            TaxRateRow row = rows.computeIfAbsent(key, k -> TaxRateRow.builder()
                    .hsnCode(byHsn ? line.getHsnCode() : null)
                    .ratePercent(line.getRatePercent())
                    .cessPercent(line.getCessPercent())
                    .taxableValue(ZERO).cgst(ZERO).sgst(ZERO).igst(ZERO).cess(ZERO).taxAmount(ZERO)
                    .build());
            row.setTaxableValue(row.getTaxableValue().add(line.getTaxableValue()));
            row.setCgst(row.getCgst().add(line.getCgst()));
            row.setSgst(row.getSgst().add(line.getSgst()));
            row.setIgst(row.getIgst().add(line.getIgst()));
            row.setCess(row.getCess().add(line.getCess()));
            row.setTaxAmount(row.getTaxAmount().add(line.getTaxAmount()));
        }
        return new ArrayList<>(rows.values());
    }

    // ------------------------------------------------------------------ helpers

    private static BigDecimal divisor(BigDecimal rate, BigDecimal cessRate) {
        return BigDecimal.ONE.add(rate.add(cessRate).divide(HUNDRED, DIVISION_SCALE, RoundingMode.HALF_UP));
    }

    private static BigDecimal rate(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    /** An amount in rupees with at most two decimals and not negative; null is zero. */
    private static BigDecimal money(BigDecimal value, String field) {
        if (value == null) {
            return ZERO;
        }
        require(value.signum() >= 0, field + " cannot be negative");
        require(value.stripTrailingZeros().scale() <= 2, field + " has more than two decimals");
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    private static String state(String code) {
        if (code == null) {
            return null;
        }
        String trimmed = code.trim().toUpperCase();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static BigDecimal sum(List<TaxLineResult> lines,
                                  java.util.function.Function<TaxLineResult, BigDecimal> field) {
        return lines.stream().map(field).reduce(ZERO, BigDecimal::add);
    }

    private static BigDecimal sumOfType(List<TaxLineResult> lines, TaxLineType type,
                                        java.util.function.Function<TaxLineResult, BigDecimal> field) {
        return lines.stream().filter(l -> l.getLineType() == type).map(field).reduce(ZERO, BigDecimal::add);
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new CommerceTaxException(CommerceTaxException.INVALID_INPUT, message);
        }
    }

    private static final class Work {
        private String lineRef;
        private String componentRef;
        private TaxLineType lineType;
        private String description;
        private TaxClassRef taxClass;
        private int quantity;
        private int qtyScale;
        private String unit;
        private BigDecimal unitPrice;
        private BigDecimal gross;
        private BigDecimal lineDiscount;
        private BigDecimal afterLineDiscount;
        private BigDecimal orderDiscount = ZERO;
    }

    private static final class Split {
        private BigDecimal taxable = ZERO;
        private BigDecimal cgst = ZERO;
        private BigDecimal sgst = ZERO;
        private BigDecimal igst = ZERO;
        private BigDecimal cess = ZERO;
    }
}
