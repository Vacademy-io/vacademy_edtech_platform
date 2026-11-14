package vacademy.io.admin_core_service.features.learner_tracking.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.learner_operation.service.LearnerOperationService;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.DocumentActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.AudioTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.DocumentTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.VideoTrackedRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Locks the slide binding of an activity log.
 *
 * Clients generate the activity id themselves and send new_activity=true on every
 * flush, so the save is an upsert. Before the guard under test, a flush carrying a
 * stale slideId re-parented the existing row to a different slide — and because
 * document_tracked rows hang off activity_id, that slide's page views moved with
 * it. Observed in production: a 2-page reading note holding 14 distinct tracked
 * pages (capped to 100%) next to a 14-page PDF left below 100% with no evidence
 * left to recompute from.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class LearnerTrackingSlideBindingTest {

    private static final String USER = "learner-1";
    private static final String ACTIVITY = "activity-1";
    private static final String ORIGINAL_SLIDE = "slide-pdf";
    private static final String OTHER_SLIDE = "slide-reading-note";

    @Mock private ActivityLogRepository activityLogRepository;
    @Mock private DocumentTrackedRepository documentTrackedRepository;
    @Mock private VideoTrackedRepository videoTrackedRepository;
    @Mock private AudioTrackedRepository audioTrackedRepository;
    @Mock private LearnerOperationService learnerOperationService;
    @Mock private LearnerTrackingAsyncService learnerTrackingAsyncService;
    @Mock private ConcentrationScoreService concentrationScoreService;

    @Spy private AnswerKeyAccess answerKeyAccess = new AnswerKeyAccess(false, false, false, false);

    @InjectMocks private LearnerTrackingService service;

    private ActivityLogDTO flush(String activityId) {
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId(activityId);
        dto.setNewActivity(true);
        dto.setStartTimeInMillis(1_753_000_000_000L);
        dto.setEndTimeInMillis(1_753_000_060_000L);
        DocumentActivityLogDTO page = new DocumentActivityLogDTO();
        page.setId("page-view-1");
        page.setPageNumber(7);
        dto.setDocuments(List.of(page));
        return dto;
    }

    private CustomUserDetails user() {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn(USER);
        return user;
    }

    @Test
    @DisplayName("a flush carrying a stale slideId does not move the activity to the new slide")
    void staleSlideIdDoesNotReParentActivity() {
        ActivityLog existing = new ActivityLog();
        existing.setId(ACTIVITY);
        existing.setUserId(USER);
        existing.setSlideId(ORIGINAL_SLIDE);

        when(activityLogRepository.findById(ACTIVITY)).thenReturn(Optional.of(existing));
        when(activityLogRepository.save(any(ActivityLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        // Same activity id, but the client now claims a different slide.
        service.addOrUpdateDocumentActivityLog(
                flush(ACTIVITY), OTHER_SLIDE, "chapter-1", "ps-1", "module-1", "subject-1", user());

        // The request saves more than once (bind, then the engaged-ms recompute);
        // the invariant is that no save ever moves the row off its slide.
        ArgumentCaptor<ActivityLog> saved = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activityLogRepository, atLeastOnce()).save(saved.capture());

        assertTrue(saved.getAllValues().stream()
                        .allMatch(a -> ORIGINAL_SLIDE.equals(a.getSlideId())),
                "activity must stay bound to the slide it was opened on, got: "
                        + saved.getAllValues().stream().map(ActivityLog::getSlideId).toList());
        assertTrue(saved.getAllValues().stream().allMatch(a -> ACTIVITY.equals(a.getId())));
    }

    @Test
    @DisplayName("a first flush for an unseen activity binds to the slide it was opened on")
    void newActivityBindsToRequestSlide() {
        when(activityLogRepository.findById(ACTIVITY)).thenReturn(Optional.empty());
        when(activityLogRepository.save(any(ActivityLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        service.addOrUpdateDocumentActivityLog(
                flush(ACTIVITY), ORIGINAL_SLIDE, "chapter-1", "ps-1", "module-1", "subject-1", user());

        ArgumentCaptor<ActivityLog> saved = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activityLogRepository, atLeastOnce()).save(saved.capture());

        assertEquals(ORIGINAL_SLIDE, saved.getAllValues().get(0).getSlideId());
    }

    @Test
    @DisplayName("repeat flushes on the same slide still extend the same activity row")
    void sameSlideFlushKeepsExtendingTheSameActivity() {
        ActivityLog existing = new ActivityLog();
        existing.setId(ACTIVITY);
        existing.setUserId(USER);
        existing.setSlideId(ORIGINAL_SLIDE);

        when(activityLogRepository.findById(ACTIVITY)).thenReturn(Optional.of(existing));
        when(activityLogRepository.save(any(ActivityLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        service.addOrUpdateDocumentActivityLog(
                flush(ACTIVITY), ORIGINAL_SLIDE, "chapter-1", "ps-1", "module-1", "subject-1", user());

        ArgumentCaptor<ActivityLog> saved = ArgumentCaptor.forClass(ActivityLog.class);
        verify(activityLogRepository, atLeastOnce()).save(saved.capture());

        assertEquals(ACTIVITY, saved.getAllValues().get(0).getId());
        assertEquals(ORIGINAL_SLIDE, saved.getAllValues().get(0).getSlideId());
    }
}
