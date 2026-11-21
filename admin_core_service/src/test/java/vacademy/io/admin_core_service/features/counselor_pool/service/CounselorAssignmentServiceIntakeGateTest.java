package vacademy.io.admin_core_service.features.counselor_pool.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolAudienceRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.*;

/**
 * assign_on_intake=false must stop the INTAKE path only — the on-demand path (what the
 * AI-call outcome processor calls) still runs the rotation for the same list.
 */
@ExtendWith(MockitoExtension.class)
class CounselorAssignmentServiceIntakeGateTest {

    @Mock CounselorPoolRepository poolRepository;
    @Mock CounselorPoolAudienceRepository poolAudienceRepository;
    @Mock CounselorPoolMemberRepository poolMemberRepository;
    @Mock CounselorPoolShiftRepository shiftRepository;
    @Mock CounselorPoolShiftMemberRepository shiftMemberRepository;
    @Mock AudienceRepository audienceRepository;
    @Mock NotificationService notificationService;
    @Mock LeadAssignmentNotifier leadAssignmentNotifier;

    @InjectMocks CounselorAssignmentService service;

    private static final String AUD = "aud-1";
    private static final String POOL = "pool-1";

    private CounselorPoolAudience link(boolean assignOnIntake) {
        return CounselorPoolAudience.builder().id("l1").poolId(POOL).audienceId(AUD)
                .assignOnIntake(assignOnIntake).build();
    }

    private CounselorPool roundRobinPool() {
        CounselorPool p = new CounselorPool();
        p.setId(POOL);
        p.setAssignmentMode("ROUND_ROBIN");
        return p;
    }

    @Test
    @DisplayName("on-demand list: intake assigns nobody and never resolves the pool")
    void intakeSkipsOnDemandList() {
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(link(false)));

        Optional<String> picked = service.assignCounselorOnIntake(AUD);

        assertTrue(picked.isEmpty());
        verifyNoInteractions(poolRepository, poolMemberRepository);
    }

    @Test
    @DisplayName("on-demand list: the on-demand path still resolves the pool for the AI outcome")
    void onDemandStillAssignsForOnDemandList() {
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(link(false)));
        when(poolRepository.findById(POOL)).thenReturn(Optional.of(roundRobinPool()));
        // No members → the rotation legitimately finds nobody, but it must have LOOKED.
        when(poolMemberRepository.findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(POOL, AUD))
                .thenReturn(List.of());

        Optional<String> picked = service.assignCounselorForLead(AUD);

        assertTrue(picked.isEmpty());
        verify(poolRepository).findById(POOL);
        verify(poolMemberRepository).findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(POOL, AUD);
    }

    @Test
    @DisplayName("default list (assign_on_intake=true): intake resolves the pool as before")
    void intakeAssignsForDefaultList() {
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(link(true)));
        when(poolRepository.findById(POOL)).thenReturn(Optional.of(roundRobinPool()));
        when(poolMemberRepository.findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(POOL, AUD))
                .thenReturn(List.of());

        service.assignCounselorOnIntake(AUD);

        verify(poolRepository).findById(POOL);
    }
}
