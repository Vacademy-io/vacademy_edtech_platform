package vacademy.io.admin_core_service.features.counselor_pool.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadAssignmentNotifier;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPool;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolMember;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolAudienceRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftMemberRepository;
import vacademy.io.admin_core_service.features.counselor_pool.repository.CounselorPoolShiftRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

/**
 * Round robin rotates across the whole pool, not per list. A pool of many lists that
 * each get one lead must still spread those leads over its counselors instead of
 * giving every list's first lead to the top-of-order member.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CounselorAssignmentServicePoolRotationTest {

    @Mock CounselorPoolRepository poolRepository;
    @Mock CounselorPoolAudienceRepository poolAudienceRepository;
    @Mock CounselorPoolMemberRepository poolMemberRepository;
    @Mock CounselorPoolShiftRepository shiftRepository;
    @Mock CounselorPoolShiftMemberRepository shiftMemberRepository;
    @Mock AudienceRepository audienceRepository;
    @Mock NotificationService notificationService;
    @Mock LeadAssignmentNotifier leadAssignmentNotifier;

    @InjectMocks CounselorAssignmentService service;

    private static final String POOL = "pool-1";

    private final List<CounselorPoolMember> poolRows = new ArrayList<>();
    private CounselorPool p;

    @BeforeEach
    void pool() {
        p = new CounselorPool();
        p.setId(POOL);
        p.setAssignmentMode("ROUND_ROBIN");
        when(poolMemberRepository.findByPoolId(POOL)).thenReturn(poolRows);
        when(poolRepository.findById(POOL)).thenReturn(Optional.of(p));
        when(poolRepository.findByIdForUpdate(POOL)).thenReturn(Optional.of(p));
    }

    private void list(String audienceId, String listPointer, String... counselors) {
        CounselorPoolAudience link = CounselorPoolAudience.builder().id("link-" + audienceId)
                .poolId(POOL).audienceId(audienceId).assignOnIntake(true)
                .lastAssignedCounselorId(listPointer).build();
        when(poolAudienceRepository.findByAudienceId(audienceId)).thenReturn(Optional.of(link));
        when(poolAudienceRepository.findByAudienceIdForUpdate(audienceId)).thenReturn(Optional.of(link));
        List<CounselorPoolMember> members = new ArrayList<>();
        for (int i = 0; i < counselors.length; i++) {
            members.add(CounselorPoolMember.builder().poolId(POOL).audienceId(audienceId)
                    .counselorUserId(counselors[i]).displayOrder(i + 1).build());
        }
        when(poolMemberRepository.findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(POOL, audienceId))
                .thenReturn(members);
        poolRows.addAll(members);
    }

    /** Another list of the pool that only contributes its order (no lead arrives on it). */
    private void otherList(String audienceId, String... counselors) {
        for (int i = 0; i < counselors.length; i++) {
            poolRows.add(CounselorPoolMember.builder().poolId(POOL).audienceId(audienceId)
                    .counselorUserId(counselors[i]).displayOrder(i + 1).build());
        }
    }

    /** Two lists in order a, b, c and one where b was re-added (bottom). Lead arrives on the drifted one. */
    private void driftedPool() {
        otherList("aud-1", "counselor-a", "counselor-b", "counselor-c");
        otherList("aud-2", "counselor-a", "counselor-b", "counselor-c");
        list("aud-3", null, "counselor-a", "counselor-c", "counselor-b");
        poolPointer("counselor-a");
    }

    private void poolPointer(String counselor) {
        Optional<CounselorPoolAudience> latest = counselor == null ? Optional.empty()
                : Optional.of(CounselorPoolAudience.builder().poolId(POOL).lastAssignedCounselorId(counselor).build());
        when(poolAudienceRepository.findFirstByPoolIdAndLastAssignedAtIsNotNullOrderByLastAssignedAtDesc(POOL))
                .thenReturn(latest);
    }

    @Test
    @DisplayName("first lead on a fresh list continues the pool rotation, not the list's top member")
    void freshListContinuesPoolRotation() {
        list("aud-2", null, "counselor-a", "counselor-b", "counselor-c");
        poolPointer("counselor-a"); // aud-1 just gave its lead to counselor-a

        assertEquals(Optional.of("counselor-b"), service.assignCounselorOnIntake("aud-2"));
        verify(poolAudienceRepository).updateLastAssigned(eq("link-aud-2"), eq("counselor-b"), any());
    }

    @Test
    @DisplayName("pool-wide pointer wraps to the first member after the last one")
    void poolPointerWraps() {
        list("aud-3", "counselor-a", "counselor-a", "counselor-b", "counselor-c");
        poolPointer("counselor-c");

        assertEquals(Optional.of("counselor-a"), service.assignCounselorOnIntake("aud-3"));
    }

    @Test
    @DisplayName("no assignment anywhere in the pool yet: first member gets it")
    void emptyPoolStartsAtTop() {
        list("aud-1", null, "counselor-a", "counselor-b");
        poolPointer(null);

        assertEquals(Optional.of("counselor-a"), service.assignCounselorOnIntake("aud-1"));
    }

    @Test
    @DisplayName("pool-wide pointer not on this list: falls back to the list's own pointer")
    void foreignPoolPointerFallsBackToListPointer() {
        list("aud-4", "counselor-x", "counselor-x", "counselor-y", "counselor-z");
        poolPointer("someone-on-another-list");

        assertEquals(Optional.of("counselor-y"), service.assignCounselorOnIntake("aud-4"));
    }

    @Test
    @DisplayName("setting OFF (default): a drifted list keeps following its own order, as before")
    void unifiedOffKeepsListOrder() {
        driftedPool();

        assertEquals(Optional.of("counselor-c"), service.assignCounselorOnIntake("aud-3"));
        verify(poolMemberRepository, never()).findByPoolId(POOL);
    }

    @Test
    @DisplayName("setting ON: a drifted list follows the pool's order")
    void unifiedOnFollowsPoolOrder() {
        p.setUnifiedRotationOrder(true);
        driftedPool();

        assertEquals(Optional.of("counselor-b"), service.assignCounselorOnIntake("aud-3"));
        verify(poolAudienceRepository).updateLastAssigned(eq("link-aud-3"), eq("counselor-b"), any());
    }

    @Test
    @DisplayName("setting ON: after the pool's last member the turn wraps to the pool's first, even if this list has them last")
    void unifiedOnWrapsToPoolTop() {
        p.setUnifiedRotationOrder(true);
        otherList("aud-1", "counselor-m", "counselor-d", "counselor-p");
        otherList("aud-2", "counselor-m", "counselor-d", "counselor-p");
        list("aud-3", null, "counselor-d", "counselor-p", "counselor-m");
        poolPointer("counselor-p");

        assertEquals(Optional.of("counselor-m"), service.assignCounselorOnIntake("aud-3"));
    }

    @Test
    @DisplayName("setting ON: an inactive last-assigned counselor keeps their place")
    void unifiedOnInactivePointerResumes() {
        p.setUnifiedRotationOrder(true);
        list("aud-1", null, "counselor-a", "counselor-b", "counselor-c");
        poolRows.get(1).setStatus("INACTIVE"); // counselor-b
        poolPointer("counselor-b");

        assertEquals(Optional.of("counselor-c"), service.assignCounselorOnIntake("aud-1"));
    }

    @Test
    @DisplayName("setting ON: an inactive counselor is skipped when their turn comes")
    void unifiedOnSkipsInactive() {
        p.setUnifiedRotationOrder(true);
        list("aud-1", null, "counselor-a", "counselor-b", "counselor-c");
        poolRows.get(1).setStatus("INACTIVE"); // counselor-b
        poolPointer("counselor-a");

        assertEquals(Optional.of("counselor-c"), service.assignCounselorOnIntake("aud-1"));
    }

    @Test
    @DisplayName("setting ON: last-assigned counselor removed from the pool falls back to the list's own rotation")
    void unifiedOnRemovedPointerFallsBack() {
        p.setUnifiedRotationOrder(true);
        list("aud-4", "counselor-x", "counselor-x", "counselor-y", "counselor-z");
        poolPointer("removed-counselor");

        assertEquals(Optional.of("counselor-y"), service.assignCounselorOnIntake("aud-4"));
    }

    @Test
    @DisplayName("setting ON: no assignment in the pool yet starts at the list's first member")
    void unifiedOnEmptyPoolStartsAtTop() {
        p.setUnifiedRotationOrder(true);
        list("aud-1", null, "counselor-a", "counselor-b");
        poolPointer(null);

        assertEquals(Optional.of("counselor-a"), service.assignCounselorOnIntake("aud-1"));
    }
}
