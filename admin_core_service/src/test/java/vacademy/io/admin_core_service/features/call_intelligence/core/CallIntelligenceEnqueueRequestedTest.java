package vacademy.io.admin_core_service.features.call_intelligence.core;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.repository.CallIntelligenceRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Analysis an API client asked for on one call runs even when the institute's CRM
 * Intelligence switch is off (the default), and never resets an analysis already queued.
 */
class CallIntelligenceEnqueueRequestedTest {

    private final CrmIntelligenceSettingsService settings = mock(CrmIntelligenceSettingsService.class);
    private final CallIntelligenceRepository repo = mock(CallIntelligenceRepository.class);
    private final TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
    private final CallIntelligenceEnqueueService service = new CallIntelligenceEnqueueService(settings, repo, logs);

    private void call(String recordingKey) {
        when(logs.findById("log-1")).thenReturn(Optional.of(TelephonyCallLog.builder().id("log-1").instituteId("inst-1")
                .providerType("EXOTEL").counsellorUserId("c-1").direction("OUTBOUND").durationSeconds(12)
                .recordingStorageKey(recordingKey).build()));
    }

    @Test
    void aRequestedAnalysisIgnoresTheInstituteSwitchAndTheMinimumLength() {
        call("file-1");
        assertEquals("QUEUED", service.enqueueRequested("log-1"));
        ArgumentCaptor<CallIntelligence> row = ArgumentCaptor.forClass(CallIntelligence.class);
        verify(repo).save(row.capture());
        assertEquals("PENDING", row.getValue().getStatus());
        assertEquals("TELEPHONY", row.getValue().getSource());
        assertEquals("c-1", row.getValue().getCounsellorUserId());
        verifyNoInteractions(settings);
    }

    @Test
    void anExistingAnalysisIsLeftAlone() {
        call("file-1");
        when(repo.existsByCallLogId("log-1")).thenReturn(true);
        assertEquals("EXISTS", service.enqueueRequested("log-1"));
        verify(repo, never()).save(any());
    }

    @Test
    void thereIsNothingToAnalyseWithoutARecording() {
        call(null);
        assertEquals("NO_RECORDING", service.enqueueRequested("log-1"));
        assertEquals("NOT_FOUND", service.enqueueRequested("missing"));
        verify(repo, never()).save(any());
    }
}
