package vacademy.io.notification_service.features.send.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.entity.SendBatch;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BulkEmailBatchTest {

    private static final String INSTITUTE = "inst-1";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SendBatchRepository batches = mock(SendBatchRepository.class);
    private final NotificationLogRepository logs = mock(NotificationLogRepository.class);
    private final SendChannelRouter router = mock(SendChannelRouter.class);
    private BatchProcessorService service;

    @BeforeEach
    void setUp() {
        service = new BatchProcessorService(batches, objectMapper, new BulkEmailLanes(600_000, 3), logs);
        service.setChannelRouter(router);
        when(batches.claimBatch(anyString(), any())).thenReturn(1);
        when(logs.countEmailOutcomesSince(anyString(), any())).thenReturn(Collections.emptyList());
        when(router.routeSync(any())).thenAnswer(call -> {
            UnifiedSendRequest chunk = call.getArgument(0);
            return UnifiedSendResponse.builder().results(chunk.getRecipients().stream()
                    .map(r -> UnifiedSendResponse.RecipientResult.builder()
                            .email(r.getEmail()).success(true).status("SENT").build())
                    .toList()).build();
        });
    }

    private SendBatch batch(int recipients, int alreadySent) throws Exception {
        List<UnifiedSendRequest.Recipient> list = IntStream.range(0, recipients)
                .mapToObj(i -> UnifiedSendRequest.Recipient.builder().email("u" + i + "@x.com").build())
                .toList();
        UnifiedSendRequest request = UnifiedSendRequest.builder()
                .instituteId(INSTITUTE).channel("EMAIL").recipients(list).build();
        return store(request, recipients, alreadySent, "STUDENT_MANAGEMENT_BULK_EMAIL");
    }

    private SendBatch store(UnifiedSendRequest request, int recipients, int alreadySent, String source) throws Exception {
        SendBatch batch = SendBatch.builder().id("b1").instituteId(INSTITUTE).channel("EMAIL").source(source)
                .totalRecipients(recipients).sentCount(alreadySent).failedCount(0).status("QUEUED")
                .requestPayload(objectMapper.writeValueAsString(request)).build();
        when(batches.findById("b1")).thenReturn(Optional.of(batch));
        return batch;
    }

    private List<String> sentEmails() {
        ArgumentCaptor<UnifiedSendRequest> sent = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(router, org.mockito.Mockito.atLeast(0)).routeSync(sent.capture());
        List<String> emails = new ArrayList<>();
        sent.getAllValues().forEach(r -> r.getRecipients().forEach(x -> emails.add(x.getEmail())));
        return emails;
    }

    @Test
    void sendsEveryRecipientOnceAndCompletes() throws Exception {
        batch(60, 0);
        service.processAsyncBatch("b1");
        verify(batches, timeout(5000)).finishBatch(eq("b1"), eq("COMPLETED"), eq(60), eq(0), any(), any(), any());
        assertThat(sentEmails()).hasSize(60).doesNotHaveDuplicates();
    }

    @Test
    void resumesFromSavedOffsetAfterRestart() throws Exception {
        batch(60, 25);
        service.processAsyncBatch("b1");
        verify(batches, timeout(5000)).finishBatch(eq("b1"), eq("COMPLETED"), eq(60), eq(0), any(), any(), any());
        assertThat(sentEmails()).hasSize(35).doesNotContain("u0@x.com", "u24@x.com").contains("u25@x.com", "u59@x.com");
    }

    @Test
    void doesNotSendWhenAnotherWorkerAlreadyClaimedTheBatch() throws Exception {
        batch(30, 0);
        when(batches.claimBatch(anyString(), any())).thenReturn(0);
        service.processAsyncBatch("b1");
        Thread.sleep(300);
        verify(router, never()).routeSync(any());
    }

    @Test
    void stopsALargeSendWhenRecentMailIsBouncing() throws Exception {
        batch(600, 0);
        List<Object[]> row = new ArrayList<>();
        row.add(new Object[] {5L, 200L, 0L, 0L});
        when(logs.countEmailOutcomesSince(anyString(), any())).thenReturn(row);
        service.processAsyncBatch("b1");
        verify(batches, timeout(5000)).finishBatch(eq("b1"), eq(BatchProcessorService.STATUS_STOPPED),
                eq(0), eq(0), any(), any(), any());
        verify(router, never()).routeSync(any());
    }

    @Test
    void neverStopsASmallBatch() throws Exception {
        batch(60, 0);
        List<Object[]> row = new ArrayList<>();
        row.add(new Object[] {5L, 200L, 0L, 0L});
        when(logs.countEmailOutcomesSince(anyString(), any())).thenReturn(row);
        service.processAsyncBatch("b1");
        verify(batches, timeout(5000)).finishBatch(eq("b1"), eq("COMPLETED"), eq(60), eq(0), any(), any(), any());
    }

    @Test
    void liveClassMailIsNotPacedOrQueued() {
        assertThat(BatchProcessorService.isPacedEmail("EMAIL", "ADMIN_CORE")).isFalse();
        assertThat(BatchProcessorService.isPacedEmail("EMAIL", "SLIDE")).isFalse();
        assertThat(BatchProcessorService.isPacedEmail("EMAIL", null)).isFalse();
        assertThat(BatchProcessorService.isPacedEmail("WHATSAPP", "WORKFLOW")).isFalse();
        assertThat(BatchProcessorService.isPacedEmail("EMAIL", "WORKFLOW")).isTrue();
    }

    @Test
    void unpacedEmailBatchKeepsOldChunksAndSkipsTheStopCheck() throws Exception {
        List<UnifiedSendRequest.Recipient> list = IntStream.range(0, 60)
                .mapToObj(i -> UnifiedSendRequest.Recipient.builder().email("u" + i + "@x.com").build()).toList();
        store(UnifiedSendRequest.builder().instituteId(INSTITUTE).channel("EMAIL").recipients(list).build(), 60, 0, "ADMIN_CORE");
        service.processAsyncBatch("b1");
        verify(batches, timeout(5000)).finishBatch(eq("b1"), eq("COMPLETED"), eq(60), eq(0), any(), any(), any());
        verify(router, org.mockito.Mockito.times(2)).routeSync(any());
        verify(logs, never()).countEmailOutcomesSince(anyString(), any());
    }

    @Test
    void recoverySkipsBatchesThisPodStillHolds() throws Exception {
        batch(30, 0);
        CountDownLatch release = new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(call -> {
            release.await(5, TimeUnit.SECONDS);
            return UnifiedSendResponse.builder().results(List.of()).build();
        }).when(router).routeSync(any());
        service.processAsyncBatch("b1");
        verify(router, timeout(5000)).routeSync(any());
        List<Object[]> stale = new ArrayList<>();
        stale.add(new Object[] {"b1", INSTITUTE, "WORKFLOW"});
        when(batches.findStaleEmailBatches(any(), any(), any())).thenReturn(stale);

        service.recoverInterruptedEmailBatches();

        verify(batches, never()).requeueStaleBatch(anyString(), any(), any());
        release.countDown();
    }

    @Test
    void recoveryRequeuesAnInterruptedBatch() throws Exception {
        batch(30, 25);
        List<Object[]> stale = new ArrayList<>();
        stale.add(new Object[] {"b1", INSTITUTE, "WORKFLOW"});
        when(batches.findStaleEmailBatches(any(), any(), any())).thenReturn(stale);
        when(batches.requeueStaleBatch(eq("b1"), any(), any())).thenReturn(1);

        service.recoverInterruptedEmailBatches();

        verify(batches, timeout(5000)).finishBatch(eq("b1"), eq("COMPLETED"), eq(30), eq(0), any(), any(), any());
        assertThat(sentEmails()).hasSize(5);
    }

    @Test
    void stopRulesNeedEnoughDataAndARealSpike() {
        assertThat(BatchProcessorService.stopReason(10, 50, 0, 0)).isNull();
        assertThat(BatchProcessorService.stopReason(950, 40, 10, 0)).isNull();
        assertThat(BatchProcessorService.stopReason(800, 150, 50, 0)).contains("bounces");
        assertThat(BatchProcessorService.stopReason(1000, 0, 0, 2)).isNull();
        assertThat(BatchProcessorService.stopReason(1000, 0, 0, 3)).contains("complaints");
    }

    @Test
    void lanesHoldTheInstituteToItsRate() {
        BulkEmailLanes lanes = new BulkEmailLanes(600, 3); // 10 per second
        long start = System.nanoTime();
        lanes.acquire(INSTITUTE, 5);
        lanes.acquire(INSTITUTE, 5);
        lanes.acquire(INSTITUTE, 1);
        assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)).isGreaterThanOrEqualTo(800);
    }

    @Test
    void dedupeDropsOnlyExactRepeatsSoSiblingsStillGetTheirOwnMail() {
        List<UnifiedSendRequest.Recipient> unique = UnifiedSendService.dedupeEmailRecipients(List.of(
                recipient("Parent@x.com", "Asha"),
                recipient("parent@X.com", "Ravi"),
                recipient(" parent@x.com ", "Asha"),
                recipient(null, "NoAddress"),
                recipient(null, "NoAddress")));
        assertThat(unique).extracting(r -> r.getVariables().get("name"))
                .containsExactly("Asha", "Ravi", "NoAddress", "NoAddress");
    }

    private static UnifiedSendRequest.Recipient recipient(String email, String name) {
        return UnifiedSendRequest.Recipient.builder().email(email).variables(java.util.Map.of("name", name)).build();
    }

    @Test
    void footerNeverChangesTheSender() {
        assertThat(UnifiedSendService.bulkEmailType("UTILITY_EMAIL", true, "info@a.in", "info@a.in")).isEqualTo("PROMOTIONAL_EMAIL");
        assertThat(UnifiedSendService.bulkEmailType(null, true, "info@a.in", "info@a.in")).isEqualTo("PROMOTIONAL_EMAIL");
        assertThat(UnifiedSendService.bulkEmailType("UTILITY_EMAIL", true, "promo@a.in", "info@a.in")).isEqualTo("UTILITY_EMAIL");
        assertThat(UnifiedSendService.bulkEmailType("UTILITY_EMAIL", false, "info@a.in", "info@a.in")).isEqualTo("UTILITY_EMAIL");
        assertThat(UnifiedSendService.bulkEmailType("TRANSACTIONAL_EMAIL", true, "info@a.in", "info@a.in")).isEqualTo("TRANSACTIONAL_EMAIL");
    }
}
