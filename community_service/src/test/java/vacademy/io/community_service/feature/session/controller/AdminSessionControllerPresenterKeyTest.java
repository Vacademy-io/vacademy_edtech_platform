package vacademy.io.community_service.feature.session.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.common.core.exception.GlobalExceptionHandler;
import vacademy.io.common.logging.SentrySensitiveDataScrubber;
import vacademy.io.community_service.feature.presentation.dto.question.AddPresentationDto;
import vacademy.io.community_service.feature.presentation.dto.question.PresentationSlideDto;
import vacademy.io.community_service.feature.presentation.manager.PresentationCrudManager;
import vacademy.io.community_service.feature.session.dto.admin.CreateSessionV2ResponseDto;
import vacademy.io.community_service.feature.session.dto.admin.LiveSessionDto;
import vacademy.io.community_service.feature.session.manager.LiveSessionPersistenceService;
import vacademy.io.community_service.feature.session.manager.LiveSessionService;
import vacademy.io.community_service.feature.session.manager.LiveSessionSummaryAiService;
import vacademy.io.community_service.feature.session.manager.NotificationService;
import vacademy.io.community_service.feature.session.manager.PresenterKeyService;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Runs the real controllers and the real {@link LiveSessionService} over MockMvc, with only
 * storage, AI and email faked. The shared exception advice is installed as in the service, so
 * these tests also see the status code a client would get.
 */
class AdminSessionControllerPresenterKeyTest {

    private static final String ADMIN = "/community-service/engage/admin";
    private static final String LEARNER = "/community-service/engage/learner";
    private static final String KEY_HEADER = "X-Presenter-Token";
    private static final String KEY_PARAM = "presenter_token";
    private static final String AI_SUMMARY =
            "{\"htmlSummary\":\"<p>s</p>\",\"htmlActionPoints\":[\"a\"],\"adminComment\":\"c\"}";

    private final ObjectMapper json = new ObjectMapper();
    private final ScheduledExecutorService heartbeats = Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService broadcasts = Executors.newSingleThreadExecutor();

    private NotificationService notifications;
    private PresenterKeyService presenterKeys;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        PresentationCrudManager presentations = mock(PresentationCrudManager.class);
        PresentationSlideDto first = new PresentationSlideDto();
        first.setId("slide-1");
        PresentationSlideDto second = new PresentationSlideDto();
        second.setId("slide-2");
        AddPresentationDto deck = new AddPresentationDto();
        deck.setId("deck-1");
        deck.setTitle("Deck");
        deck.setAddedSlides(new ArrayList<>(List.of(first, second)));
        when(presentations.getPresentation(anyString())).thenReturn(ResponseEntity.ok(deck));

        LiveSessionSummaryAiService summaries = mock(LiveSessionSummaryAiService.class);
        when(summaries.summarize(anyString())).thenReturn(AI_SUMMARY);
        notifications = mock(NotificationService.class);

        LiveSessionService sessions = new LiveSessionService();
        ReflectionTestUtils.setField(sessions, "presentationCrudManager", presentations);
        ReflectionTestUtils.setField(sessions, "notificationService", notifications);
        ReflectionTestUtils.setField(sessions, "liveSessionSummaryAiService", summaries);
        ReflectionTestUtils.setField(sessions, "persistenceService", mock(LiveSessionPersistenceService.class));
        ReflectionTestUtils.setField(sessions, "broadcastExecutor", broadcasts);

        AdminSessionController admin = new AdminSessionController();
        ReflectionTestUtils.setField(admin, "liveSessionService", sessions);
        presenterKeys = spy(new PresenterKeyService());
        ReflectionTestUtils.setField(admin, "presenterKeyService", presenterKeys);
        ReflectionTestUtils.setField(admin, "persistenceService", mock(LiveSessionPersistenceService.class));
        ReflectionTestUtils.setField(admin, "sseHeartbeatScheduler", heartbeats);

        ParticipantSessionController learner = new ParticipantSessionController();
        ReflectionTestUtils.setField(learner, "liveSessionService", sessions);
        ReflectionTestUtils.setField(learner, "sseHeartbeatScheduler", heartbeats);

        mvc = MockMvcBuilders.standaloneSetup(admin, learner)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @AfterEach
    void tearDown() {
        heartbeats.shutdownNow();
        broadcasts.shutdownNow();
    }

    // ---- /create behaves as before ----

    @Test
    void createResponseHasNoKeyAndKeepsItsShape() throws Exception {
        JsonNode created = readJson(mvc.perform(createRequest("/create")).andExpect(status().isOk()));

        assertThat(created.hasNonNull("session_id")).isTrue();
        assertThat(created.hasNonNull("invite_code")).isTrue();
        assertThat(created.get("session_status").asText()).isEqualTo("INIT");
        assertThat(created.has("session")).isFalse();
        assertThat(created.toString().toLowerCase(Locale.ROOT)).doesNotContain("presenter");
    }

    @Test
    void createSessionWorksAsBeforeOnEveryCall() throws Exception {
        String id = plainSession();

        mvc.perform(stream(id)).andExpect(status().isOk()).andExpect(request().asyncStarted());
        mvc.perform(control("/start", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.session_status").value("LIVE"));
        mvc.perform(control("/move", id, 1)).andExpect(status().isOk())
                .andExpect(jsonPath("$.current_slide_index").value(1));
        mvc.perform(addSlide(id)).andExpect(status().isOk());
        mvc.perform(get(ADMIN + "/" + id + "/slide/slide-1/responses")).andExpect(status().isOk());
        mvc.perform(get(ADMIN + "/" + id + "/leaderboard")).andExpect(status().isOk());
        mvc.perform(get(ADMIN + "/" + id + "/leaderboard/csv")).andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.startsWith("Rank,Username")));
        mvc.perform(control("/finish", id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.session_status").value("FINISHED"));
        mvc.perform(notify(id)).andExpect(status().isOk());
    }

    @Test
    void createSessionIgnoresAKeyItNeverHad() throws Exception {
        String id = plainSession();

        mvc.perform(control("/start", id).header(KEY_HEADER, "anything")).andExpect(status().isOk());
    }

    @Test
    void refusalsForUnknownSessionsAreUnchanged() throws Exception {
        // The advice answers VacademyException with 510; a 403 here would mean the gate had run.
        mvc.perform(control("/start", "no-such-session")).andExpect(status().is(510));
    }

    // ---- /v2/create ----

    @Test
    void v2CreateReturnsSessionAndKeySeparately() throws Exception {
        JsonNode created = readJson(mvc.perform(createRequest("/v2/create")).andExpect(status().isOk()));
        String key = created.get("presenter_key").asText();

        assertThat(Set.of(fieldNames(created).toArray())).containsExactlyInAnyOrder("session", "presenter_key");
        assertThat(key).hasSize(43);
        assertThat(created.get("session").toString()).doesNotContain(key);
        assertThat(created.get("session").toString().toLowerCase(Locale.ROOT)).doesNotContain("presenter");

        JsonNode plain = readJson(mvc.perform(createRequest("/create")).andExpect(status().isOk()));
        assertThat(fieldNames(created.get("session"))).isEqualTo(fieldNames(plain));
    }

    @Test
    void v2ResponseToStringLeavesTheKeyOut() {
        CreateSessionV2ResponseDto dto = new CreateSessionV2ResponseDto(new LiveSessionDto(), "secret-value");

        assertThat(dto.toString()).doesNotContain("secret-value");
    }

    @Test
    void liveSessionDtoHasNoKeyField() {
        assertThat(Arrays.stream(LiveSessionDto.class.getDeclaredFields()).map(f -> f.getName().toLowerCase(Locale.ROOT)))
                .noneMatch(name -> name.contains("presenter") || name.endsWith("key"));
    }

    @Test
    void everyControlCallNeedsTheRightHeader() throws Exception {
        Keyed s = keyedSession();
        Keyed other = keyedSession();

        List<MockHttpServletRequestBuilder> calls = List.of(
                control("/start", s.id),
                control("/move", s.id, 1),
                control("/finish", s.id),
                notify(s.id),
                addSlide(s.id));
        for (MockHttpServletRequestBuilder call : calls) {
            expectRefused(mvc.perform(call));
        }
        expectRefused(mvc.perform(control("/start", s.id).header(KEY_HEADER, "wrong")));
        expectRefused(mvc.perform(control("/start", s.id).header(KEY_HEADER, other.key)));
        expectRefused(mvc.perform(control("/move", s.id, 1).header(KEY_HEADER, "wrong")));
        expectRefused(mvc.perform(control("/finish", s.id).header(KEY_HEADER, "wrong")));
        expectRefused(mvc.perform(notify(s.id).header(KEY_HEADER, "wrong")));
        expectRefused(mvc.perform(addSlide(s.id).header(KEY_HEADER, "wrong")));

        // A refused call changed nothing: the session has not started.
        JsonNode started = readJson(mvc.perform(control("/start", s.id).header(KEY_HEADER, s.key))
                .andExpect(status().isOk()));
        assertThat(started.get("session_status").asText()).isEqualTo("LIVE");

        mvc.perform(control("/move", s.id, 1).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        mvc.perform(addSlide(s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        mvc.perform(control("/finish", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        mvc.perform(notify(s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
    }

    @Test
    void controlCallsDoNotTakeTheKeyFromTheUrl() throws Exception {
        Keyed s = keyedSession();

        expectRefused(mvc.perform(control("/start", s.id).param(KEY_PARAM, s.key)));
        expectRefused(mvc.perform(notify(s.id).param(KEY_PARAM, s.key)));
    }

    @Test
    void readCallsTakeTheKeyFromHeaderOrUrl() throws Exception {
        Keyed s = keyedSession();
        String[] reads = {
                ADMIN + "/" + s.id + "/slide/slide-1/responses",
                ADMIN + "/" + s.id + "/leaderboard",
                ADMIN + "/" + s.id + "/leaderboard/csv" };

        for (String path : reads) {
            expectRefused(mvc.perform(get(path)));
            expectRefused(mvc.perform(get(path).param(KEY_PARAM, "wrong")));
            expectRefused(mvc.perform(get(path).header(KEY_HEADER, "wrong")));
            mvc.perform(get(path).param(KEY_PARAM, s.key)).andExpect(status().isOk());
            mvc.perform(get(path).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        }
    }

    @Test
    void presenterStreamTakesTheKeyFromTheUrl() throws Exception {
        Keyed s = keyedSession();

        expectRefused(mvc.perform(stream(s.id)));
        expectRefused(mvc.perform(stream(s.id).param(KEY_PARAM, "wrong")));
        mvc.perform(stream(s.id).param(KEY_PARAM, s.key))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());
        mvc.perform(stream(s.id).header(KEY_HEADER, s.key))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());
    }

    @Test
    void refusalIsStill403WhenTheClientOnlyAcceptsStreamOrCsv() throws Exception {
        Keyed s = keyedSession();

        expectRefused(mvc.perform(get(ADMIN + "/" + s.id).header(HttpHeaders.ACCEPT, "text/event-stream")));
        expectRefused(mvc.perform(get(ADMIN + "/" + s.id + "/leaderboard/csv").header(HttpHeaders.ACCEPT, "text/csv")));
    }

    // ---- logging ----

    @Test
    void theEarlierHeaderAndQueryNamesAreNotRead() throws Exception {
        Keyed s = keyedSession();

        expectRefused(mvc.perform(control("/start", s.id).header("X-Presenter-Key", s.key)));
        expectRefused(mvc.perform(get(ADMIN + "/" + s.id + "/leaderboard").param("k", s.key)));
        expectRefused(mvc.perform(stream(s.id).param("k", s.key)));
    }

    @Test
    void noServiceMethodIsCalledWithTheRawKey() throws Exception {
        Keyed s = keyedSession();
        mvc.perform(control("/start", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        mvc.perform(get(ADMIN + "/" + s.id + "/leaderboard").param(KEY_PARAM, s.key)).andExpect(status().isOk());
        expectRefused(mvc.perform(control("/move", s.id, 1).header(KEY_HEADER, s.key + "x")));

        assertThat(mockingDetails(presenterKeys).getInvocations()).isNotEmpty()
                .allSatisfy(call -> assertThat(call.getArguments())
                        .noneMatch(arg -> arg instanceof String text && text.contains(s.key)));
    }

    @Test
    void theSharedScrubberRedactsTheHeaderAndQueryNames() throws Exception {
        String redacted = SentrySensitiveDataScrubber.redactQueryString(KEY_PARAM + "=secret-value&slide=2");
        assertThat(redacted).doesNotContain("secret-value").contains("slide=2");

        java.lang.reflect.Method isSensitiveHeader = SentrySensitiveDataScrubber.class
                .getDeclaredMethod("isSensitiveHeader", String.class);
        isSensitiveHeader.setAccessible(true);
        assertThat((Boolean) isSensitiveHeader.invoke(null, KEY_HEADER)).isTrue();
    }

    // ---- after finish ----

    @Test
    void summaryAfterFinishStillNeedsTheKey() throws Exception {
        Keyed s = keyedSession();
        join(s.inviteCode, "learner@example.com");
        mvc.perform(control("/start", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        mvc.perform(control("/finish", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());

        expectRefused(mvc.perform(notify(s.id)));
        verify(notifications, times(0)).sendEmail(any());

        mvc.perform(notify(s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        verify(notifications, times(1)).sendEmail(any());
    }

    @Test
    void resultsAfterFinishStillNeedTheKey() throws Exception {
        Keyed s = keyedSession();
        mvc.perform(control("/finish", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());

        expectRefused(mvc.perform(get(ADMIN + "/" + s.id + "/leaderboard")));
        mvc.perform(get(ADMIN + "/" + s.id + "/leaderboard").param(KEY_PARAM, s.key)).andExpect(status().isOk());
    }

    @Test
    void finishRetryWithTheKeySucceeds() throws Exception {
        Keyed s = keyedSession();

        mvc.perform(control("/finish", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk());
        mvc.perform(control("/finish", s.id).header(KEY_HEADER, s.key)).andExpect(status().isOk())
                .andExpect(jsonPath("$.session_status").value("FINISHED"));
    }

    // ---- learners ----

    @Test
    void learnerJsonNeverCarriesTheKey() throws Exception {
        Keyed s = keyedSession();

        String details = mvc.perform(post(LEARNER + "/get-details/" + s.inviteCode)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"learner\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(details).contains(s.id).doesNotContain(s.key);
        assertThat(details.toLowerCase(Locale.ROOT)).doesNotContain("presenter");

        String updated = mvc.perform(get(LEARNER + "/get-updated-details/" + s.id))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(updated).contains(s.id).doesNotContain(s.key);
    }

    @Test
    void learnerPathsNeedNoKeyOnAKeyedSession() throws Exception {
        Keyed s = keyedSession();
        join(s.inviteCode, "learner");

        mvc.perform(get(LEARNER + "/" + s.id + "/leaderboard")).andExpect(status().isOk());
        mvc.perform(get(LEARNER + "/" + s.id).param("username", "learner"))
                .andExpect(status().isOk())
                .andExpect(request().asyncStarted());
        mvc.perform(post(LEARNER + "/" + s.id + "/heartbeat").param("username", "learner"))
                .andExpect(status().isOk());
    }

    // ---- helpers ----

    private record Keyed(String id, String key, String inviteCode) {
    }

    private Keyed keyedSession() throws Exception {
        JsonNode created = readJson(mvc.perform(createRequest("/v2/create")).andExpect(status().isOk()));
        return new Keyed(created.get("session").get("session_id").asText(), created.get("presenter_key").asText(),
                created.get("session").get("invite_code").asText());
    }

    private String plainSession() throws Exception {
        return readJson(mvc.perform(createRequest("/create")).andExpect(status().isOk())).get("session_id").asText();
    }

    private void join(String inviteCode, String username) throws Exception {
        mvc.perform(post(LEARNER + "/get-details/" + inviteCode)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\"}"))
                .andExpect(status().isOk());
    }

    private MockHttpServletRequestBuilder createRequest(String path) {
        return post(ADMIN + path)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"source\":\"PRESENTATION\",\"source_id\":\"deck-1\"}");
    }

    private MockHttpServletRequestBuilder control(String path, String sessionId) {
        return post(ADMIN + path)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"session_id\":\"" + sessionId + "\"}");
    }

    private MockHttpServletRequestBuilder control(String path, String sessionId, int moveTo) {
        return post(ADMIN + path)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"session_id\":\"" + sessionId + "\",\"move_to\":" + moveTo + "}");
    }

    private MockHttpServletRequestBuilder notify(String sessionId) {
        return post(ADMIN + "/finish-send-notifications")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"session_id\":\"" + sessionId + "\",\"transcript\":\"hello\"}");
    }

    private MockHttpServletRequestBuilder addSlide(String sessionId) {
        return post(ADMIN + "/add-slide-in-session")
                .param("sessionId", sessionId)
                .param("afterSlideOrder", "0")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"slide-3\",\"presentation_id\":\"deck-1\"}");
    }

    private MockHttpServletRequestBuilder stream(String sessionId) {
        return get(ADMIN + "/" + sessionId);
    }

    private void expectRefused(ResultActions result) throws Exception {
        result.andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    private JsonNode readJson(ResultActions result) throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private Set<String> fieldNames(JsonNode node) {
        Set<String> names = new TreeSet<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
