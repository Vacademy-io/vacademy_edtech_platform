package vacademy.io.admin_core_service.features.commerce.common;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.PackageSessionToPaymentOptionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.UpdateEnrollInvitePackageSessionPaymentOptionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.enroll_invite.service.EnrollInviteService;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.group.service.GroupService;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.level.service.LevelService;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.BatchService;
import vacademy.io.admin_core_service.features.packages.service.PackageService;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.dto.EditSessionDTO;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.admin_core_service.features.session.service.SessionService;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.Session;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The rows behind a variant (payment option and plan = its price, invite and link, package
 * session = its status) are written by the Commerce catalogue only. The old endpoints that take
 * such ids from the request refuse them before any write, and the level and session rows that
 * every institute shares cannot be renamed or retired through an edit.
 */
class LegacyWritersRefuseShopRowsTest {

    private CommerceVariantRepository variants;
    private CommerceProductRepository products;
    private CommerceLegacyGuard guard;

    @BeforeEach
    void setUp() {
        variants = mock(CommerceVariantRepository.class);
        products = mock(CommerceProductRepository.class);
        guard = new CommerceLegacyGuard(products, variants);
        when(variants.existsByPackageSessionId("ps-variant")).thenReturn(true);
        when(variants.findVariantSessionIdsIn(anyCollection())).thenAnswer(inv ->
                ((java.util.Collection<String>) inv.getArgument(0)).contains("ps-variant") ? List.of("ps-variant") : List.of());
        when(variants.findCommerceInviteIdsIn(anyCollection())).thenAnswer(inv ->
                ((java.util.Collection<String>) inv.getArgument(0)).contains("inv-shop") ? List.of("inv-shop") : List.of());
        when(variants.findVariantLinkIdsIn(anyCollection())).thenAnswer(inv ->
                ((java.util.Collection<String>) inv.getArgument(0)).contains("link-shop") ? List.of("link-shop") : List.of());
        when(products.existsByPackageId("pkg-shop")).thenReturn(true);
    }

    private static void assertRefused(org.junit.jupiter.api.function.Executable call) {
        VacademyException refused = assertThrows(VacademyException.class, call);
        assertEquals(400, refused.getStatus().value());
    }

    // ── price ────────────────────────────────────────────────────────────────

    private static PaymentOption variantOption() {
        PaymentOption option = new PaymentOption();
        option.setId("po-shop");
        option.setSource("PACKAGE_SESSION");
        option.setSourceId("ps-variant");
        option.setStatus("ACTIVE");
        return option;
    }

    @Test
    void paymentOptionEndpointsCannotChangeOrRemoveAVariantPrice() {
        PaymentOptionRepository options = mock(PaymentOptionRepository.class);
        PaymentOption option = variantOption();
        when(options.findById("po-shop")).thenReturn(Optional.of(option));
        when(options.existsById("po-shop")).thenReturn(true);
        when(options.findAllById(List.of("po-shop"))).thenReturn(List.of(option));
        PaymentOptionService service = new PaymentOptionService();
        ReflectionTestUtils.setField(service, "paymentOptionRepository", options);
        ReflectionTestUtils.setField(service, "commerceLegacyGuard", guard);

        PaymentOptionDTO edit = PaymentOptionDTO.builder().id("po-shop").name("cheap").build();
        assertRefused(() -> service.editPaymentOption(edit));
        // POST with an existing id is routed to the same edit.
        assertRefused(() -> service.savePaymentOption(edit, null));
        assertRefused(() -> service.deletePaymentOption(List.of("po-shop"), null));
        assertRefused(() -> service.makeDefaultPaymentOption("po-shop", "INSTITUTE", "inst-1"));
        // A second option on a variant would be a second price.
        assertRefused(() -> service.savePaymentOption(
                PaymentOptionDTO.builder().source("PACKAGE_SESSION").sourceId("ps-variant").build(), null));

        assertEquals("ACTIVE", option.getStatus());
        verify(options, never()).save(any(PaymentOption.class));
        verify(options, never()).saveAll(anyList());
    }

    // ── invite and link ──────────────────────────────────────────────────────

    private EnrollInviteService inviteService(EnrollInviteRepository invites) {
        EnrollInviteService service = new EnrollInviteService();
        ReflectionTestUtils.setField(service, "repository", invites);
        ReflectionTestUtils.setField(service, "commerceLegacyGuard", guard);
        return service;
    }

    private static EnrollInviteDTO inviteDto(String id, PackageSessionToPaymentOptionDTO mapping) {
        EnrollInviteDTO dto = new EnrollInviteDTO();
        dto.setId(id);
        dto.setInstituteId("inst-other");
        dto.setPackageSessionToPaymentOptions(List.of(mapping));
        return dto;
    }

    @Test
    void anInviteCannotBePointedAtAVariant() {
        // An invite cannot be pointed at a variant's session.
        EnrollInviteRepository invites = mock(EnrollInviteRepository.class);
        EnrollInviteService service = inviteService(invites);
        PackageSessionToPaymentOptionDTO toVariant = PackageSessionToPaymentOptionDTO.builder()
                .packageSessionId("ps-variant")
                .paymentOption(PaymentOptionDTO.builder().id("po-of-b").build()).build();

        assertRefused(() -> service.createEnrollInvite(inviteDto(null, toVariant)));

        EnrollInvite course = new EnrollInvite();
        course.setId("inv-course");
        when(invites.findById("inv-course")).thenReturn(Optional.of(course));
        assertRefused(() -> service.updateEnrollInvite(inviteDto("inv-course", toVariant)));

        UpdateEnrollInvitePackageSessionPaymentOptionDTO.UpdatePaymentOptionDTO swap =
                new UpdateEnrollInvitePackageSessionPaymentOptionDTO.UpdatePaymentOptionDTO();
        swap.setNewPackageSessionPaymentOption(toVariant);
        UpdateEnrollInvitePackageSessionPaymentOptionDTO request = new UpdateEnrollInvitePackageSessionPaymentOptionDTO();
        request.setEnrollInviteId("inv-course");
        request.setUpdatePaymentOptions(List.of(swap));
        assertRefused(() -> service.updatePaymentOptionsForInvites(List.of(request)));

        verify(invites, never()).save(any(EnrollInvite.class));
    }

    @Test
    void aVariantInviteCannotBeEditedOrDeletedFromTheInviteScreens() {
        EnrollInviteRepository invites = mock(EnrollInviteRepository.class);
        EnrollInviteService service = inviteService(invites);
        EnrollInvite shop = new EnrollInvite();
        shop.setId("inv-shop");
        shop.setStatus("ACTIVE");
        when(invites.findById("inv-shop")).thenReturn(Optional.of(shop));
        when(invites.findAllById(List.of("inv-shop"))).thenReturn(List.of(shop));
        PackageSessionToPaymentOptionDTO anyMapping = PackageSessionToPaymentOptionDTO.builder()
                .packageSessionId("ps-course").build();

        assertRefused(() -> service.deleteEnrollInvites(List.of("inv-shop")));
        assertRefused(() -> service.updateEnrollInvite(inviteDto("inv-shop", anyMapping)));
        assertRefused(() -> service.updateDefaultEnrollInviteConfig("inv-shop", "ps-course"));

        // Deleting a variant's link row through another invite's payment-option update.
        UpdateEnrollInvitePackageSessionPaymentOptionDTO.UpdatePaymentOptionDTO swap =
                new UpdateEnrollInvitePackageSessionPaymentOptionDTO.UpdatePaymentOptionDTO();
        swap.setOldPackageSessionPaymentOptionId("link-shop");
        UpdateEnrollInvitePackageSessionPaymentOptionDTO request = new UpdateEnrollInvitePackageSessionPaymentOptionDTO();
        request.setEnrollInviteId("inv-course");
        request.setUpdatePaymentOptions(List.of(swap));
        assertRefused(() -> service.updatePaymentOptionsForInvites(List.of(request)));

        assertEquals("ACTIVE", shop.getStatus());
        verify(invites, never()).saveAll(anyList());
        verify(invites, never()).save(any(EnrollInvite.class));
    }

    // ── batch status ─────────────────────────────────────────────────────────

    @Test
    void batchDeleteAndHideShowCannotMoveAVariantStatus() {
        PackageSessionRepository packageSessions = mock(PackageSessionRepository.class);
        BatchService batchService = new BatchService();
        ReflectionTestUtils.setField(batchService, "packageSessionRepository", packageSessions);
        ReflectionTestUtils.setField(batchService, "commerceLegacyGuard", guard);
        assertRefused(() -> batchService.deletePackageSession(new String[]{"ps-1", "ps-variant"}, null));

        SessionRepository sessions = mock(SessionRepository.class);
        SessionService sessionService = sessionService(sessions, packageSessions);
        EditSessionDTO hide = new EditSessionDTO();
        hide.setCommaSeparatedHiddenPackageSessionIds("ps-1,ps-variant");
        assertRefused(() -> sessionService.editSession(hide, "session-1", null));
        EditSessionDTO show = new EditSessionDTO();
        show.setCommaSeparatedVisiblePackageSessionIds("ps-variant");
        assertRefused(() -> sessionService.editSession(show, "session-1", null));

        verify(packageSessions, never()).updateStatusByPackageSessionIds(anyString(), any(String[].class));
        verify(sessions, never()).save(any(Session.class));
    }

    private SessionService sessionService(SessionRepository sessions, PackageSessionRepository packageSessions) {
        return new SessionService(sessions, packageSessions, mock(LevelService.class), mock(PackageRepository.class),
                mock(SubjectService.class), mock(LearnerInvitationService.class), mock(GroupService.class),
                mock(DefaultEnrollInviteService.class), mock(FacultyService.class), mock(PackageSessionService.class),
                guard);
    }

    // ── course editor ────────────────────────────────────────────────────────

    @Test
    void theCourseEditorRefusesAProductBeforeAnyWrite() {
        PackageRepository packages = mock(PackageRepository.class);
        PackageEntity product = new PackageEntity();
        product.setId("pkg-shop");
        product.setPackageType("PRODUCT");
        product.setPackageName("Khadi kurta");
        when(packages.findById("pkg-shop")).thenReturn(Optional.of(product));
        PackageService service = new PackageService();
        ReflectionTestUtils.setField(service, "packageRepository", packages);
        ReflectionTestUtils.setField(service, "commerceLegacyGuard", guard);
        AddCourseDTO edit = new AddCourseDTO();
        edit.setId("pkg-shop");
        edit.setNewCourse(false);
        edit.setCourseName("renamed in the course editor");

        assertRefused(() -> service.addOrUpdatePackage(edit, "inst-1", null));

        assertEquals("Khadi kurta", product.getPackageName());
        verify(packages, never()).save(any(PackageEntity.class));
    }
}
