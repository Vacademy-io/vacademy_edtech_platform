package vacademy.io.admin_core_service.features.session.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.enroll_invite.service.DefaultEnrollInviteService;
import vacademy.io.admin_core_service.features.faculty.service.FacultyService;
import vacademy.io.admin_core_service.features.group.service.GroupService;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithSessionDTO;
import vacademy.io.admin_core_service.features.level.service.LevelService;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.admin_core_service.features.subject.service.SubjectService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.Session;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The session writers refuse a shop product. Session delete (institute scope, shared rows) is
 * covered by SessionDeleteInstituteScopeTest.
 */
class SessionServiceCommerceGuardTest {

    private static final String INSTITUTE = "inst-1";

    private SessionRepository sessionRepository;
    private PackageSessionRepository packageSessionRepository;
    private PackageRepository packageRepository;
    private LearnerInvitationService learnerInvitationService;
    private DefaultEnrollInviteService defaultEnrollInviteService;
    private CustomUserDetails user;
    private SessionService service;

    private final CommerceProductRepository products = mock(CommerceProductRepository.class);
    private final CommerceVariantRepository variants = mock(CommerceVariantRepository.class);

    @BeforeEach
    void setUp() {
        sessionRepository = mock(SessionRepository.class);
        packageSessionRepository = mock(PackageSessionRepository.class);
        packageRepository = mock(PackageRepository.class);
        learnerInvitationService = mock(LearnerInvitationService.class);
        defaultEnrollInviteService = mock(DefaultEnrollInviteService.class);
        user = mock(CustomUserDetails.class);
        service = new SessionService(sessionRepository, packageSessionRepository, mock(LevelService.class),
                packageRepository, mock(SubjectService.class), learnerInvitationService, mock(GroupService.class),
                defaultEnrollInviteService, mock(FacultyService.class), mock(PackageSessionService.class),
                new CommerceLegacyGuard(products, variants));
        when(products.existsByPackageId("pkg-product")).thenReturn(true);
    }

    @Test
    void addNewSessionRefusesAProduct() {
        PackageEntity product = new PackageEntity();
        product.setId("pkg-product");
        product.setPackageType("PRODUCT");
        when(packageRepository.findById("pkg-product")).thenReturn(Optional.of(product));
        Session shared = new Session();
        shared.setId("DEFAULT");
        when(sessionRepository.findById("DEFAULT")).thenReturn(Optional.of(shared));

        AddLevelWithSessionDTO level = new AddLevelWithSessionDTO();
        level.setPackageId("pkg-product");
        level.setNewLevel(false);
        level.setId("DEFAULT");
        AddNewSessionDTO request = new AddNewSessionDTO();
        request.setId("DEFAULT");
        request.setLevels(List.of(level));

        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.addNewSession(request, INSTITUTE, user));
        assertEquals(400, refused.getStatus().value());
        verify(packageSessionRepository, never()).save(any());
        verifyNoInteractions(defaultEnrollInviteService);
    }
}
