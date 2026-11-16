package vacademy.io.admin_core_service.features.commerce.media;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionService.Outcome;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CommerceRenditionServiceTest {

    private static final String ROW = "row-1";
    private static final String FILE = "file-1";
    private static final String INSTITUTE = "inst-1";
    private static final long NOW = 1_800_000_000L;

    private final ObjectMapper json = new ObjectMapper();
    private CommerceProductMediaRepository repository;
    private CommerceRenditionClient client;
    private CommerceAuditService audit;
    private CommerceRenditionService service;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceProductMediaRepository.class);
        client = mock(CommerceRenditionClient.class);
        audit = mock(CommerceAuditService.class);
        service = new CommerceRenditionService(repository, client, audit);
        service.setClock(() -> NOW);
        when(repository.swapRenditions(anyString(), anyString(), any(), anyString())).thenReturn(1);
        when(repository.swapRenditionsAndSize(anyString(), anyString(), any(), anyString(), anyInt(), anyInt()))
                .thenReturn(1);
    }

    private CommerceProductMedia row(String kind, Map<String, Object> state) {
        CommerceProductMedia media = new CommerceProductMedia();
        media.setId(ROW);
        media.setInstituteId(INSTITUTE);
        media.setPackageId("pkg-1");
        media.setMediaId(FILE);
        media.setKind(kind);
        media.setRenditionsJson(state);
        when(repository.findById(ROW)).thenReturn(Optional.of(media));
        when(repository.findByInstituteIdAndId(INSTITUTE, ROW)).thenReturn(Optional.of(media));
        return media;
    }

    private static CommerceRenditionClient.Result result800() {
        Map<Integer, String> urls = new TreeMap<>();
        urls.put(320, "https://cdn/v1/file-1/w320.webp");
        urls.put(640, "https://cdn/v1/file-1/w640.webp");
        urls.put(800, "https://cdn/v1/file-1/w800.webp");
        return new CommerceRenditionClient.Result(800, 1000, urls, 1);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(String value) throws Exception {
        return json.readValue(value, Map.class);
    }

    @Test
    void aNewImageIsClaimedProcessedAndWrittenWithItsSize() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenReturn(result800());

        assertEquals(Outcome.READY, service.process(ROW));

        ArgumentCaptor<String> claim = ArgumentCaptor.forClass(String.class);
        verify(repository).swapRenditions(eq(ROW), eq(FILE), isNull(), claim.capture());
        assertEquals("PROCESSING", map(claim.getValue()).get("_status"));

        ArgumentCaptor<String> expected = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> written = ArgumentCaptor.forClass(String.class);
        verify(repository).swapRenditionsAndSize(eq(ROW), eq(FILE), expected.capture(), written.capture(), eq(800),
                eq(1000));
        assertEquals(map(claim.getValue()), map(expected.getValue()));
        Map<String, Object> ready = map(written.getValue());
        assertEquals("READY", ready.get("_status"));
        assertEquals("https://cdn/v1/file-1/w640.webp", ready.get("640"));
        assertEquals(List.of(320, 640, 800), List.copyOf(CommerceRenditionState.urls(ready).keySet()));
    }

    @Test
    void aFinishedImageIsLeftAlone() throws Exception {
        Map<String, Object> ready = CommerceRenditionState.ready(
                CommerceRenditionState.processing(null, FILE, NOW), FILE, result800().urls(), 1);
        row("IMAGE", ready);

        assertEquals(Outcome.SKIPPED, service.process(ROW));

        verifyNoInteractions(client);
        verify(repository, never()).swapRenditions(anyString(), anyString(), any(), anyString());
    }

    @Test
    void aRowAnotherPodTookIsNotProcessedTwice() throws Exception {
        row("IMAGE", null);
        when(repository.swapRenditions(anyString(), anyString(), any(), anyString())).thenReturn(0);

        assertEquals(Outcome.SKIPPED, service.process(ROW));

        verifyNoInteractions(client);
    }

    @Test
    void videosAndUnknownRowsAreSkipped() {
        row("VIDEO", null);
        assertEquals(Outcome.SKIPPED, service.process(ROW));
        when(repository.findById("gone")).thenReturn(Optional.empty());
        assertEquals(Outcome.SKIPPED, service.process("gone"));
        verifyNoInteractions(client);
    }

    @Test
    void aPassingFailureIsQueuedAgainWithADelay() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenThrow(new CommerceRenditionException("BUSY", true, "busy"));

        assertEquals(Outcome.RETRY_LATER, service.process(ROW));

        ArgumentCaptor<String> next = ArgumentCaptor.forClass(String.class);
        verify(repository, org.mockito.Mockito.times(2)).swapRenditions(eq(ROW), eq(FILE), any(), next.capture());
        Map<String, Object> state = map(next.getAllValues().get(1));
        assertEquals("PENDING", state.get("_status"));
        assertEquals("BUSY", state.get("_error"));
        assertEquals(NOW + 60, ((Number) state.get("_next_attempt_at")).longValue());
        assertFalse(CommerceRenditionState.isDue(state, FILE, NOW));
    }

    @Test
    void aFileThatIsNotAnImageFailsWithoutFurtherTries() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenThrow(new CommerceRenditionException("NOT_AN_IMAGE", false, "no"));

        assertEquals(Outcome.FAILED, service.process(ROW));

        ArgumentCaptor<String> next = ArgumentCaptor.forClass(String.class);
        verify(repository, org.mockito.Mockito.times(2)).swapRenditions(eq(ROW), eq(FILE), any(), next.capture());
        assertEquals("FAILED", map(next.getAllValues().get(1)).get("_status"));
    }

    @Test
    void anUnexpectedErrorNeverEscapes() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenThrow(new IllegalStateException("boom"));

        assertEquals(Outcome.RETRY_LATER, service.process(ROW));
    }

    @Test
    void aResultForARowThatChangedMeanwhileIsDropped() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenReturn(result800());
        when(repository.swapRenditionsAndSize(anyString(), anyString(), any(), anyString(), anyInt(), anyInt()))
                .thenReturn(0);

        assertEquals(Outcome.SKIPPED, service.process(ROW));
    }

    @Test
    void theJobWorksThroughDueRowsAndCountsTheFinishedOnes() throws Exception {
        row("IMAGE", null);
        when(repository.findIdsDueForRenditions(anyLong(), anyLong(), anyInt())).thenReturn(List.of(ROW, "gone"));
        when(repository.findById("gone")).thenReturn(Optional.empty());
        when(client.generate(eq(FILE), any())).thenReturn(result800());

        assertEquals(1, service.processDue(60, System.currentTimeMillis() + 60_000));

        verify(repository).findIdsDueForRenditions(NOW, NOW - CommerceRenditionState.STALE_CLAIM_SECONDS, 60);
    }

    @Test
    void anAttachOutsideATransactionStartsTheWorkOffTheCallingThread() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenReturn(result800());

        service.requestAfterCommit(ROW);
        service.requestAfterCommit(null);

        verify(client, timeout(5_000)).generate(eq(FILE), any());
    }

    @Test
    void replacingTheFileDropsTheOldRenditions() {
        CommerceProductMedia media = row("IMAGE", CommerceRenditionState.ready(
                CommerceRenditionState.processing(null, FILE, NOW), FILE, result800().urls(), 1));
        when(repository.findById(ROW)).thenReturn(Optional.empty());

        service.resetForNewFile(media);

        verify(repository).clearRenditions(INSTITUTE, ROW);
        assertNull(media.getRenditionsJson());
    }

    @Test
    void theBackfillQueuesWithinTheInstituteAndIsAudited() {
        when(repository.requeueRenditions(eq(INSTITUTE), isNull(), eq(false), anyString())).thenReturn(7);

        assertEquals(7, service.requeue(INSTITUTE, "user-1", "  ", false));

        verify(audit).record(eq(INSTITUTE), eq("user-1"), eq("MEDIA_RENDITIONS_REQUEUED"), eq("INSTITUTE"),
                eq(INSTITUTE), anyString());
        verify(repository, never()).requeueRenditions(anyString(), anyString(), anyBoolean(), anyString());
    }

    @Test
    void aRetryForARowOfAnotherInstituteIsNotFound() {
        when(repository.findByInstituteIdAndId("inst-2", ROW)).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class, () -> service.retryOne("inst-2", "user-1", ROW));

        verify(repository, never()).clearRenditions(anyString(), anyString());
    }

    @Test
    void statusCountsAlwaysNameTheFourStates() {
        when(repository.countRenditionStatuses(INSTITUTE)).thenReturn(List.of(
                new Object[] {"READY", 12L}, new Object[] {"PENDING", 3L}, new Object[] {"FAILED", 1L}));

        Map<String, Long> counts = service.statusCounts(INSTITUTE);

        assertEquals(List.of("PENDING", "PROCESSING", "READY", "FAILED"), List.copyOf(counts.keySet()));
        assertEquals(12L, counts.get("READY"));
        assertEquals(0L, counts.get("PROCESSING"));
        assertTrue(counts.get("PENDING") == 3L && counts.get("FAILED") == 1L);
    }

    @Test
    void theMediaServiceIsToldWhichInstituteAndProductTheFileMustBelongTo() throws Exception {
        row("IMAGE", null);
        when(client.generate(eq(FILE), any())).thenReturn(result800());

        service.process(ROW);

        verify(client).generate(FILE, List.of(INSTITUTE, "pkg-1"));
    }

    @Test
    void aBusyMediaServiceDoesNotUseUpATry() throws Exception {
        row("IMAGE", map("{\"_status\":\"PENDING\",\"_attempts\":4,\"_media_id\":\"file-1\",\"_next_attempt_at\":0}"));
        when(client.generate(eq(FILE), any())).thenThrow(new CommerceRenditionException("BUSY", true, "busy"));

        assertEquals(Outcome.RETRY_LATER, service.process(ROW));

        ArgumentCaptor<String> next = ArgumentCaptor.forClass(String.class);
        verify(repository, org.mockito.Mockito.times(2)).swapRenditions(eq(ROW), eq(FILE), any(), next.capture());
        Map<String, Object> state = map(next.getAllValues().get(1));
        assertEquals("PENDING", state.get("_status"));
        assertEquals(4, ((Number) state.get("_attempts")).intValue());
    }

    @Test
    void theJobPassRunsOffTheCallingThreadAndOnlyOneAtATime() throws Exception {
        row("IMAGE", null);
        when(repository.findIdsDueForRenditions(anyLong(), anyLong(), anyInt())).thenReturn(List.of(ROW));
        java.util.concurrent.CountDownLatch inside = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<String> worker = new java.util.concurrent.atomic.AtomicReference<>();
        when(client.generate(eq(FILE), any())).thenAnswer(call -> {
            worker.set(Thread.currentThread().getName());
            inside.countDown();
            release.await();
            return result800();
        });

        long started = System.currentTimeMillis();
        assertTrue(service.processDueInBackground(10, 60_000, 0));
        // The caller (the scheduler thread) is back although the media service has not answered.
        assertTrue(System.currentTimeMillis() - started < 2_000);
        assertTrue(inside.await(10, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals("commerce-rendition-job", worker.get());
        assertFalse(service.processDueInBackground(10, 60_000, 0));

        release.countDown();
        verify(repository, timeout(5_000)).swapRenditionsAndSize(eq(ROW), eq(FILE), any(), anyString(), anyInt(),
                anyInt());
        for (int i = 0; i < 50 && !service.processDueInBackground(10, 60_000, 0); i++) {
            Thread.sleep(100);
        }
    }
}
