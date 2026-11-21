package vacademy.io.admin_core_service.features.student_analysis.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The v2 report narrative's affordability: today's rule, plus the LIVE plan for a known empty wallet. */
class StudentAnalysisPlanCoverTest {

    private final CreditClient credits = mock(CreditClient.class);

    private boolean affordable(String actor) {
        return StudentAnalysisProcessorService.aiAffordable(credits, "inst-1", "learner-9", actor);
    }

    @Test
    void aPositiveOrUnreadableBalanceRunsAsTodayWithoutAskingThePlan() {
        when(credits.readBalance("inst-1")).thenReturn(Optional.of(12.0));
        assertTrue(affordable("admin-1"));
        when(credits.readBalance("inst-1")).thenReturn(Optional.empty());
        assertTrue(affordable("admin-1"), "unreadable balance does not block (today)");
        verify(credits, never()).planCovers(any(), any(), any(), anyInt(), any(), any());
    }

    @Test
    void anEmptyWalletSkipsTheNarrativeUnlessThePlanCoversIt() {
        when(credits.readBalance("inst-1")).thenReturn(Optional.of(0.0));
        assertFalse(affordable("admin-1"), "no LIVE plan (mock default false) = today");

        when(credits.planCovers(eq("inst-1"), eq("analytics"), isNull(), anyInt(), eq("admin-1"),
                argThat((MeteringFields m) -> "student_report".equals(m.useCase())
                        && "learner-9".equals(m.subjectUserId()) && "USER".equals(m.actorKind()))))
                .thenReturn(true);
        assertTrue(affordable("admin-1"));

        when(credits.readBalance("inst-1")).thenReturn(Optional.of(-40.0));
        when(credits.planCovers(eq("inst-1"), eq("analytics"), isNull(), anyInt(), isNull(),
                argThat((MeteringFields m) -> "SYSTEM".equals(m.actorKind()))))
                .thenReturn(true);
        assertTrue(affordable(null), "a scheduled report is a SYSTEM actor");
    }
}
