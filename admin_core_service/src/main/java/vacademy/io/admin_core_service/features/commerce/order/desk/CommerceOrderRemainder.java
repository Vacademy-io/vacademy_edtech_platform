package vacademy.io.admin_core_service.features.commerce.order.desk;

import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CreditLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CreditLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CreditResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRateRow;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The money of an order after line cancels. Pure: no database, no Spring.
 *
 * <p>What the first {@code n} cancelled units of a line are worth is the credit the tax
 * calculator gives for {@code n} units of each of the line's snapshot tax lines (the remainder
 * of the line, to the paisa, when {@code n} is the whole line). The value of one cancel is the
 * difference of that amount before and after it, so the cancels of a line always add up to the
 * same figure whatever their sizes, and the cancels plus what remains is the placement total to
 * the paisa. {@link #remainingTax} is the placement snapshot less those amounts: the tax result
 * the invoice is issued from at pack, whose total is then the order total.
 */
public final class CommerceOrderRemainder {

    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);
    private static final CommerceTaxCalculator CALCULATOR = new CommerceTaxCalculator();

    private CommerceOrderRemainder() {
    }

    /** What a number of cancelled units of one line is worth, by part. */
    public record Amounts(BigDecimal gross, BigDecimal lineDiscount, BigDecimal orderDiscount, BigDecimal net,
                          BigDecimal taxableValue, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                          BigDecimal cess) {

        static final Amounts NONE = new Amounts(ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO);

        public BigDecimal discount() {
            return lineDiscount.add(orderDiscount);
        }

        public BigDecimal taxAmount() {
            return cgst.add(sgst).add(igst).add(cess);
        }

        Amounts plus(Amounts o) {
            return new Amounts(gross.add(o.gross), lineDiscount.add(o.lineDiscount), orderDiscount.add(o.orderDiscount),
                    net.add(o.net), taxableValue.add(o.taxableValue), cgst.add(o.cgst), sgst.add(o.sgst),
                    igst.add(o.igst), cess.add(o.cess));
        }

        Amounts minus(Amounts o) {
            return new Amounts(gross.subtract(o.gross), lineDiscount.subtract(o.lineDiscount),
                    orderDiscount.subtract(o.orderDiscount), net.subtract(o.net),
                    taxableValue.subtract(o.taxableValue), cgst.subtract(o.cgst), sgst.subtract(o.sgst),
                    igst.subtract(o.igst), cess.subtract(o.cess));
        }
    }

    /** The tax lines of one order line (a set taxed in parts has several) in the placement snapshot. */
    public static List<TaxLineResult> taxLinesOf(TaxResult placement, String lineRef) {
        List<TaxLineResult> out = new ArrayList<>();
        if (placement == null || placement.getLines() == null) {
            return out;
        }
        for (TaxLineResult line : placement.getLines()) {
            if (lineRef != null && lineRef.equals(line.getLineRef())) {
                out.add(line);
            }
        }
        return out;
    }

    /**
     * How many units of a tax line one unit of the order line is (1, or the count of a part in
     * a set).
     */
    public static int unitsPerLineUnit(TaxLineResult taxLine, int lineQuantity) {
        if (lineQuantity < 1 || taxLine.getQuantity() < lineQuantity || taxLine.getQuantity() % lineQuantity != 0) {
            return 1;
        }
        return taxLine.getQuantity() / lineQuantity;
    }

    /** What the first {@code cancelled} units of the line are worth. */
    public static Amounts cumulative(List<TaxLineResult> taxLines, int lineQuantity, int cancelled, TaxHead head) {
        if (cancelled <= 0) {
            return Amounts.NONE;
        }
        if (cancelled > lineQuantity) {
            throw new IllegalArgumentException("more units cancelled than the line has");
        }
        Amounts sum = Amounts.NONE;
        for (TaxLineResult taxLine : taxLines) {
            int per = unitsPerLineUnit(taxLine, lineQuantity);
            int units = Math.min(taxLine.getQuantity(), cancelled * per);
            sum = sum.plus(ofTaxLine(taxLine, units, head));
        }
        return sum;
    }

    /** The value of cancelling {@code quantity} more units of a line of which {@code before} are cancelled. */
    public static Amounts cancelValue(List<TaxLineResult> taxLines, int lineQuantity, int before, int quantity,
                                      TaxHead head) {
        return cumulative(taxLines, lineQuantity, before + quantity, head)
                .minus(cumulative(taxLines, lineQuantity, before, head));
    }

    /** The calculator's credit of {@code units} units of one tax line, all parts. */
    static Amounts ofTaxLine(TaxLineResult line, int units, TaxHead head) {
        if (units <= 0) {
            return Amounts.NONE;
        }
        int quantity = Math.max(1, line.getQuantity());
        CreditLineInput input = CreditLineInput.builder()
                .lineRef(line.getLineRef())
                .quantity(quantity)
                .net(nz(line.getNet()))
                .taxableValue(nz(line.getTaxableValue()))
                .cgst(nz(line.getCgst())).sgst(nz(line.getSgst())).igst(nz(line.getIgst())).cess(nz(line.getCess()))
                .ratePercent(line.getRatePercent())
                .cessPercent(line.getCessPercent())
                .quantityCreditedBefore(0)
                .netCreditedBefore(ZERO).taxableCreditedBefore(ZERO)
                .cgstCreditedBefore(ZERO).sgstCreditedBefore(ZERO).igstCreditedBefore(ZERO).cessCreditedBefore(ZERO)
                .quantityToCredit(units)
                .build();
        CreditResult result = CALCULATOR.credit(List.of(input), head == null ? TaxHead.NONE : head, ZERO, ZERO);
        CreditLineResult credited = result.getLines().get(0);
        boolean whole = units >= quantity;
        BigDecimal gross = whole ? nz(line.getGross()) : share(nz(line.getGross()), units, quantity);
        BigDecimal lineDiscount = whole ? nz(line.getLineDiscount()) : share(nz(line.getLineDiscount()), units, quantity);
        BigDecimal orderDiscount = whole ? nz(line.getOrderDiscount())
                : gross.subtract(lineDiscount).subtract(credited.getNet());
        return new Amounts(gross, lineDiscount, orderDiscount, credited.getNet(), credited.getTaxableValue(),
                credited.getCgst(), credited.getSgst(), credited.getIgst(), credited.getCess());
    }

    /**
     * The placement tax result less the cancelled units of each line: what the invoice is issued
     * from. A line cancelled in full is left out; shipping, the COD charge and the round-off stay.
     *
     * @param cancelledByLineRef units cancelled per order line (line ref)
     * @param quantityByLineRef  the quantity of each order line (line ref)
     */
    public static TaxResult remainingTax(TaxResult placement, Map<String, Integer> cancelledByLineRef,
                                         Map<String, Integer> quantityByLineRef) {
        TaxHead head = placement.getTaxHead() == null ? TaxHead.NONE : placement.getTaxHead();
        List<TaxLineResult> lines = new ArrayList<>();
        for (TaxLineResult line : placement.getLines()) {
            Integer cancelled = cancelledByLineRef == null ? null : cancelledByLineRef.get(line.getLineRef());
            Integer lineQuantity = quantityByLineRef == null ? null : quantityByLineRef.get(line.getLineRef());
            if (cancelled == null || cancelled <= 0 || lineQuantity == null || lineQuantity < 1) {
                lines.add(copy(line));
                continue;
            }
            int per = unitsPerLineUnit(line, lineQuantity);
            int units = Math.min(line.getQuantity(), cancelled * per);
            if (units >= line.getQuantity()) {
                continue; // cancelled in full
            }
            Amounts gone = ofTaxLine(line, units, head);
            TaxLineResult left = copy(line);
            left.setQuantity(line.getQuantity() - units);
            left.setGross(nz(line.getGross()).subtract(gone.gross()));
            left.setLineDiscount(nz(line.getLineDiscount()).subtract(gone.lineDiscount()));
            left.setOrderDiscount(nz(line.getOrderDiscount()).subtract(gone.orderDiscount()));
            left.setNet(nz(line.getNet()).subtract(gone.net()));
            left.setTaxableValue(nz(line.getTaxableValue()).subtract(gone.taxableValue()));
            left.setCgst(nz(line.getCgst()).subtract(gone.cgst()));
            left.setSgst(nz(line.getSgst()).subtract(gone.sgst()));
            left.setIgst(nz(line.getIgst()).subtract(gone.igst()));
            left.setCess(nz(line.getCess()).subtract(gone.cess()));
            left.setTaxAmount(left.getCgst().add(left.getSgst()).add(left.getIgst()).add(left.getCess()));
            lines.add(left);
        }
        BigDecimal subtotal = ZERO;
        BigDecimal discount = ZERO;
        BigDecimal shipping = ZERO;
        BigDecimal codCharge = ZERO;
        BigDecimal taxable = ZERO;
        BigDecimal cgst = ZERO;
        BigDecimal sgst = ZERO;
        BigDecimal igst = ZERO;
        BigDecimal cess = ZERO;
        BigDecimal net = ZERO;
        for (TaxLineResult line : lines) {
            TaxLineType type = line.getLineType() == null ? TaxLineType.ITEM : line.getLineType();
            if (type == TaxLineType.ITEM) {
                subtotal = subtotal.add(nz(line.getGross()));
                discount = discount.add(nz(line.getLineDiscount())).add(nz(line.getOrderDiscount()));
            } else if (type == TaxLineType.SHIPPING) {
                shipping = shipping.add(nz(line.getNet()));
            } else if (type == TaxLineType.COD_CHARGE) {
                codCharge = codCharge.add(nz(line.getNet()));
            }
            taxable = taxable.add(nz(line.getTaxableValue()));
            cgst = cgst.add(nz(line.getCgst()));
            sgst = sgst.add(nz(line.getSgst()));
            igst = igst.add(nz(line.getIgst()));
            cess = cess.add(nz(line.getCess()));
            net = net.add(nz(line.getNet()));
        }
        BigDecimal roundOff = nz(placement.getRoundOff());
        boolean regular = placement.getMode() == TaxMode.REGULAR;
        return TaxResult.builder()
                .version(placement.getVersion())
                .mode(placement.getMode())
                .taxHead(placement.getTaxHead())
                .sellerStateCode(placement.getSellerStateCode())
                .placeOfSupplyState(placement.getPlaceOfSupplyState())
                .date(placement.getDate())
                .slabBasis(placement.getSlabBasis())
                .slabCompare(placement.getSlabCompare())
                .roundTotalTo(placement.getRoundTotalTo())
                .lines(lines)
                .rateRows(regular ? groupRows(lines, false) : List.of())
                .hsnRows(regular ? groupRows(lines, true) : List.of())
                .subtotal(subtotal)
                .discount(discount)
                .shipping(shipping)
                .codCharge(codCharge)
                .taxableValue(taxable)
                .cgst(cgst).sgst(sgst).igst(igst).cess(cess)
                .taxAmount(cgst.add(sgst).add(igst).add(cess))
                .roundOff(roundOff)
                .total(net.add(roundOff))
                .build();
    }

    /**
     * What each open line's payment log carries for an order total of {@code target}: every
     * line its own remaining total, the rest (delivery, COD charge, round-off, or a payment above
     * the total) on the largest line. The amounts sum to {@code target} exactly.
     *
     * @param remainingByLineId remaining total of each line that still has units, by line id
     */
    public static Map<String, BigDecimal> splitLogs(BigDecimal target, Map<String, BigDecimal> remainingByLineId) {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        if (remainingByLineId == null || remainingByLineId.isEmpty()) {
            return out;
        }
        BigDecimal sum = ZERO;
        String largest = null;
        for (Map.Entry<String, BigDecimal> e : remainingByLineId.entrySet()) {
            BigDecimal amount = nz(e.getValue()).max(ZERO);
            out.put(e.getKey(), amount);
            sum = sum.add(amount);
            if (largest == null || amount.compareTo(out.get(largest)) > 0) {
                largest = e.getKey();
            }
        }
        BigDecimal rest = nz(target).subtract(sum);
        if (rest.signum() != 0) {
            BigDecimal carried = out.get(largest).add(rest);
            if (carried.signum() < 0) {
                throw new IllegalStateException("the order total is lower than its lines allow");
            }
            out.put(largest, carried);
        }
        return out;
    }

    private static List<TaxRateRow> groupRows(List<TaxLineResult> lines, boolean byHsn) {
        Map<String, TaxRateRow> rows = new TreeMap<>();
        for (TaxLineResult line : lines) {
            String hsn = byHsn ? (line.getHsnCode() == null ? "" : line.getHsnCode()) : "";
            BigDecimal rate = line.getRatePercent() == null ? BigDecimal.ZERO : line.getRatePercent();
            BigDecimal cessRate = line.getCessPercent() == null ? BigDecimal.ZERO : line.getCessPercent();
            String key = String.format("%012.3f|%012.3f|%s", rate, cessRate, hsn);
            TaxRateRow row = rows.computeIfAbsent(key, k -> TaxRateRow.builder()
                    .hsnCode(byHsn ? line.getHsnCode() : null)
                    .ratePercent(line.getRatePercent())
                    .cessPercent(line.getCessPercent())
                    .taxableValue(ZERO).cgst(ZERO).sgst(ZERO).igst(ZERO).cess(ZERO).taxAmount(ZERO)
                    .build());
            row.setTaxableValue(row.getTaxableValue().add(nz(line.getTaxableValue())));
            row.setCgst(row.getCgst().add(nz(line.getCgst())));
            row.setSgst(row.getSgst().add(nz(line.getSgst())));
            row.setIgst(row.getIgst().add(nz(line.getIgst())));
            row.setCess(row.getCess().add(nz(line.getCess())));
            row.setTaxAmount(row.getTaxAmount().add(nz(line.getTaxAmount())));
        }
        return new ArrayList<>(rows.values());
    }

    private static TaxLineResult copy(TaxLineResult line) {
        return TaxLineResult.builder()
                .lineRef(line.getLineRef()).componentRef(line.getComponentRef()).lineType(line.getLineType())
                .description(line.getDescription()).taxClassId(line.getTaxClassId())
                .taxClassCode(line.getTaxClassCode()).hsnCode(line.getHsnCode()).unit(line.getUnit())
                .quantity(line.getQuantity()).qtyScale(line.getQtyScale()).unitPrice(line.getUnitPrice())
                .gross(line.getGross()).lineDiscount(line.getLineDiscount()).orderDiscount(line.getOrderDiscount())
                .net(line.getNet()).slabUnitValue(line.getSlabUnitValue()).ratePercent(line.getRatePercent())
                .cessPercent(line.getCessPercent()).taxableValue(line.getTaxableValue()).cgst(line.getCgst())
                .sgst(line.getSgst()).igst(line.getIgst()).cess(line.getCess()).taxAmount(line.getTaxAmount())
                .build();
    }

    private static BigDecimal share(BigDecimal amount, int units, int quantity) {
        return amount.multiply(BigDecimal.valueOf(units)).divide(BigDecimal.valueOf(quantity), 2, RoundingMode.HALF_UP);
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value.setScale(2, RoundingMode.HALF_UP);
    }
}
