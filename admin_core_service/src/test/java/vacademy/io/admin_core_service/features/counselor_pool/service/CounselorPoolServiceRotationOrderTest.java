package vacademy.io.admin_core_service.features.counselor_pool.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.repository.UserLeadProfileRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.audience.service.UserLeadProfileService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolMember;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolAudienceRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftRepository;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

/**
 * With pool-wide rotation on, a newly attached list is seeded in the order most of the pool's
 * lists share, so it matches the others. With it off (default) seeding is unchanged.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CounselorPoolServiceRotationOrderTest {

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

    private final List<CounselorPoolMember> poolRows = new ArrayList<>();

    private void list(String audienceId, String... counselorsByOrder) {
        for (int i = 0; i < counselorsByOrder.length; i++) {
            poolRows.add(CounselorPoolMember.builder().poolId(POOL).audienceId(audienceId)
                    .counselorUserId(counselorsByOrder[i]).displayOrder(i + 1).build());
        }
    }

    @Test
    @DisplayName("setting ON: a newly attached list copies the order most lists share")
    void attachSeedsPoolOrder() {
        list("aud-1", "m", "d", "p");
        list("aud-2", "m", "d", "p");
        list("aud-3", "d", "p", "m"); // m re-added: bottom here

        assertEquals(List.of("m", "d", "p"), seedNewList(true));
    }

    @Test
    @DisplayName("setting OFF (default): seeding keeps the old first-appearance order")
    void attachOffKeepsOldSeeding() {
        list("aud-3", "d", "p", "m"); // rows come back with this list first
        list("aud-1", "m", "d", "p");
        list("aud-2", "m", "d", "p");

        assertEquals(List.of("d", "p", "m"), seedNewList(false));
    }

    @Test
    @DisplayName("gaps from removed counselors don't change the order a new list gets")
    void attachIgnoresGaps() {
        list("aud-1", "m", "d", "p");
        poolRows.get(1).setDisplayOrder(5); // d after a removal gap
        poolRows.get(2).setDisplayOrder(9); // p
        list("aud-2", "m", "d", "p");

        assertEquals(List.of("m", "d", "p"), seedNewList(true));
    }

    @Test
    @DisplayName("a counselor missing from the majority order is appended, not dropped")
    void attachKeepsEveryCounselor() {
        list("aud-1", "a", "b");
        list("aud-2", "a", "b");
        list("aud-3", "a", "c", "b");

        assertEquals(List.of("a", "b", "c"), seedNewList(true));
    }

    @Test
    @DisplayName("pool with no counselors seeds nothing")
    void attachEmptyPool() {
        assertEquals(List.of(), seedNewList(true));
    }

    private List<String> seedNewList(boolean unifiedRotation) {
        CounselorPool pool = CounselorPool.builder().id(POOL).unifiedRotationOrder(unifiedRotation).build();
        when(poolRepository.findById(POOL)).thenReturn(Optional.of(pool));
        when(poolRepository.existsById(POOL)).thenReturn(true);
        when(poolAudienceRepository.findByAudienceId("aud-new")).thenReturn(Optional.empty());
        when(poolMemberRepository.findByPoolId(POOL)).thenReturn(poolRows);

        service.addAudiencesToPool(POOL, List.of("aud-new"), "admin");

        ArgumentCaptor<CounselorPoolMember> saved = ArgumentCaptor.forClass(CounselorPoolMember.class);
        verify(poolMemberRepository, atLeast(0)).save(saved.capture());
        return saved.getAllValues().stream()
                .sorted(Comparator.comparing(CounselorPoolMember::getDisplayOrder))
                .map(CounselorPoolMember::getCounselorUserId)
                .toList();
    }
}
