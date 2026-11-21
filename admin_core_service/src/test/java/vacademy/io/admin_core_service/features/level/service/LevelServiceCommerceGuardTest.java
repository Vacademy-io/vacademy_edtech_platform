package vacademy.io.admin_core_service.features.level.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.group.service.GroupService;
import vacademy.io.admin_core_service.features.learner_invitation.services.LearnerInvitationService;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithCourseDTO;
import vacademy.io.admin_core_service.features.level.dto.AddLevelWithSessionDTO;
import vacademy.io.admin_core_service.features.level.repository.LevelRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.session.repository.SessionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.session.Session;

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
 * The level writers refuse a shop product. Level delete (institute scope, shared rows) is
 * covered by LevelDeleteInstituteScopeTest.
 */
class LevelServiceCommerceGuardTest {

    private static final String INSTITUTE = "inst-1";

    private LevelRepository levelRepository;
    private PackageRepository packageRepository;
    private PackageSessionService packageSessionService;
    private SessionRepository sessionRepository;
    private PackageSessionRepository packageSessionRepository;
    private LearnerInvitationService learnerInvitationService;
    private CustomUserDetails user;
    private LevelService service;

    private final CommerceProductRepository products = mock(CommerceProductRepository.class);

    @BeforeEach
    void setUp() {
        levelRepository = mock(LevelRepository.class);
        packageRepository = mock(PackageRepository.class);
        packageSessionService = mock(PackageSessionService.class);
        sessionRepository = mock(SessionRepository.class);
        packageSessionRepository = mock(PackageSessionRepository.class);
        learnerInvitationService = mock(LearnerInvitationService.class);
        user = mock(CustomUserDetails.class);
        service = new LevelService(levelRepository, packageRepository, packageSessionService, sessionRepository,
                packageSessionRepository, learnerInvitationService, mock(GroupService.class),
                new CommerceLegacyGuard(products, mock(CommerceVariantRepository.class)));
        when(products.existsByPackageId("pkg-product")).thenReturn(true);
    }

    private static PackageEntity product() {
        PackageEntity product = new PackageEntity();
        product.setId("pkg-product");
        product.setPackageType("PRODUCT");
        return product;
    }

    @Test
    void addLevelRefusesAProduct() {
        when(packageRepository.findById("pkg-product")).thenReturn(Optional.of(product()));
        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.addLevel(new AddLevelWithCourseDTO(), "pkg-product", "DEFAULT", INSTITUTE, user));
        assertEquals(400, refused.getStatus().value());
        verifyNoInteractions(levelRepository, packageSessionService, sessionRepository);
    }

    @Test
    void courseEditorLevelStepRefusesAProduct() {
        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.addOrUpdateLevel(new AddLevelWithSessionDTO(), new Session(), product(), INSTITUTE, user));
        assertEquals(400, refused.getStatus().value());
        verifyNoInteractions(levelRepository, packageSessionService, packageSessionRepository);
        verify(levelRepository, never()).save(any());
    }
}
