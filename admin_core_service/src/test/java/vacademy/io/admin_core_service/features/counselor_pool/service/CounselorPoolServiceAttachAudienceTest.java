package vacademy.io.admin_core_service.features.counselor_pool.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolAudienceRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftRepository;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Attaching audiences to a pool: a link to a pool that was deleted must not block
 * the attach, and an audience already in this pool is a no-op rather than an error.
 */
@ExtendWith(MockitoExtension.class)
class CounselorPoolServiceAttachAudienceTest {

    @Mock CounselorPoolRepository poolRepository;
    @Mock CounselorPoolAudienceRepository poolAudienceRepository;
    @Mock CounselorPoolMemberRepository poolMemberRepository;
    @Mock CounselorPoolShiftRepository poolShiftRepository;
    @Mock CounselorPoolShiftMemberRepository poolShiftMemberRepository;
    @Mock UserLeadProfileRepository userLeadProfileRepository;
    @Mock UserLeadProfileService userLeadProfileService;
    @Mock TimelineEventService timelineEventService;
    @Mock AuthService authService;
    @Mock LeadAssignmentNotifier leadAssignmentNotifier;

    @InjectMocks CounselorPoolService service;

    private static final String POOL = "pool-1";
    private static final String OTHER_POOL = "pool-2";
    private static final String AUD = "aud-1";

    private CounselorPoolAudience linkTo(String poolId) {
        return CounselorPoolAudience.builder().id("link-1").poolId(poolId).audienceId(AUD).build();
    }

    @Test
    @DisplayName("link to a deleted pool is dropped and the audience attaches")
    void staleLinkIsReplaced() {
        CounselorPoolAudience stale = linkTo(OTHER_POOL);
        when(poolRepository.existsById(POOL)).thenReturn(true);
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(stale));
        when(poolRepository.existsById(OTHER_POOL)).thenReturn(false);
        when(poolMemberRepository.findByPoolId(POOL)).thenReturn(List.of());

        service.addAudiencesToPool(POOL, List.of(AUD), "admin");

        InOrder order = inOrder(poolAudienceRepository);
        order.verify(poolAudienceRepository).delete(stale);
        order.verify(poolAudienceRepository).flush();
        order.verify(poolAudienceRepository).save(argThat(l -> POOL.equals(l.getPoolId()) && AUD.equals(l.getAudienceId())));
    }

    @Test
    @DisplayName("audience owned by another live pool is still rejected")
    void liveOtherPoolBlocks() {
        when(poolRepository.existsById(POOL)).thenReturn(true);
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(linkTo(OTHER_POOL)));
        when(poolRepository.existsById(OTHER_POOL)).thenReturn(true);

        assertThrows(VacademyException.class, () -> service.addAudiencesToPool(POOL, List.of(AUD), "admin"));
        verify(poolAudienceRepository, never()).delete(any());
        verify(poolAudienceRepository, never()).save(any());
    }

    @Test
    @DisplayName("audience already in this pool is skipped, not an error")
    void samePoolIsNoOp() {
        when(poolRepository.existsById(POOL)).thenReturn(true);
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(linkTo(POOL)));

        service.addAudiencesToPool(POOL, List.of(AUD), "admin");

        verify(poolAudienceRepository, never()).save(any());
        verifyNoInteractions(poolMemberRepository);
    }
}
