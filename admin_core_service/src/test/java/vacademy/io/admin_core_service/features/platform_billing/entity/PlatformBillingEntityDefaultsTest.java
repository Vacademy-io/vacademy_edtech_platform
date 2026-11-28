package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.Column;
import jakarta.persistence.LockModeType;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V590 zero-disruption guard: the new NOT NULL DEFAULT columns are initialised in Java, so the
 * existing credit-pack code (which never sets them) keeps inserting valid rows with exactly the
 * pre-V590 meaning (CREDIT_PACK item, NORMAL payment, nothing refunded, legacy brand fields NULL).
 * Hibernate writes every mapped column on insert, so a null here would hit the NOT NULL constraint.
 */
class PlatformBillingEntityDefaultsTest {

    @Test
    void newPaymentDefaultsMatchTheV590ColumnDefaults() {
        PlatformPayment p = new PlatformPayment();
        assertEquals(PlatformPaymentDisposition.NORMAL, p.getDisposition());
        assertEquals(0L, p.getRefundedAmountMinor());
        assertNull(p.getBrandMode(), "NULL brand mode = legacy rendering");
        assertNull(p.getTaxHead());
        assertNull(p.getPlaceOfSupply());
        assertNull(p.getRefundRequestedAt());
        assertNull(p.getLinkExpiresAt());
        assertTrue(PlatformPaymentDisposition.NORMAL.isInvoiceable());
        assertFalse(PlatformPaymentDisposition.DUPLICATE.isInvoiceable());
        assertFalse(PlatformPaymentDisposition.LATE.isInvoiceable());
    }

    @Test
    void newItemIsACreditPackAndPackIdIsNullable() throws Exception {
        PlatformPaymentItem item = new PlatformPaymentItem();
        assertEquals(PlatformPaymentItemKind.CREDIT_PACK, item.getItemKind());
        assertNull(item.getSubscriptionChargeId());
        Column packId = PlatformPaymentItem.class.getDeclaredField("packId").getAnnotation(Column.class);
        assertTrue(packId.nullable(), "pack_id must be nullable for AI_SUBSCRIPTION items");
    }

    @Test
    void configAndInvoiceDefaults() {
        PlatformPaymentConfig cfg = new PlatformPaymentConfig();
        assertEquals("Vacademy", cfg.getTradeName());
        assertEquals("Vidyayatan Technologies", cfg.getNeutralDisplayName());
        assertNull(cfg.getBrandLogoUrl());
        PlatformInvoice inv = new PlatformInvoice();
        assertEquals(PlatformPaymentItemKind.CREDIT_PACK, inv.getSourceKind());
        assertNull(inv.getSeriesKey(), "legacy INV-AICRED numbers have no v2 series");
        assertNull(inv.getIssuedAtTz());
        PlatformCreditNote cn = new PlatformCreditNote();
        assertEquals("C", cn.getSeriesKey());
        assertEquals(0L, cn.getCgstAmountMinor());
        assertEquals(0L, cn.getSgstAmountMinor());
        assertEquals(0L, cn.getIgstAmountMinor());
        assertEquals(PlatformPaymentItemKind.CREDIT_PACK, cn.getItemKind());
        assertNotNull(new PlatformBillingProfile().getUpdatedAt());
    }

    @Test
    void v590NotNullColumnsHaveJavaDefaults() throws Exception {
        // the V590 NOT NULL columns that existing code never sets must be initialised
        for (Object[] c : new Object[][]{
                {new PlatformPayment(), "disposition"}, {new PlatformPayment(), "refundedAmountMinor"},
                {new PlatformPaymentItem(), "itemKind"}, {new PlatformPaymentConfig(), "tradeName"},
                {new PlatformPaymentConfig(), "neutralDisplayName"}, {new PlatformInvoice(), "sourceKind"}}) {
            Field f = c[0].getClass().getDeclaredField((String) c[1]);
            f.setAccessible(true);
            assertFalse(f.getAnnotation(Column.class).nullable(), c[1] + " is NOT NULL");
            assertNotNull(f.get(c[0]), c[1] + " must have a Java default");
        }
    }

    @Test
    void paymentRowLockFindersArePessimisticWrite() {
        for (String name : new String[]{"findByIdForUpdate", "findByVendorOrderIdForUpdate"}) {
            Method m = Arrays.stream(PlatformPaymentRepository.class.getMethods())
                    .filter(x -> x.getName().equals(name)).findFirst().orElseThrow();
            org.springframework.data.jpa.repository.Lock lock =
                    m.getAnnotation(org.springframework.data.jpa.repository.Lock.class);
            assertNotNull(lock, name);
            assertEquals(LockModeType.PESSIMISTIC_WRITE, lock.value(), name);
        }
    }
}
