package vacademy.io.admin_core_service.features.credits.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackPurchaseResponseDTO;
import vacademy.io.admin_core_service.features.credits.dto.PlatformInvoiceSummaryDTO;
import vacademy.io.admin_core_service.features.credits.entity.CreditPack;
import vacademy.io.admin_core_service.features.credits.entity.CreditPackPrice;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackPriceRepository;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.admin_core_service.features.credits.util.CurrencyResolver;
import vacademy.io.admin_core_service.features.credits.util.ReturnUrlPolicy;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformBillingProfileRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformBillingFlags;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoiceService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Credit-pack ordering with every new flag at its default: prices, tax and the Razorpay request
 * stay exactly as before; the safety fixes (profile instead of institutes, order-time snapshot,
 * 48 h link, return-URL allow-list, pack-less invoice rows, no back-fill of DUPLICATE payments)
 * are the only differences.
 */
class CreditPackServiceTest {

    private static final String INST = "inst-1";

    private InstituteRepository instituteRepository;
    private CreditPackRepository packRepository;
    private CreditPackPriceRepository priceRepository;
    private PlatformPaymentRepository paymentRepository;
    private PlatformPaymentItemRepository itemRepository;
    private PlatformInvoiceRepository invoiceRepository;
    private PlatformPaymentConfigService configService;
    private RazorpayPaymentManager razorpay;
    private PlatformInvoiceService invoiceService;
    private PlatformBillingProfileRepository profileRepository;
    private ReturnUrlPolicy returnUrlPolicy;
    private PlatformBillingFlags flags;
    private BrandModeService brandModeService;
    private CreditPackService service;

    private Institute institute;
    private final Map<String, PlatformPayment> payments = new HashMap<>();
    private final List<PlatformPaymentItem> items = new ArrayList<>();
    private final Map<String, PlatformBillingProfile> profiles = new HashMap<>();

    @BeforeEach
    void setUp() {
        instituteRepository = mock(InstituteRepository.class);
        packRepository = mock(CreditPackRepository.class);
        priceRepository = mock(CreditPackPriceRepository.class);
        paymentRepository = mock(PlatformPaymentRepository.class);
        itemRepository = mock(PlatformPaymentItemRepository.class);
        invoiceRepository = mock(PlatformInvoiceRepository.class);
        configService = mock(PlatformPaymentConfigService.class);
        razorpay = mock(RazorpayPaymentManager.class);
        invoiceService = mock(PlatformInvoiceService.class);
        profileRepository = mock(PlatformBillingProfileRepository.class);
        returnUrlPolicy = mock(ReturnUrlPolicy.class);
        flags = mock(PlatformBillingFlags.class);
        brandModeService = mock(BrandModeService.class);

        institute = new Institute();
        institute.setId(INST);
        institute.setInstituteName("Shiksha Nation");
        institute.setCountry("India");
        institute.setAddress("12 MG Road");
        when(instituteRepository.findById(INST)).thenReturn(Optional.of(institute));

        CreditPack pack = new CreditPack();
        pack.setId("pack-1");
        pack.setCode("PACK_500");
        pack.setName("Pack 500");
        pack.setCredits(new BigDecimal("500"));
        pack.setHsnSacCode("998313");
        pack.setIsActive(true);
        when(packRepository.findById("pack-1")).thenReturn(Optional.of(pack));
        when(packRepository.findByIsActiveTrueOrderByDisplayOrderAsc()).thenReturn(List.of(pack));
        CreditPackPrice price = new CreditPackPrice();
        price.setPackId("pack-1");
        price.setCurrency("INR");
        price.setAmountMinor(50000L);
        when(priceRepository.findByPackIdAndCurrencyAndIsActiveTrue("pack-1", "INR")).thenReturn(Optional.of(price));

        PlatformPaymentConfig config = new PlatformPaymentConfig();
        config.setSupplierStateCode("23");
        when(configService.load()).thenReturn(config);
        when(configService.getRazorpayCredsMap()).thenReturn(Map.of("apiKey", "k"));

        when(paymentRepository.saveAndFlush(any())).thenAnswer(i -> {
            PlatformPayment p = i.getArgument(0);
            if (p.getId() == null) p.setId("pp-1");
            payments.put(p.getId(), p);
            return p;
        });
        when(paymentRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(paymentRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(payments.get(i.<String>getArgument(0))));
        when(itemRepository.save(any())).thenAnswer(i -> {
            items.add(i.getArgument(0));
            return i.getArgument(0);
        });
        when(profileRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(profiles.get(i.<String>getArgument(0))));
        when(profileRepository.save(any())).thenAnswer(i -> {
            PlatformBillingProfile p = i.getArgument(0);
            profiles.put(p.getInstituteId(), p);
            return p;
        });
        when(returnUrlPolicy.sanitize(eq(INST), anyString())).thenAnswer(i -> i.getArgument(1));
        when(brandModeService.resolve(INST)).thenReturn(BrandMode.VACADEMY);
        when(razorpay.createPaymentLink(any(), any(), any(), any(), any())).thenReturn(Map.of(
                "paymentLinkId", "plink_1", "paymentLinkUrl", "https://rzp.io/i/x", "razorpayKeyId", "k"));

        service = new CreditPackService(packRepository, priceRepository, instituteRepository, paymentRepository,
                itemRepository, invoiceRepository, configService, new CurrencyResolver(), new TaxResolver(),
                razorpay, invoiceService, new PlatformBillingProfileService(profileRepository), returnUrlPolicy,
                flags, brandModeService, mock(PlatformTransactionManager.class));
    }

    private static UserDTO buyer() {
        return UserDTO.builder().id("u1").email("a@b.test").build();
    }

    @Test
    void legacyInterStateBuyerIsPricedAndLinkedExactlyAsBefore() {
        institute.setStateCode("27"); // a pre-V590 institute, no profile row

        Instant before = Instant.now();
        CreditPackPurchaseResponseDTO r = service.createOrder(INST, "pack-1", buyer(),
                "https://dash.vacademy.io/settings", null, null);

        assertEquals(59000L, r.getAmountMinor());
        assertEquals("https://rzp.io/i/x", r.getPaymentLinkUrl());
        PlatformPayment p = payments.get("pp-1");
        assertEquals(50000L, p.getBaseAmountMinor());
        assertEquals(9000L, p.getTaxAmountMinor());
        assertEquals(59000L, p.getTotalAmountMinor());
        // order-time snapshot (critique #2)
        assertEquals("Shiksha Nation", p.getBuyerLegalName());
        assertEquals("27", p.getBuyerStateCode());
        assertEquals("27", p.getPlaceOfSupply());
        assertEquals("IGST", p.getTaxHead());
        assertEquals("VACADEMY", p.getBrandMode());
        assertEquals("12 MG Road, India", p.getBuyerAddress(), "same string the legacy invoice built");
        assertEquals(PlatformPaymentDisposition.NORMAL, p.getDisposition());
        assertEquals("plink_1", p.getVendorOrderId());

        ArgumentCaptor<PaymentInitiationRequestDTO> req = ArgumentCaptor.forClass(PaymentInitiationRequestDTO.class);
        ArgumentCaptor<String> callback = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<RazorpayPaymentManager.PaymentLinkOptions> opts =
                ArgumentCaptor.forClass(RazorpayPaymentManager.PaymentLinkOptions.class);
        verify(razorpay).createPaymentLink(any(), req.capture(), any(), callback.capture(), opts.capture());
        assertEquals(590.0, req.getValue().getAmount());
        assertEquals("pp-1", req.getValue().getOrderId());
        assertEquals("Pack 500 — 500 AI credits", req.getValue().getDescription());
        assertEquals("https://dash.vacademy.io/settings?topup_pp=pp-1", callback.getValue());
        // F7: 48 h expiry, frozen on the row too
        Instant expireBy = opts.getValue().expireBy();
        assertTrue(!expireBy.isBefore(before.plus(Duration.ofHours(48)))
                && expireBy.isBefore(Instant.now().plus(Duration.ofHours(48)).plusSeconds(1)));
        assertEquals(expireBy, p.getLinkExpiresAt());
        assertNull(opts.getValue().checkoutName(), "pack links keep the account business name");

        PlatformPaymentItem item = items.get(0);
        assertEquals(PlatformPaymentItemKind.CREDIT_PACK, item.getItemKind());
        assertEquals("pack-1", item.getPackId());
        assertEquals(1800, item.getTaxRateBps());
        verify(instituteRepository, never()).save(any());
    }

    @Test
    void intraStateBuyerStillSplitsCgstAndSgst() {
        institute.setStateCode("23");
        service.createOrder(INST, "pack-1", buyer(), null, null, null);
        PlatformPayment p = payments.get("pp-1");
        assertEquals(9000L, p.getTaxAmountMinor());
        assertEquals("CGST_SGST", p.getTaxHead());
        assertEquals("23", p.getPlaceOfSupply());
    }

    @Test
    void gstDetailsGoToTheProfileNotTheInstitute() {
        service.createOrder(INST, "pack-1", buyer(), null, "29ABCDE1234F1Z5", "29");

        assertEquals("29ABCDE1234F1Z5", profiles.get(INST).getGstin());
        assertNull(institute.getGstin());
        assertNull(institute.getStateCode());
        verify(instituteRepository, never()).save(any());
        PlatformPayment p = payments.get("pp-1");
        assertEquals("29ABCDE1234F1Z5", p.getBuyerGstin());
        assertEquals("29", p.getPlaceOfSupply());
        assertEquals("IGST", p.getTaxHead());
    }

    @Test
    void noStateIsAllowedByDefaultAndRefusedWhenTheFlagIsOn() {
        service.createOrder(INST, "pack-1", buyer(), null, null, null);
        PlatformPayment p = payments.get("pp-1");
        assertEquals("23", p.getPlaceOfSupply(), "legacy: supplier state, IGST");
        assertEquals("IGST", p.getTaxHead());

        when(flags.buyerStateRequiredForPacks()).thenReturn(true);
        TaxResolver.TaxException e = assertThrows(TaxResolver.TaxException.class,
                () -> service.createOrder(INST, "pack-1", buyer(), null, null, null));
        assertEquals(TaxResolver.BUYER_STATE_REQUIRED, e.getCode());
    }

    @Test
    void aRefusedReturnUrlMeansNoCallbackButTheOrderStillGoesThrough() {
        when(returnUrlPolicy.sanitize(eq(INST), anyString())).thenReturn(null);
        CreditPackPurchaseResponseDTO r = service.createOrder(INST, "pack-1", buyer(), "https://evil.example/", null, null);
        assertNotNull(r.getPaymentLinkUrl());
        verify(razorpay).createPaymentLink(any(), any(), any(), isNull(), any());
    }

    @Test
    void listingUsesTheProfileStateWithTheSameMath() {
        institute.setStateCode("27");
        List<CreditPackDTO> before = service.listPacksForInstitute(INST);
        assertEquals(59000L, before.get(0).getTotalAmountMinor());
        assertEquals(1800, before.get(0).getTaxRateBps());

        service.createOrder(INST, "pack-1", buyer(), null, null, "23");
        List<CreditPackDTO> after = service.listPacksForInstitute(INST);
        assertEquals(59000L, after.get(0).getTotalAmountMinor());
    }

    @Test
    void invoiceListHandlesPackLessItemsAndNeverBackFillsDuplicates() {
        PlatformPayment sub = new PlatformPayment();
        sub.setId("pp-sub");
        sub.setInstituteId(INST);
        sub.setPaymentStatus(PlatformPaymentResult.PAID);
        PlatformPayment dup = new PlatformPayment();
        dup.setId("pp-dup");
        dup.setInstituteId(INST);
        dup.setPaymentStatus(PlatformPaymentResult.PAID);
        dup.setDisposition(PlatformPaymentDisposition.DUPLICATE);
        when(paymentRepository.findByInstituteIdAndPaymentStatusInOrderByCreatedAtDesc(eq(INST), any()))
                .thenReturn(List.of(sub, dup));

        PlatformInvoice inv = new PlatformInvoice();
        inv.setId("inv-1");
        inv.setPlatformPaymentId("pp-sub");
        inv.setInvoiceNumber("VT/2627/I00001");
        inv.setCurrency("INR");
        inv.setTotalAmountMinor(118000L);
        when(invoiceRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(INST)).thenReturn(new ArrayList<>(List.of(inv)));
        PlatformPaymentItem subItem = new PlatformPaymentItem();
        subItem.setPlatformPaymentId("pp-sub");
        subItem.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
        subItem.setPackCodeSnapshot("AI_SUB:pro");
        subItem.setCredits(BigDecimal.ZERO);
        subItem.setDescriptionSnapshot("AI Pro subscription, 01-11-2026 to 30-11-2026");
        when(itemRepository.findByPlatformPaymentId("pp-sub")).thenReturn(List.of(subItem));

        List<PlatformInvoiceSummaryDTO> out = service.listInvoices(INST);

        assertEquals(1, out.size());
        assertEquals("AI Pro subscription, 01-11-2026 to 30-11-2026", out.get(0).getPackName());
        verify(packRepository, never()).findById(isNull());
        verify(invoiceService, never()).generateInvoice("pp-dup");
    }

    @Test
    void missingPackInvoiceIsStillBackFilledAsBefore() {
        PlatformPayment paid = new PlatformPayment();
        paid.setId("pp-old");
        paid.setInstituteId(INST);
        paid.setPaymentStatus(PlatformPaymentResult.PAID);
        when(paymentRepository.findByInstituteIdAndPaymentStatusInOrderByCreatedAtDesc(eq(INST), any()))
                .thenReturn(List.of(paid));
        when(invoiceRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(INST)).thenReturn(new ArrayList<>());
        PlatformPaymentItem item = new PlatformPaymentItem();
        item.setPlatformPaymentId("pp-old");
        item.setPackId("pack-1");
        item.setPackCodeSnapshot("PACK_500");
        item.setCredits(new BigDecimal("500"));
        when(itemRepository.findByPlatformPaymentId("pp-old")).thenReturn(List.of(item));
        PlatformInvoice inv = new PlatformInvoice();
        inv.setId("inv-old");
        inv.setPlatformPaymentId("pp-old");
        inv.setCurrency("INR");
        inv.setTotalAmountMinor(59000L);
        when(invoiceService.generateInvoice("pp-old")).thenReturn(inv);

        List<PlatformInvoiceSummaryDTO> out = service.listInvoices(INST);

        assertEquals(1, out.size());
        assertEquals("Pack 500", out.get(0).getPackName());
        assertEquals(new BigDecimal("500"), out.get(0).getCredits());
    }
}
