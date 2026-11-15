package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttribute;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceAttributeValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductOption;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductTranslation;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariant;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceVariantOptionValue;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductAttributeValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductCollectionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductOptionRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductTranslationRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantOptionValueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.level.repository.LevelRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.institute.entity.session.Session;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.BiConsumer;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Rules of {@link CommerceProductService}. The repositories are
 * mocks backed by lists, so a second call reads what the first one wrote.
 */
class CommerceProductServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OTHER_INSTITUTE = "inst-2";
    private static final String ACTOR = "user-1";
    private static final String COLOUR = "attr-colour";
    private static final String RED = "val-red";
    private static final String BLUE = "val-blue";
    private static final String GREEN = "val-green";

    private final CommerceProductRepository productRepository = mock(CommerceProductRepository.class);
    private final CommerceProductTranslationRepository translationRepository =
            mock(CommerceProductTranslationRepository.class);
    private final CommerceVariantRepository variantRepository = mock(CommerceVariantRepository.class);
    private final CommerceAttributeRepository attributeRepository = mock(CommerceAttributeRepository.class);
    private final CommerceAttributeValueRepository attributeValueRepository =
            mock(CommerceAttributeValueRepository.class);
    private final CommerceProductAttributeValueRepository productAttributeValueRepository =
            mock(CommerceProductAttributeValueRepository.class);
    private final CommerceProductOptionRepository productOptionRepository =
            mock(CommerceProductOptionRepository.class);
    private final CommerceVariantOptionValueRepository variantOptionValueRepository =
            mock(CommerceVariantOptionValueRepository.class);
    private final CommerceCollectionRepository collectionRepository = mock(CommerceCollectionRepository.class);
    private final CommerceProductCollectionRepository productCollectionRepository =
            mock(CommerceProductCollectionRepository.class);
    private final CommerceVariantLegacyRepository variantLegacyRepository =
            mock(CommerceVariantLegacyRepository.class);
    private final PackageRepository packageRepository = mock(PackageRepository.class);
    private final PackageInstituteRepository packageInstituteRepository = mock(PackageInstituteRepository.class);
    private final PackageSessionRepository packageSessionRepository = mock(PackageSessionRepository.class);
    private final LevelRepository levelRepository = mock(LevelRepository.class);
    private final SessionRepository sessionRepository = mock(SessionRepository.class);
    private final InstituteRepository instituteRepository = mock(InstituteRepository.class);
    private final EnrollInviteRepository enrollInviteRepository = mock(EnrollInviteRepository.class);
    private final PackageSessionLearnerInvitationToPaymentOptionRepository linkRepository =
            mock(PackageSessionLearnerInvitationToPaymentOptionRepository.class);
    private final PaymentOptionRepository paymentOptionRepository = mock(PaymentOptionRepository.class);
    private final PaymentPlanRepository paymentPlanRepository = mock(PaymentPlanRepository.class);
    private final CommerceAuditService auditService = mock(CommerceAuditService.class);
    private final CommerceTaxClassService taxClassService = mock(CommerceTaxClassService.class);
    private final StockLocationRepository locationRepository = mock(StockLocationRepository.class);

    private final List<PackageEntity> packages = new ArrayList<>();
    private final List<PackageInstitute> packageInstitutes = new ArrayList<>();
    private final List<PackageSession> sessions = new ArrayList<>();
    private final List<EnrollInvite> invites = new ArrayList<>();
    private final List<PaymentOption> options = new ArrayList<>();
    private final List<PaymentPlan> plans = new ArrayList<>();
    private final List<PackageSessionLearnerInvitationToPaymentOption> links = new ArrayList<>();
    private final List<CommerceProduct> products = new ArrayList<>();
    private final List<CommerceProductTranslation> translations = new ArrayList<>();
    private final List<CommerceProductOption> productOptions = new ArrayList<>();
    private final List<CommerceVariant> variants = new ArrayList<>();
    private final List<CommerceVariantOptionValue> optionRows = new ArrayList<>();

    private int nextId = 1;
    private CommerceProductService service;

    @BeforeEach
    void setUp() {
        service = new CommerceProductService(productRepository, translationRepository, variantRepository,
                attributeRepository, attributeValueRepository, productAttributeValueRepository,
                productOptionRepository, variantOptionValueRepository, collectionRepository,
                productCollectionRepository, variantLegacyRepository, packageRepository,
                packageInstituteRepository, packageSessionRepository, levelRepository, sessionRepository,
                instituteRepository, enrollInviteRepository, linkRepository, paymentOptionRepository,
                paymentPlanRepository, auditService, taxClassService, new DocumentClock(), locationRepository);

        // Legacy rows.
        doAnswer(stored(packages, PackageEntity::getId, PackageEntity::setId)).when(packageRepository).save(any());
        doAnswer(stored(packageInstitutes, PackageInstitute::getId, PackageInstitute::setId))
                .when(packageInstituteRepository).save(any());
        doAnswer(stored(sessions, PackageSession::getId, PackageSession::setId))
                .when(packageSessionRepository).save(any());
        doAnswer(stored(invites, EnrollInvite::getId, EnrollInvite::setId)).when(enrollInviteRepository).save(any());
        doAnswer(stored(options, PaymentOption::getId, PaymentOption::setId))
                .when(paymentOptionRepository).save(any());
        doAnswer(stored(plans, PaymentPlan::getId, PaymentPlan::setId)).when(paymentPlanRepository).save(any());
        doAnswer(stored(links, PackageSessionLearnerInvitationToPaymentOption::getId,
                PackageSessionLearnerInvitationToPaymentOption::setId)).when(linkRepository).save(any());

        // Commerce rows.
        doAnswer(stored(products, CommerceProduct::getId, CommerceProduct::setId)).when(productRepository).save(any());
        doAnswer(stored(productOptions, CommerceProductOption::getId, CommerceProductOption::setId))
                .when(productOptionRepository).save(any());
        doAnswer(stored(variants, CommerceVariant::getId, CommerceVariant::setId)).when(variantRepository).save(any());
        doAnswer(stored(optionRows, CommerceVariantOptionValue::getId, CommerceVariantOptionValue::setId))
                .when(variantOptionValueRepository).save(any());
        doAnswer(inv -> {
            List<CommerceProductTranslation> saved = new ArrayList<>();
            for (CommerceProductTranslation t : inv.<Iterable<CommerceProductTranslation>>getArgument(0)) {
                if (t.getId() == null) {
                    t.setId("id-" + nextId++);
                    translations.add(t);
                }
                saved.add(t);
            }
            return saved;
        }).when(translationRepository).saveAll(anyIterable());

        // Reads, all scoped the way the service scopes them.
        when(productRepository.findByInstituteIdAndPackageId(anyString(), anyString())).thenAnswer(inv ->
                products.stream().filter(p -> p.getInstituteId().equals(inv.getArgument(0))
                        && p.getPackageId().equals(inv.getArgument(1))).findFirst());
        when(productRepository.findByInstituteIdAndExternalRef(anyString(), anyString())).thenAnswer(inv ->
                products.stream().filter(p -> p.getInstituteId().equals(inv.getArgument(0))
                        && inv.getArgument(1).equals(p.getExternalRef())).findFirst());
        when(packageRepository.findById(anyString())).thenAnswer(inv ->
                packages.stream().filter(p -> p.getId().equals(inv.getArgument(0))).findFirst());
        when(translationRepository.findByInstituteIdAndPackageId(anyString(), anyString())).thenAnswer(inv ->
                translations.stream().filter(t -> t.getInstituteId().equals(inv.getArgument(0))
                        && t.getPackageId().equals(inv.getArgument(1))).toList());
        when(productOptionRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(anyString(), anyString()))
                .thenAnswer(inv -> productOptions.stream().filter(o -> o.getInstituteId().equals(inv.getArgument(0))
                        && o.getPackageId().equals(inv.getArgument(1))).toList());
        when(variantRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(anyString(), anyString()))
                .thenAnswer(inv -> variants.stream().filter(v -> v.getInstituteId().equals(inv.getArgument(0))
                        && v.getPackageId().equals(inv.getArgument(1))).toList());
        when(variantRepository.findByInstituteIdAndPackageSessionId(anyString(), anyString())).thenAnswer(inv ->
                variants.stream().filter(v -> v.getInstituteId().equals(inv.getArgument(0))
                        && v.getPackageSessionId().equals(inv.getArgument(1))).findFirst());
        when(variantRepository.findByInstituteIdAndSku(anyString(), anyString())).thenAnswer(inv ->
                variants.stream().filter(v -> v.getInstituteId().equals(inv.getArgument(0))
                        && v.getSku().equals(inv.getArgument(1))).findFirst());
        when(packageSessionRepository.findAllById(anyIterable())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            return sessions.stream().filter(s -> ids.contains(s.getId())).toList();
        });
        // Like the query: only this institute's COMMERCE-tagged invites count as the variant's link.
        when(variantLegacyRepository.findLinksByPackageSessionIds(anyCollection(), anyString(), anyString())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            return links.stream().filter(l -> ids.contains(l.getPackageSession().getId())
                    && inv.getArgument(1).equals(l.getEnrollInvite().getInstituteId())
                    && inv.getArgument(2).equals(l.getEnrollInvite().getTag())).toList();
        });
        when(variantLegacyRepository.findPlansByPaymentOptionIds(anyCollection(), eq("ACTIVE"))).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(0);
            return plans.stream().filter(p -> ids.contains(p.getPaymentOption().getId())).toList();
        });
        when(variantOptionValueRepository.findByInstituteIdAndPackageSessionIdIn(anyString(), anyCollection()))
                .thenAnswer(inv -> {
                    Collection<String> ids = inv.getArgument(1);
                    return optionRows.stream().filter(r -> r.getInstituteId().equals(inv.getArgument(0))
                            && ids.contains(r.getPackageSessionId())).toList();
                });

        // Reference data of INSTITUTE only: another institute finds nothing.
        Level level = new Level();
        level.setId("DEFAULT");
        Session session = new Session();
        session.setId("DEFAULT");
        Institute institute = new Institute();
        institute.setId(INSTITUTE);
        when(levelRepository.findById("DEFAULT")).thenReturn(Optional.of(level));
        when(sessionRepository.findById("DEFAULT")).thenReturn(Optional.of(session));
        when(instituteRepository.findById(INSTITUTE)).thenReturn(Optional.of(institute));
        Institute otherInstitute = new Institute();
        otherInstitute.setId(OTHER_INSTITUTE);
        when(instituteRepository.findById(OTHER_INSTITUTE)).thenReturn(Optional.of(otherInstitute));

        CommerceAttribute colour = new CommerceAttribute();
        colour.setId(COLOUR);
        colour.setInstituteId(INSTITUTE);
        colour.setCode("colour");
        List<CommerceAttributeValue> values = List.of(value(RED, "Red"), value(BLUE, "Blue"), value(GREEN, "Green"));
        when(attributeRepository.findByInstituteIdAndIdIn(eq(INSTITUTE), anyCollection())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(1);
            return ids.contains(COLOUR) ? List.of(colour) : List.of();
        });
        when(attributeValueRepository.findByInstituteIdAndIdIn(eq(INSTITUTE), anyCollection())).thenAnswer(inv -> {
            Collection<String> ids = inv.getArgument(1);
            return values.stream().filter(v -> ids.contains(v.getId())).toList();
        });
    }

    // ------------------------------------------------------------------ tests

    @Test
    void threeVariantsAreWrittenInOneCallWithExactlyTheRowsOfTheDesign() {
        ProductResponse response = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));

        assertEquals(1, packages.size());
        assertEquals("PRODUCT", packages.get(0).getPackageType());
        assertEquals("ACTIVE", packages.get(0).getStatus());
        assertEquals(1, packageInstitutes.size());
        assertEquals(INSTITUTE, packageInstitutes.get(0).getInstituteEntity().getId());
        assertEquals(1, products.size());
        assertEquals(INSTITUTE, products.get(0).getInstituteId());
        assertEquals("ACTIVE", products.get(0).getStatus());
        assertNotNull(products.get(0).getPublishedAt());

        assertEquals(3, sessions.size());
        assertEquals(List.of("Red", "Blue", "Green"), sessions.stream().map(PackageSession::getName).toList());
        for (PackageSession session : sessions) {
            assertEquals("DEFAULT", session.getLevel().getId());
            assertEquals("DEFAULT", session.getSession().getId());
            assertSame(packages.get(0), session.getPackageEntity());
            assertEquals("ACTIVE", session.getStatus());
            assertNull(session.getEnrollmentPolicySettings());
            // TRACKED: max_seats is not null and nothing is sellable before a receipt.
            assertEquals(Integer.valueOf(0), session.getMaxSeats());
            assertEquals(Integer.valueOf(0), session.getAvailableSlots());
        }

        assertEquals(3, invites.size());
        for (EnrollInvite invite : invites) {
            assertNull(invite.getLearnerAccessDays());
            assertEquals(INSTITUTE, invite.getInstituteId());
            assertEquals(CommerceProductService.INVITE_TAG, invite.getTag());
            assertEquals("ACTIVE", invite.getStatus());
        }
        assertEquals(3, invites.stream().map(EnrollInvite::getInviteCode).distinct().count());

        assertEquals(3, options.size());
        for (int i = 0; i < 3; i++) {
            assertEquals("PACKAGE_SESSION", options.get(i).getSource());
            assertEquals(sessions.get(i).getId(), options.get(i).getSourceId());
            assertEquals("ONE_TIME", options.get(i).getType());
            assertEquals(Boolean.FALSE, options.get(i).getRegionalPricingEnabled());
        }

        assertEquals(3, plans.size());
        assertEquals(List.of(1200.0, 1250.5, 1300.0), plans.stream().map(PaymentPlan::getActualPrice).toList());
        for (int i = 0; i < 3; i++) {
            assertNull(plans.get(i).getValidityInDays());
            assertEquals("INR", plans.get(i).getCurrency());
            assertSame(options.get(i), plans.get(i).getPaymentOption());
        }

        assertEquals(3, links.size());
        for (int i = 0; i < 3; i++) {
            assertSame(invites.get(i), links.get(i).getEnrollInvite());
            assertSame(sessions.get(i), links.get(i).getPackageSession());
            assertSame(options.get(i), links.get(i).getPaymentOption());
        }

        assertEquals(3, variants.size());
        assertEquals(List.of("SARI-RED", "SARI-BLUE", "SARI-GREEN"),
                variants.stream().map(CommerceVariant::getSku).toList());
        assertEquals(3, optionRows.size());

        assertEquals(3, response.getVariants().size());
        VariantResponse blue = response.getVariants().get(1);
        assertEquals(0, new BigDecimal("1250.5").compareTo(blue.getPrice()));
        assertEquals(Map.of(COLOUR, BLUE), blue.getOptionValues());
        assertEquals(plans.get(1).getId(), blue.getPaymentPlanId());

        assertEquals("cotton sari sari-red sari-blue sari-green red blue green", translations.get(0).getSearchText());
        verify(auditService).record(eq(INSTITUTE), eq(ACTOR), eq("PRODUCT_CREATED"), eq("PRODUCT"),
                eq(packages.get(0).getId()), anyString());
    }

    @Test
    void aDraftIsHiddenFromEveryLegacyReader() {
        service.save(INSTITUTE, ACTOR, sariRequest(null));

        assertEquals("DRAFT", products.get(0).getStatus());
        assertNull(products.get(0).getPublishedAt());
        assertEquals("DELETED", packages.get(0).getStatus());
        assertTrue(sessions.stream().allMatch(s -> "DELETED".equals(s.getStatus())));
        assertTrue(invites.stream().allMatch(i -> "DELETED".equals(i.getStatus())));
        assertTrue(links.stream().allMatch(l -> "DELETED".equals(l.getStatus())));
    }

    @Test
    void anArchivedVariantOfALiveProductIsHiddenAndTheOthersStayOnSale() {
        ProductResponse created = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));
        VariantRequest archive = new VariantRequest();
        archive.setStatus("ARCHIVED");

        service.updateVariant(INSTITUTE, ACTOR, created.getVariants().get(0).getPackageSessionId(), archive);

        assertEquals(List.of("DELETED", "ACTIVE", "ACTIVE"), sessions.stream().map(PackageSession::getStatus).toList());
        assertEquals(3, variants.size());
    }

    @Test
    void twoVariantsWithTheSameOptionValuesAreRefused() {
        ProductRequest request = sariRequest(null);
        request.getVariants().get(1).setOptionValues(Map.of(COLOUR, RED));

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.save(INSTITUTE, ACTOR, request));
        assertTrue(e.getMessage().contains("same option values"));
    }

    @Test
    void aVariantMustCarryEveryOptionOfTheProduct() {
        ProductRequest request = sariRequest(null);
        request.getVariants().get(2).setOptionValues(Map.of());

        assertThrows(InvalidRequestException.class, () -> service.save(INSTITUTE, ACTOR, request));
    }

    @Test
    void noInvitedSessionIsWrittenAndTheLegacyCreatorsAreNotEvenDependencies() {
        service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));

        ArgumentCaptor<PackageSession> saved = ArgumentCaptor.forClass(PackageSession.class);
        verify(packageSessionRepository, times(6)).save(saved.capture());
        for (PackageSession session : saved.getAllValues()) {
            assertTrue(!"INVITED".equals(session.getStatus()));
            assertEquals("DEFAULT", session.getLevel().getId());
            assertEquals("DEFAULT", session.getSession().getId());
        }
        assertEquals(3, sessions.size());
        // PackageSessionService.createPackageSession and the default invite cannot be called:
        // the service has no reference to either class.
        assertTrue(Arrays.stream(CommerceProductService.class.getDeclaredFields()).noneMatch(f ->
                f.getType().equals(PackageSessionService.class)
                        || f.getType().equals(DefaultEnrollInviteService.class)));
    }

    @Test
    void savingTheSameExternalRefAgainUpdatesAndCreatesNothing() {
        ProductResponse first = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));
        ProductResponse second = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));

        assertEquals(first.getPackageId(), second.getPackageId());
        assertEquals(1, packages.size());
        assertEquals(1, packageInstitutes.size());
        assertEquals(1, products.size());
        assertEquals(1, translations.size());
        assertEquals(1, productOptions.size());
        assertEquals(3, sessions.size());
        assertEquals(3, invites.size());
        assertEquals(3, options.size());
        assertEquals(3, plans.size());
        assertEquals(3, links.size());
        assertEquals(3, variants.size());
        assertEquals(3, optionRows.size());
        // The first call saved each new session twice (insert, then ACTIVE); the second call saved none.
        verify(packageSessionRepository, times(6)).save(any());
        verify(auditService).record(eq(INSTITUTE), eq(ACTOR), eq("PRODUCT_UPDATED"), eq("PRODUCT"),
                eq(first.getPackageId()), anyString());
        verify(auditService, never()).record(anyString(), anyString(), eq("VARIANT_PRICE_CHANGED"), anyString(),
                anyString(), anyString());
    }

    @Test
    void aProductIdOfAnotherInstituteIsRefused() {
        ProductResponse created = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));
        ProductRequest rename = new ProductRequest();
        rename.setBrand("Stolen");

        assertThrows(ResourceNotFoundException.class,
                () -> service.update(OTHER_INSTITUTE, ACTOR, created.getPackageId(), rename));
        assertThrows(ResourceNotFoundException.class, () -> service.get(OTHER_INSTITUTE, created.getPackageId()));
        assertThrows(ResourceNotFoundException.class,
                () -> service.changeStatus(OTHER_INSTITUTE, ACTOR, created.getPackageId(), "ARCHIVED"));
        assertThrows(ResourceNotFoundException.class, () -> service.updateVariant(OTHER_INSTITUTE, ACTOR,
                created.getVariants().get(0).getPackageSessionId(), new VariantRequest()));
        assertNull(products.get(0).getBrand());
        assertEquals("ACTIVE", products.get(0).getStatus());
    }

    @Test
    void anAttributeOfAnotherInstituteIsRefused() {
        // OTHER_INSTITUTE has no attribute with this id, so the lookup scoped to it finds nothing.
        assertThrows(InvalidRequestException.class, () -> service.save(OTHER_INSTITUTE, ACTOR, sariRequest(null)));
    }

    @Test
    void publishingIsRefusedWithoutAVariantOrWithoutAPrice() {
        ProductRequest noVariants = sariRequest("ACTIVE");
        noVariants.setVariants(null);
        assertThrows(InvalidRequestException.class, () -> service.save(INSTITUTE, ACTOR, noVariants));

        ProductRequest noPrice = sariRequest("ACTIVE");
        noPrice.setExternalRef("woo-2");
        noPrice.setSlug("cotton-sari-2");
        noPrice.getVariants().get(0).setPrice(null);
        assertThrows(InvalidRequestException.class, () -> service.save(INSTITUTE, ACTOR, noPrice));
    }

    @Test
    void aTaxClassIdIsCheckedAgainstTheInstituteAndAForeignOneIsRefused() {
        ProductRequest request = sariRequest("DRAFT");
        request.setTaxClassId("tax-1");
        service.save(INSTITUTE, ACTOR, request);
        verify(taxClassService).requireUsableTaxClass(INSTITUTE, "tax-1");
        assertEquals("tax-1", products.get(0).getTaxClassId());

        org.mockito.Mockito.doThrow(new InvalidRequestException("tax_class_id is not a tax class of this institute"))
                .when(taxClassService).requireUsableTaxClass(INSTITUTE, "tax-foreign");
        ProductRequest foreign = new ProductRequest();
        foreign.setTaxClassId("tax-foreign");
        assertThrows(InvalidRequestException.class,
                () -> service.update(INSTITUTE, ACTOR, products.get(0).getPackageId(), foreign));
        assertEquals("tax-1", products.get(0).getTaxClassId());
    }

    @Test
    void everySaveThatLeavesTheProductActiveRunsThePublishRuleAndADraftDoesNot() {
        service.save(INSTITUTE, ACTOR, sariRequest("DRAFT"));
        verify(taxClassService, never()).requireTaxClassForPublish(anyString(), any(), any());

        String packageId = products.get(0).getPackageId();
        service.changeStatus(INSTITUTE, ACTOR, packageId, "ACTIVE");
        verify(taxClassService, times(1)).requireTaxClassForPublish(eq(INSTITUTE), any(), any());

        // An edit of an already active product runs the rule again, so it cannot drop its tax class.
        org.mockito.Mockito.doThrow(new InvalidRequestException("the product needs a tax class before it is published"))
                .when(taxClassService).requireTaxClassForPublish(eq(INSTITUTE), eq(null), any());
        ProductRequest clear = new ProductRequest();
        clear.setTaxClassId("");
        assertThrows(InvalidRequestException.class, () -> service.update(INSTITUTE, ACTOR, packageId, clear));
    }

    @Test
    void anOriginLocationMustBeASourceLocationOfThisInstitute() {
        ProductRequest request = sariRequest("DRAFT");
        request.setOriginLocationId("loc-foreign");
        when(locationRepository.findByInstituteIdAndId(INSTITUTE, "loc-foreign")).thenReturn(Optional.empty());
        assertThrows(InvalidRequestException.class, () -> service.save(INSTITUTE, ACTOR, request));

        StockLocation shop = new StockLocation();
        shop.setSource(false);
        when(locationRepository.findByInstituteIdAndId(INSTITUTE, "loc-shop")).thenReturn(Optional.of(shop));
        request.setOriginLocationId("loc-shop");
        assertThrows(InvalidRequestException.class, () -> service.save(INSTITUTE, ACTOR, request));

        StockLocation centre = new StockLocation();
        centre.setSource(true);
        when(locationRepository.findByInstituteIdAndId(INSTITUTE, "loc-centre")).thenReturn(Optional.of(centre));
        request.setOriginLocationId("loc-centre");
        service.save(INSTITUTE, ACTOR, request);
        assertEquals("loc-centre", products.get(products.size() - 1).getOriginLocationId());
    }

    @Test
    void aCostAtCreationIsTheStandardCostAndAnEditNeverWritesTheAverage() {
        ProductRequest request = sariRequest("DRAFT");
        request.getVariants().get(0).setCostPrice(new BigDecimal("410.5000"));
        ProductResponse created = service.save(INSTITUTE, ACTOR, request);
        CommerceVariant first = variants.stream()
                .filter(v -> v.getPackageSessionId().equals(created.getVariants().get(0).getPackageSessionId()))
                .findFirst().orElseThrow();
        assertEquals(new BigDecimal("410.5000"), first.getCostPrice());
        assertEquals(new BigDecimal("410.5000"), first.getStandardCost());

        VariantRequest change = new VariantRequest();
        change.setCostPrice(new BigDecimal("1.00"));
        service.updateVariant(INSTITUTE, ACTOR, first.getPackageSessionId(), change);
        assertEquals(new BigDecimal("410.5000"), first.getCostPrice());
        assertEquals(new BigDecimal("410.5000"), first.getStandardCost());
    }

    @Test
    void aPriceChangeUpdatesTheSamePaymentPlan() {
        ProductResponse created = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));
        VariantRequest change = new VariantRequest();
        change.setPrice(new BigDecimal("999.00"));

        service.updateVariant(INSTITUTE, ACTOR, created.getVariants().get(0).getPackageSessionId(), change);

        assertEquals(3, plans.size());
        assertEquals(999.0, plans.get(0).getActualPrice());
        // MRP was equal to the old price and is never left below the new one.
        assertEquals(1200.0, plans.get(0).getElevatedPrice());
        assertNull(plans.get(0).getValidityInDays());
        verify(auditService).record(eq(INSTITUTE), eq(ACTOR), eq("VARIANT_PRICE_CHANGED"), eq("VARIANT"),
                eq(created.getVariants().get(0).getPackageSessionId()), anyString());
    }

    @Test
    void archivingHidesTheProductAndDeletesNoRow() {
        ProductResponse created = service.save(INSTITUTE, ACTOR, sariRequest("ACTIVE"));

        ProductResponse archived = service.changeStatus(INSTITUTE, ACTOR, created.getPackageId(), "ARCHIVED");

        assertEquals("ARCHIVED", archived.getStatus());
        assertEquals("DELETED", packages.get(0).getStatus());
        assertTrue(sessions.stream().allMatch(s -> "DELETED".equals(s.getStatus())));
        assertEquals(3, archived.getVariants().size());
        verify(packageRepository, never()).delete(any());
        verify(packageRepository, never()).deleteById(anyString());
        verify(packageSessionRepository, never()).delete(any());
        verify(packageSessionRepository, never()).deleteById(anyString());
        verify(variantRepository, never()).delete(any());
        verify(productRepository, never()).delete(any());
        verify(paymentPlanRepository, never()).delete(any());
        verify(enrollInviteRepository, never()).delete(any());
        verify(auditService).record(eq(INSTITUTE), eq(ACTOR), eq("PRODUCT_STATUS_CHANGED"), eq("PRODUCT"),
                eq(created.getPackageId()), anyString());
    }

    // ---------------------------------------------------------------- helpers

    private ProductRequest sariRequest(String status) {
        ProductRequest request = new ProductRequest();
        request.setExternalRef("woo-1");
        request.setSlug("cotton-sari");
        request.setStatus(status);
        request.setTranslations(List.of(ProductTranslationDTO.builder().locale("en").name("Cotton Sari").build()));
        request.setOptionAttributeIds(List.of(COLOUR));
        request.setVariants(new ArrayList<>(List.of(
                variant("SARI-RED", "Red", RED, "1200"),
                variant("SARI-BLUE", "Blue", BLUE, "1250.50"),
                variant("SARI-GREEN", "Green", GREEN, "1300"))));
        return request;
    }

    private static VariantRequest variant(String sku, String name, String valueId, String price) {
        VariantRequest variant = new VariantRequest();
        variant.setSku(sku);
        variant.setExternalRef("woo-" + sku);
        variant.setName(name);
        variant.setPrice(new BigDecimal(price));
        variant.setOptionValues(Map.of(COLOUR, valueId));
        return variant;
    }

    private static CommerceAttributeValue value(String id, String label) {
        CommerceAttributeValue value = new CommerceAttributeValue();
        value.setId(id);
        value.setInstituteId(INSTITUTE);
        value.setAttributeId(COLOUR);
        value.setLabelI18n(Map.of("en", label));
        return value;
    }

    /** A save that gives a new row an id and keeps it, as the database would. */
    private <T> org.mockito.stubbing.Answer<T> stored(List<T> store, Function<T, String> getId,
                                                      BiConsumer<T, String> setId) {
        return inv -> {
            T entity = inv.getArgument(0);
            if (getId.apply(entity) == null) {
                setId.accept(entity, "id-" + nextId++);
            }
            if (store.stream().noneMatch(kept -> kept == entity)) {
                store.add(entity);
            }
            return entity;
        };
    }
}
