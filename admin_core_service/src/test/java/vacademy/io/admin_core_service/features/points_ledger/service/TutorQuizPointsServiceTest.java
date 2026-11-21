package vacademy.io.admin_core_service.features.points_ledger.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsLedger;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;

import java.time.ZoneId;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TutorQuizPointsServiceTest {

    private PointsLedgerService ledger;
    private PointsLedgerRepository repo;
    private ScoringConfigService scoring;
    private TutorQuizPointsService service;

    @BeforeEach
    void setUp() {
        ledger = mock(PointsLedgerService.class);
        repo = mock(PointsLedgerRepository.class);
        scoring = mock(ScoringConfigService.class);
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getZone(anyString())).thenReturn(ZoneId.of("Asia/Kolkata"));
        when(scoring.isEnabled("inst")).thenReturn(true);
        service = new TutorQuizPointsService(ledger, repo, scoring, tz);
    }

    private void awardsToday(long n) {
        when(repo.countByInstituteIdAndUserIdAndSourceTypeAndAwardedAtGreaterThanEqual(
                eq("inst"), eq("u1"), eq("AI_TUTOR_QUIZ"), any())).thenReturn(n);
    }

    @Test
    void awardsFivePointsForAPassOncePerQuiz() {
        awardsToday(0);
        when(ledger.award(eq("u1"), eq("inst"), isNull(), eq(PointsSourceType.AI_TUTOR_QUIZ), eq("q1"), eq(5),
                anyString(), eq("AI_TUTOR_QUIZ:q1:u1"))).thenReturn(Optional.of(new PointsLedger()));
        Map<String, Object> out = service.award("u1", "inst", "q1", 80);
        assertEquals(true, out.get("awarded"));
        assertEquals(5, out.get("points"));
        assertEquals(1L, out.get("awards_left_today"));
    }

    @Test
    void duplicateQuizIsNotPaidTwice() {
        awardsToday(1);
        when(ledger.award(anyString(), anyString(), isNull(), any(), anyString(), anyInt(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        Map<String, Object> out = service.award("u1", "inst", "q1", 90);
        assertEquals(false, out.get("awarded"));
        assertEquals("already_awarded", out.get("reason"));
    }

    @Test
    void belowPassMarkEarnsNothing() {
        Map<String, Object> out = service.award("u1", "inst", "q1", 59.9);
        assertEquals("not_passed", out.get("reason"));
        verify(ledger, never()).award(anyString(), anyString(), any(), any(), anyString(), anyInt(), anyString(), anyString());
    }

    @Test
    void dailyCapStopsTheThirdAward() {
        awardsToday(2);
        Map<String, Object> out = service.award("u1", "inst", "q3", 100);
        assertEquals("daily_cap", out.get("reason"));
        verify(ledger, never()).award(anyString(), anyString(), any(), any(), anyString(), anyInt(), anyString(), anyString());
    }

    @Test
    void gamificationOffInstitutesAccrueNothing() {
        when(scoring.isEnabled("inst")).thenReturn(false);
        Map<String, Object> out = service.award("u1", "inst", "q1", 100);
        assertEquals("gamification_off", out.get("reason"));
        verify(ledger, never()).award(anyString(), anyString(), any(), any(), anyString(), anyInt(), anyString(), anyString());
    }
}
