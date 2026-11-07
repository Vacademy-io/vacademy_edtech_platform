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
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

/**
 * Intake rotation that passes over given counselors (a discarded lead's earlier owner):
 * the next eligible counselor after them gets the lead, and when they are the only one
 * eligible they still get it.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CounselorAssignmentServiceSkipCounselorTest {

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
    private static final String AUD = "aud-1";

    @BeforeEach
    void pool() {
        CounselorPool p = new CounselorPool();
        p.setId(POOL);
        p.setAssignmentMode("ROUND_ROBIN");
        when(poolRepository.findById(POOL)).thenReturn(Optional.of(p));
        when(poolRepository.findByIdForUpdate(POOL)).thenReturn(Optional.of(p));
        CounselorPoolAudience link = CounselorPoolAudience.builder().id("link-1")
                .poolId(POOL).audienceId(AUD).assignOnIntake(true).build();
        when(poolAudienceRepository.findByAudienceId(AUD)).thenReturn(Optional.of(link));
        when(poolAudienceRepository.findByAudienceIdForUpdate(AUD)).thenReturn(Optional.of(link));
    }

    private void members(String pointer, String... counselors) {
        List<CounselorPoolMember> rows = new ArrayList<>();
        for (int i = 0; i < counselors.length; i++) {
            rows.add(CounselorPoolMember.builder().poolId(POOL).audienceId(AUD)
                    .counselorUserId(counselors[i]).displayOrder(i + 1).build());
        }
        when(poolMemberRepository.findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(POOL, AUD)).thenReturn(rows);
        when(poolMemberRepository.findByPoolId(POOL)).thenReturn(rows);
        when(poolAudienceRepository.findFirstByPoolIdAndLastAssignedAtIsNotNullOrderByLastAssignedAtDesc(POOL))
                .thenReturn(Optional.of(CounselorPoolAudience.builder().poolId(POOL)
                        .lastAssignedCounselorId(pointer).build()));
    }

    @Test
    @DisplayName("the counselor whose turn it is gets skipped when they owned the discarded lead")
    void skipsThePreviousOwnerOnTheirTurn() {
        members("counselor-a", "counselor-a", "counselor-b", "counselor-c");

        assertEquals(Optional.of("counselor-c"),
                service.assignCounselorOnIntake(AUD, Set.of("counselor-b")));
        verify(poolAudienceRepository).updateLastAssigned(eq("link-1"), eq("counselor-c"), any());
    }

    @Test
    @DisplayName("not their turn: rotation is unchanged")
    void rotationUnchangedWhenSkippedIsNotNext() {
        members("counselor-a", "counselor-a", "counselor-b", "counselor-c");

        assertEquals(Optional.of("counselor-b"),
                service.assignCounselorOnIntake(AUD, Set.of("counselor-a")));
    }

    @Test
    @DisplayName("only the previous owner is in the pool: they still get the lead")
    void onlyThePreviousOwnerStillGetsIt() {
        members("counselor-a", "counselor-a");

        assertEquals(Optional.of("counselor-a"),
                service.assignCounselorOnIntake(AUD, Set.of("counselor-a")));
    }
}
