package vacademy.io.admin_core_service.features.platform_billing.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy;
import org.hibernate.cfg.Configuration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformDocumentSequence;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformCreditNoteRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Invoices and credit notes end to end on a real Postgres 16 with V590 applied: the real
 * entities (Hibernate schema validation against the migrated tables), the real Spring Data
 * repositories, the real native SQL (advisory locks, the v2 sequence upsert, the legacy
 * INV-AICRED counter) and the V590 CHECK constraints.
 *
 * <p>Skipped unless {@code PLATFORM_BILLING_JPA_PG_URL} points at a scratch database that has the
 * platform billing tables (prod DDL) plus V590. It writes rows; never point it at a real database.
 */
class PlatformDocumentsPostgresTest {

    static final Instant NOW = Instant.parse("2026-10-16T09:00:00Z");   // FY 2627
    static String url;
    static EntityManagerFactory emf;
    static String runTag;

    @BeforeAll
    static void boot() throws Exception {
        url = System.getenv("PLATFORM_BILLING_JPA_PG_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "PLATFORM_BILLING_JPA_PG_URL not set");
        try (Connection c = DriverManager.getConnection(url); Statement st = c.createStatement()) {
            // Non-destructive: earlier runs' rows stay; numbers are asserted by shape and by delta.
            // scratch data may hold INV-AICRED-202610-* rows without a counter row: align it
            st.execute("INSERT INTO ai_credit_invoice_sequence (yyyymm, last_no) "
                    + "SELECT '202610', COALESCE(max(CAST(substr(invoice_number, 19) AS INT)), 0) FROM platform_invoice "
                    + "WHERE invoice_number LIKE 'INV-AICRED-202610-%' "
                    + "ON CONFLICT (yyyymm) DO UPDATE SET last_no = GREATEST(ai_credit_invoice_sequence.last_no, EXCLUDED.last_no)");
        }
        Configuration cfg = new Configuration();
        for (Class<?> c : List.of(PlatformPayment.class, PlatformPaymentItem.class, PlatformInvoice.class,
                PlatformInvoiceLineItem.class, PlatformPaymentConfig.class, PlatformCreditNote.class,
                PlatformDocumentSequence.class, PlatformBillingProfile.class)) {
            cfg.addAnnotatedClass(c);
        }
        cfg.setPhysicalNamingStrategy(new CamelCaseToUnderscoresNamingStrategy());
        cfg.setProperty("hibernate.connection.url", url);
        cfg.setProperty("hibernate.connection.driver_class", "org.postgresql.Driver");
        cfg.setProperty("hibernate.connection.pool_size", "8");
        // every mapped column must exist with a compatible type in the migrated schema
        cfg.setProperty("hibernate.hbm2ddl.auto", "validate");
        emf = cfg.buildSessionFactory();
        runTag = UUID.randomUUID().toString().substring(0, 8);
    }

    @AfterAll
    static void close() {
        if (emf != null) {
            emf.close();
        }
    }

    /** One unit of work: fresh EntityManager, real repositories, services wired to them. */
    static final class Ctx implements AutoCloseable {
        final EntityManager em = emf.createEntityManager();
        final JpaRepositoryFactory f = new JpaRepositoryFactory(em);
        final PlatformPaymentRepository payments = f.getRepository(PlatformPaymentRepository.class);
        final PlatformPaymentItemRepository items = f.getRepository(PlatformPaymentItemRepository.class);
        final PlatformInvoiceRepository invoices = f.getRepository(PlatformInvoiceRepository.class);
        final PlatformInvoiceLineItemRepository lines = f.getRepository(PlatformInvoiceLineItemRepository.class);
        final PlatformCreditNoteRepository notes = f.getRepository(PlatformCreditNoteRepository.class);
        final InstituteRepository institutes = mock(InstituteRepository.class);
        final CreditPackRepository packs = mock(CreditPackRepository.class);
        final PlatformPaymentConfigService config = mock(PlatformPaymentConfigService.class);
        final PlatformBillingFlags flags = mock(PlatformBillingFlags.class);
        final BrandModeService brand = mock(BrandModeService.class);
        final PlatformDocumentSequenceService sequence = new PlatformDocumentSequenceService();
        final PlatformInvoiceService invoiceService;
        final PlatformCreditNoteService creditNotes;

        Ctx(boolean seriesV2) {
            ReflectionTestUtils.setField(sequence, "entityManager", em);
            when(config.load()).thenReturn(supplier());
            when(flags.invoiceSeriesV2Enabled()).thenReturn(seriesV2);
            when(brand.resolve(anyString(), any())).thenReturn(BrandMode.NEUTRAL);
            when(packs.findById(anyString())).thenReturn(Optional.empty());
            invoiceService = new PlatformInvoiceService(payments, items, invoices, lines, institutes, packs, config);
            invoiceService.setCollaborators(flags, sequence, brand, em, Clock.fixed(NOW, ZoneOffset.UTC));
            creditNotes = new PlatformCreditNoteService(notes, invoices, lines, payments, sequence, brand);
            creditNotes.setTestHooks(em, Clock.fixed(NOW, ZoneOffset.UTC));
        }

        <T> T tx(Function<Ctx, T> work) {
            em.getTransaction().begin();
            try {
                T out = work.apply(this);
                em.getTransaction().commit();
                return out;
            } catch (RuntimeException e) {
                if (em.getTransaction().isActive()) {
                    em.getTransaction().rollback();
                }
                throw e;
            }
        }

        @Override
        public void close() {
            em.close();
        }
    }

    static PlatformPaymentConfig supplier() {
        PlatformPaymentConfig c = new PlatformPaymentConfig();
        c.setSupplierLegalName("Vidyayatan Technologies LLP");
        c.setSupplierGstin("23AAYFV8247N1Z3");
        c.setSupplierStateCode("23");
        c.setSupplierAddress("Bhopal, Madhya Pradesh");
        return c;
    }

    /** A paid AI subscription payment with its order-time snapshot (inclusive price Rs 1,180). */
    static String seedSubscriptionPayment(Ctx c, String buyerState, String taxHead) {
        return c.tx(x -> {
            PlatformPayment p = new PlatformPayment();
            p.setInstituteId("inst-" + runTag);
            p.setVendor("RAZORPAY");
            p.setVendorOrderId("order_" + UUID.randomUUID().toString().substring(0, 20));
            p.setVendorPaymentId("pay_" + UUID.randomUUID().toString().substring(0, 20));
            p.setCurrency("INR");
            p.setBaseAmountMinor(100_000L);
            p.setTaxAmountMinor(18_000L);
            p.setTotalAmountMinor(118_000L);
            p.setStatus(PlatformPaymentStatus.SUCCESS);
            p.setPaymentStatus(PlatformPaymentResult.PAID);
            p.setBuyerLegalName("Shiksha Academy Pvt Ltd");
            p.setBuyerGstin(null);
            p.setBuyerStateCode(buyerState);
            p.setBuyerAddress("12 MG Road, Pune");
            p.setPlaceOfSupply(buyerState);
            p.setTaxHead(taxHead);
            p.setBrandMode("NEUTRAL");
            p = x.payments.saveAndFlush(p);

            PlatformPaymentItem i = new PlatformPaymentItem();
            i.setPlatformPaymentId(p.getId());
            i.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
            i.setSubscriptionChargeId(UUID.randomUUID().toString());
            i.setPackCodeSnapshot("AI_SUB:pro");
            i.setCredits(BigDecimal.ZERO);
            i.setCurrency("INR");
            i.setBaseAmountMinor(100_000L);
            i.setTaxRateBps(1800);
            i.setTaxAmountMinor(18_000L);
            i.setTotalAmountMinor(118_000L);
            i.setHsnSacSnapshot("998315");
            i.setDescriptionSnapshot("AI Pro subscription, 05-11-2026 to 04-12-2026");
            i.setServicePeriodStart(Instant.parse("2026-11-04T18:30:00Z"));
            i.setServicePeriodEnd(Instant.parse("2026-12-04T18:30:00Z"));
            x.items.saveAndFlush(i);
            return p.getId();
        });
    }

    static long count(String sql) throws Exception {
        try (Connection c = DriverManager.getConnection(url); Statement st = c.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    @Test
    void subscriptionInvoiceThenPartialAndFinalCreditNotesReverseItExactly() throws Exception {
        String pp;
        PlatformInvoice inv;
        try (Ctx c = new Ctx(false)) {           // series v2 flag OFF: subscriptions still use v2
            pp = seedSubscriptionPayment(c, "27", "IGST");
            inv = c.tx(x -> x.invoiceService.generateInvoice(pp));
        }
        assertTrue(inv.getInvoiceNumber().matches("VT/2627/I\\d{5}"), inv.getInvoiceNumber());
        assertTrue(inv.getInvoiceNumber().length() <= 16);
        assertEquals("I", inv.getSeriesKey());
        assertEquals("2627", inv.getFy());
        assertEquals(PlatformPaymentItemKind.AI_SUBSCRIPTION, inv.getSourceKind());
        assertEquals(100_000L, inv.getBaseAmountMinor());
        assertEquals(18_000L, inv.getIgstAmountMinor());
        assertEquals(0L, inv.getCgstAmountMinor());
        assertEquals(118_000L, inv.getTotalAmountMinor());
        assertEquals("27", inv.getPlaceOfSupply());
        assertEquals("NEUTRAL", inv.getBrandMode());
        assertEquals(NOW, inv.getIssuedAtTz());

        // idempotent: a second webhook gets the same invoice, no second number
        try (Ctx c = new Ctx(false)) {
            PlatformInvoice again = c.tx(x -> x.invoiceService.generateInvoice(pp));
            assertEquals(inv.getId(), again.getId());
            assertEquals(inv.getInvoiceNumber(), again.getInvoiceNumber());
        }
        assertEquals(1, count("SELECT count(*) FROM platform_invoice WHERE platform_payment_id = '" + pp + "'"));
        assertEquals("998315", firstLineSac(inv.getId()));

        // partial refund Rs 500 -> credit note C00001; same refund id again -> same note
        String rf1 = "rfnd_" + runTag + "a";
        PlatformCreditNote n1;
        try (Ctx c = new Ctx(false)) {
            n1 = c.tx(x -> x.creditNotes.issueForRefund(pp, rf1, 50_000L, "Partial refund", "ops")).orElseThrow();
            PlatformCreditNote dup = c.tx(x -> x.creditNotes.issueForRefund(pp, rf1, 50_000L, "Partial refund", "ops"))
                    .orElseThrow();
            assertEquals(n1.getId(), dup.getId());
        }
        assertTrue(n1.getCreditNoteNumber().matches("VT/2627/C\\d{5}"), n1.getCreditNoteNumber());
        assertEquals(inv.getInvoiceNumber(), n1.getInvoiceNumber());
        assertEquals(inv.getId(), n1.getInvoiceId());
        assertEquals(50_000L, n1.getTotalAmountMinor());
        assertEquals(n1.getBaseAmountMinor() + n1.getIgstAmountMinor(), n1.getTotalAmountMinor());
        assertEquals(42_373L, n1.getBaseAmountMinor());     // round(50000 x 100000 / 118000)
        assertEquals("IGST", n1.getTaxHead());
        assertEquals("27", n1.getPlaceOfSupply());

        // the remainder reverses every component to the paisa; anything more is refused
        PlatformCreditNote n2;
        try (Ctx c = new Ctx(false)) {
            n2 = c.tx(x -> x.creditNotes.issueForRefund(pp, "rfnd_" + runTag + "b", 68_000L, null, "ops")).orElseThrow();
            assertThrows(PlatformCreditNoteService.CreditNoteException.class,
                    () -> c.tx(x -> x.creditNotes.issueForRefund(pp, "rfnd_" + runTag + "c", 1L, null, "ops")));
        }
        assertEquals(100_000L, n1.getBaseAmountMinor() + n2.getBaseAmountMinor());
        assertEquals(18_000L, n1.getIgstAmountMinor() + n2.getIgstAmountMinor());
        assertNotEquals(n1.getCreditNoteNumber(), n2.getCreditNoteNumber());
        assertEquals(2, count("SELECT count(*) FROM platform_credit_note WHERE invoice_id = '" + inv.getId() + "'"));
        assertEquals(118_000L, count("SELECT sum(total_amount_minor) FROM platform_credit_note WHERE invoice_id = '"
                + inv.getId() + "'"));
    }

    @Test
    void intraStateSubscriptionSplitsCgstAndSgst() {
        try (Ctx c = new Ctx(false)) {
            String pp = seedSubscriptionPayment(c, "23", "CGST_SGST");
            PlatformInvoice inv = c.tx(x -> x.invoiceService.generateInvoice(pp));
            assertEquals(9_000L, inv.getCgstAmountMinor());
            assertEquals(9_000L, inv.getSgstAmountMinor());
            assertEquals(0L, inv.getIgstAmountMinor());
            assertEquals("23", inv.getPlaceOfSupply());
            PlatformCreditNote n = c.tx(x -> x.creditNotes.issueStaffCreditNote(inv.getId(), 11_801L, "Waiver", "ops"));
            assertEquals(11_801L, n.getTotalAmountMinor());
            assertEquals(n.getBaseAmountMinor() + n.getCgstAmountMinor() + n.getSgstAmountMinor(), n.getTotalAmountMinor());
            assertEquals(900, n.getCgstRateBps());
            assertEquals(900, n.getSgstRateBps());
            assertNull(n.getVendorRefundId());
        }
    }

    @Test
    void duplicatePaymentIsNeverInvoicedNorCredited() {
        try (Ctx c = new Ctx(false)) {
            String pp = seedSubscriptionPayment(c, "27", "IGST");
            c.tx(x -> {
                PlatformPayment p = x.payments.findById(pp).orElseThrow();
                p.setDisposition(PlatformPaymentDisposition.DUPLICATE);
                return x.payments.saveAndFlush(p);
            });
            assertThrows(PlatformInvoiceService.NotInvoiceableException.class,
                    () -> c.tx(x -> x.invoiceService.generateInvoice(pp)));
            assertTrue(c.tx(x -> x.creditNotes.issueForRefund(pp, "rfnd_dup_" + runTag, 1_000L, null, "ops")).isEmpty());
        }
    }

    @Test
    void legacyPackInvoiceKeepsInvAicredNumberingWithTheFlagOff() {
        try (Ctx c = new Ctx(false)) {
            Institute buyer = new Institute();
            buyer.setId("inst-pack-" + runTag);
            buyer.setInstituteName("Pack Buyer");
            buyer.setStateCode("23");
            when(c.institutes.findById(buyer.getId())).thenReturn(Optional.of(buyer));
            String pp = c.tx(x -> {
                PlatformPayment p = new PlatformPayment();
                p.setInstituteId(buyer.getId());
                p.setVendor("RAZORPAY");
                p.setCurrency("INR");
                p.setBaseAmountMinor(50_000L);
                p.setTaxAmountMinor(9_000L);
                p.setTotalAmountMinor(59_000L);
                p.setStatus(PlatformPaymentStatus.SUCCESS);
                p.setPaymentStatus(PlatformPaymentResult.PAID);
                p = x.payments.saveAndFlush(p);
                PlatformPaymentItem i = new PlatformPaymentItem();
                i.setPlatformPaymentId(p.getId());
                i.setPackId("pack-1");
                i.setPackCodeSnapshot("STARTER");
                i.setCredits(new BigDecimal("500"));
                i.setCurrency("INR");
                i.setBaseAmountMinor(50_000L);
                i.setTaxRateBps(1800);
                i.setTaxAmountMinor(9_000L);
                i.setTotalAmountMinor(59_000L);
                i.setHsnSacSnapshot("998313");
                x.items.saveAndFlush(i);
                return p.getId();
            });
            PlatformInvoice inv = c.tx(x -> x.invoiceService.generateInvoice(pp));
            assertTrue(inv.getInvoiceNumber().matches("INV-AICRED-202610-\\d{4}"), inv.getInvoiceNumber());
            assertNull(inv.getSeriesKey());
            assertNull(inv.getFy());
            assertEquals(PlatformPaymentItemKind.CREDIT_PACK, inv.getSourceKind());
            assertEquals(4_500L, inv.getCgstAmountMinor());   // same state (23): CGST + SGST as before
            assertEquals(4_500L, inv.getSgstAmountMinor());
            assertEquals(59_000L, inv.getTotalAmountMinor());
        }
    }

    /** Four webhook threads for the same payment: exactly one invoice and one number. */
    @Test
    void concurrentGenerateForOnePaymentIssuesOneInvoice() throws Exception {
        String pp;
        try (Ctx c = new Ctx(true)) {
            pp = seedSubscriptionPayment(c, "27", "IGST");
        }
        long seqBefore = count("SELECT COALESCE(max(next_no), 1) FROM platform_document_sequence WHERE series_key = 'I'");
        int threads = 4;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<String>> fs = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            Callable<String> job = () -> {
                try (Ctx c = new Ctx(true)) {
                    start.await();
                    return c.tx(x -> x.invoiceService.generateInvoice(pp)).getInvoiceNumber();
                }
            };
            fs.add(pool.submit(job));
        }
        start.countDown();
        List<String> numbers = new ArrayList<>();
        for (Future<String> f : fs) {
            numbers.add(f.get());
        }
        pool.shutdown();
        assertEquals(1, numbers.stream().distinct().count(), numbers.toString());
        assertEquals(1, count("SELECT count(*) FROM platform_invoice WHERE platform_payment_id = '" + pp + "'"));
        long seqAfter = count("SELECT max(next_no) FROM platform_document_sequence WHERE series_key = 'I'");
        assertEquals(seqBefore + 1, seqAfter, "exactly one number consumed");
    }

    static String firstLineSac(String invoiceId) throws Exception {
        try (Connection c = DriverManager.getConnection(url); Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT hsn_sac_code FROM platform_invoice_line_item WHERE platform_invoice_id = '"
                     + invoiceId + "'")) {
            rs.next();
            return rs.getString(1);
        }
    }
}
