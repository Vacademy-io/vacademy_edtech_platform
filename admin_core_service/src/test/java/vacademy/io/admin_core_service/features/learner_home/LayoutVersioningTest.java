package vacademy.io.admin_core_service.features.learner_home;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeBlock;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeLayout;
import vacademy.io.admin_core_service.features.learner_home.media.LearnerHomeMediaService;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeBlockRepository;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeLayoutRepository;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeResolver;
import vacademy.io.admin_core_service.features.learner_home.resolve.LinkMetaService;
import vacademy.io.admin_core_service.features.learner_home.resolve.ShelfResolver;
import vacademy.io.admin_core_service.features.learner_home.service.BlockMapper;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeLayoutService;
import vacademy.io.admin_core_service.features.learner_home.service.PublishChecks;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.*;

/**
 * Draft / publish / restore rules (spec 2.5) against mocked repositories: optimistic revision,
 * one PUBLISHED row with version max+1, block keys kept, archived pruned to 20, restore with and
 * without force. The same flow against a real Postgres is in LearnerHomeDatabaseProofIT.
 */
class LayoutVersioningTest {

    static final String INST = "inst-1";
    static final String USER = "admin-1";

    LearnerHomeLayoutRepository layouts;
    LearnerHomeBlockRepository blocks;
    LearnerHomeJdbc jdbc;
    LearnerHomeMediaService media;
    LearnerHomeLayoutCache cache;
    LearnerHomeLayoutService service;

    @BeforeEach
    void setUp() {
        layouts = mock(LearnerHomeLayoutRepository.class);
        blocks = mock(LearnerHomeBlockRepository.class);
        jdbc = mock(LearnerHomeJdbc.class);
        media = mock(LearnerHomeMediaService.class);
        cache = mock(LearnerHomeLayoutCache.class);
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(media.prepare(any(), any(), any())).thenAnswer(i -> i.getArgument(1));
        PublishChecks checks = new PublishChecks(jdbc, new LinkMetaService(jdbc), mock(ShelfResolver.class));
        service = new LearnerHomeLayoutService(layouts, blocks, checks, media, cache, mock(LearnerHomeResolver.class), tm);
    }

    LearnerHomeLayout draft(int revision, Integer baseVersion) {
        return LearnerHomeLayout.builder().id("d1").instituteId(INST).status("DRAFT").version(0)
                .baseVersion(baseVersion).revision(revision).settingsJson("{}").createdByUserId(USER)
                .updatedByUserId(USER).createdAt(Instant.now()).updatedAt(Instant.now()).build();
    }

    List<LearnerHomeBlock> rows(String layoutId, String... json) {
        List<Block> list = new ArrayList<>();
        list.add(block(HomeFixtures.HERO));
        for (String j : json) list.add(block(j));
        return BlockMapper.toEntities(list, layoutId, INST, Instant.now());
    }

    static final String NOTICE = "{'block_key':'keep-me','type':'NOTICE','config':{'title':'Hello'}}";

    // ── Save ────────────────────────────────────────────────────────────────

    @Test
    void staleRevisionIs409WithTheCurrentState() {
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(5, null)));
        when(layouts.bumpDraftRevision(eq("d1"), eq(4), eq(USER), anyString())).thenReturn(0);
        when(layouts.draftState("d1")).thenReturn(List.<Object[]>of(new Object[] {5, "other-admin",
                Timestamp.from(Instant.parse("2026-11-16T09:00:00Z"))}));
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> service.saveDraft(INST, USER,
                json("{'revision':4,'settings':{},'blocks':[" + HomeFixtures.HERO + "]}")));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals("STALE_DRAFT", e.getCode());
        assertEquals(5, e.body().get("revision"));
        assertEquals("other-admin", e.body().get("updated_by"));
        assertEquals("2026-11-16T09:00:00Z", e.body().get("updated_at"));
        verify(blocks, never()).deleteByLayout(any());
    }

    @Test
    void saveReplacesTheWholeBlockSetInOrder() {
        LearnerHomeLayout d = draft(4, null);
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(d));
        when(layouts.bumpDraftRevision(eq("d1"), eq(4), eq(USER), anyString())).thenReturn(1);
        LearnerHomeLayout saved = draft(5, null);
        when(layouts.findById("d1")).thenReturn(Optional.of(saved));
        ObjectNode out = service.saveDraft(INST, USER, json("{'revision':4,'settings':{'phone_spacing':'COMFORTABLE'},'blocks':["
                + NOTICE + "," + HomeFixtures.HERO + "]}"));
        assertEquals(5, out.get("revision").asInt());
        verify(blocks).deleteByLayout("d1");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LearnerHomeBlock>> saved2 = ArgumentCaptor.forClass(List.class);
        verify(blocks).saveAllAndFlush(saved2.capture());
        assertEquals(List.of("keep-me", "hero"), saved2.getValue().stream().map(LearnerHomeBlock::getBlockKey).toList());
        assertEquals(List.of(0, 1), saved2.getValue().stream().map(LearnerHomeBlock::getPosition).toList());
        ArgumentCaptor<String> settings = ArgumentCaptor.forClass(String.class);
        verify(layouts).bumpDraftRevision(eq("d1"), eq(4), eq(USER), settings.capture());
        assertTrue(settings.getValue().contains("COMFORTABLE"));
    }

    @Test
    void invalidSaveIs422WithEveryProblem() {
        when(jdbc.batchOwners(any())).thenReturn(List.<LearnerHomeJdbc.Owner>of(new LearnerHomeJdbc.Owner("ps-x", "inst-2", null, null)));
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> service.saveDraft(INST, USER,
                json("{'revision':1,'extra':1,'blocks':[{'type':'NOTICE','audience':{'mode':'RULES','all_of':[{'kind':'PACKAGE_SESSION','ids':['ps-x']}]}}]}")));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertEquals("VALIDATION_FAILED", e.getCode());
        @SuppressWarnings("unchecked")
        List<Issue> errors = (List<Issue>) e.body().get("errors");
        assertTrue(codes(errors).containsAll(List.of("UNKNOWN_FIELD", "HERO_REQUIRED", "OTHER_INSTITUTE")));
        verify(layouts, never()).bumpDraftRevision(any(), anyInt(), any(), any());
    }

    @Test
    void secondDraftIsRefused() {
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(1, null)));
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> service.createDraft(INST, USER,
                json("{'template_key':'CLASSROOM','blocks':[" + HomeFixtures.HERO + "]}")));
        assertEquals("DRAFT_EXISTS", e.getCode());
        assertEquals("VALIDATION_FAILED", assertThrows(LearnerHomeException.class, () -> service.createDraft(INST, USER,
                json("{'template_key':'FANCY','blocks':[" + HomeFixtures.HERO + "]}"))).getCode());
    }

    // ── Draft view ──────────────────────────────────────────────────────────

    @Test
    void draftViewCarriesThePublishedBlocksForTheDiff() {
        LearnerHomeLayout pub = LearnerHomeLayout.builder().id("v7").instituteId(INST).status("PUBLISHED").version(7)
                .revision(1).settingsJson("{}").publishedByUserId(USER)
                .publishedAt(Instant.parse("2026-11-16T09:00:00Z")).build();
        when(layouts.findFirstByInstituteIdAndStatus(INST, "PUBLISHED")).thenReturn(Optional.of(pub));
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.empty());
        when(blocks.findByLayoutIdOrderByPositionAsc("v7")).thenReturn(rows("v7", NOTICE));

        ObjectNode out = service.draftView(INST, true, false);
        assertTrue(out.get("draft").isNull());
        var p = out.get("published");
        assertEquals(7, p.get("version").asInt());
        assertEquals("2026-11-16T09:00:00Z", p.get("published_at").asText());
        assertEquals(2, p.get("block_count").asInt());
        assertEquals(2, p.get("blocks").size());
        assertEquals("hero", p.get("blocks").get(0).get("block_key").asText());
        var notice = p.get("blocks").get(1);
        assertEquals("keep-me", notice.get("block_key").asText());
        assertEquals("NOTICE", notice.get("type").asText());
        assertEquals("Hello", notice.get("config").get("title").asText());
        assertEquals("EVERYONE", notice.get("audience").get("mode").asText());
    }

    @Test
    void draftViewPublishedIsNullWhenNothingIsPublished() {
        when(layouts.findFirstByInstituteIdAndStatus(eq(INST), any())).thenReturn(Optional.empty());
        assertTrue(service.draftView(INST, false, false).get("published").isNull());
    }

    // ── Publish ─────────────────────────────────────────────────────────────

    @Test
    void publishMakesOnePublishedVersionKeepsKeysDeletesDraftAndPrunes() {
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(3, 6)));
        when(blocks.findByLayoutIdOrderByPositionAsc("d1")).thenReturn(rows("d1", NOTICE));
        when(layouts.lockDraftState("d1")).thenReturn(List.<Object[]>of(new Object[] {3, USER, null}));
        when(layouts.maxVersion(INST)).thenReturn(6);

        ObjectNode out = service.publish(INST, USER, 3);
        assertEquals(7, out.get("version").asInt());

        var order = inOrder(layouts, blocks, cache);
        order.verify(layouts).archivePublished(INST);
        ArgumentCaptor<LearnerHomeLayout> pub = ArgumentCaptor.forClass(LearnerHomeLayout.class);
        order.verify(layouts).saveAndFlush(pub.capture());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<LearnerHomeBlock>> copied = ArgumentCaptor.forClass(List.class);
        order.verify(blocks).saveAllAndFlush(copied.capture());
        order.verify(layouts).deleteLayout("d1");
        order.verify(layouts).pruneArchived(INST, 20);
        order.verify(cache, atLeastOnce()).evict(INST);

        assertEquals("PUBLISHED", pub.getValue().getStatus());
        assertEquals(7, pub.getValue().getVersion());
        assertEquals(USER, pub.getValue().getPublishedByUserId());
        assertNotNull(pub.getValue().getPublishedAt());
        assertEquals(List.of("hero", "keep-me"), copied.getValue().stream().map(LearnerHomeBlock::getBlockKey).toList());
        assertTrue(copied.getValue().stream().allMatch(b -> b.getLayoutId().equals(pub.getValue().getId())));
    }

    @Test
    void publishWithAnOldRevisionIs409BeforeAnyWork() {
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(4, null)));
        assertEquals("STALE_DRAFT", assertThrows(LearnerHomeException.class, () -> service.publish(INST, USER, 3)).getCode());
        verify(media, never()).prepare(any(), any(), any());
        verify(layouts, never()).archivePublished(any());
    }

    @Test
    void aSaveDuringPublishIsCaughtUnderTheLock() {
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(3, null)));
        when(blocks.findByLayoutIdOrderByPositionAsc("d1")).thenReturn(rows("d1"));
        when(layouts.lockDraftState("d1")).thenReturn(List.<Object[]>of(new Object[] {4, "other", null}));
        assertEquals("STALE_DRAFT", assertThrows(LearnerHomeException.class, () -> service.publish(INST, USER, 3)).getCode());
        verify(layouts, never()).archivePublished(any());
    }

    @Test
    void publishCheckErrorsAre422AndNothingIsWritten() {
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(1, null)));
        when(blocks.findByLayoutIdOrderByPositionAsc("d1")).thenReturn(rows("d1",
                "{'block_key':'ban','type':'BANNER_CAROUSEL','config':{'slides':[{'key':'s'}]}}"));
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> service.publish(INST, USER, 1));
        assertEquals("PUBLISH_CHECKS_FAILED", e.getCode());
        assertNotNull(e.body().get("warnings"));
        verify(layouts, never()).archivePublished(any());
        verify(media, never()).prepare(any(), any(), any());
    }

    @Test
    void unpublishArchivesAndEvicts() {
        service.unpublish(INST);
        verify(layouts).archivePublished(INST);
        verify(cache, atLeastOnce()).evict(INST);
    }

    // ── Restore ─────────────────────────────────────────────────────────────

    @Test
    void restoreNeedsForceWhenADraftExists() {
        LearnerHomeLayout v3 = LearnerHomeLayout.builder().id("v3").instituteId(INST).status("ARCHIVED").version(3)
                .revision(1).settingsJson("{}").build();
        when(layouts.findFirstByInstituteIdAndVersionAndStatusIn(eq(INST), eq(3), any())).thenReturn(Optional.of(v3));
        when(layouts.findFirstByInstituteIdAndStatus(INST, "DRAFT")).thenReturn(Optional.of(draft(2, null)));
        when(blocks.findByLayoutIdOrderByPositionAsc("v3")).thenReturn(rows("v3", NOTICE));

        assertEquals("DRAFT_EXISTS", assertThrows(LearnerHomeException.class, () -> service.restore(INST, USER, 3, false)).getCode());
        verify(layouts, never()).deleteLayout(any());

        ObjectNode out = service.restore(INST, USER, 3, true);
        verify(layouts).deleteLayout("d1");
        assertEquals("DRAFT", out.get("status").asText());
        assertEquals(3, out.get("base_version").asInt());
        assertEquals(1, out.get("revision").asInt());
        assertEquals("keep-me", out.get("blocks").get(1).get("block_key").asText());
    }

    @Test
    void restoreOfAPrunedVersionIs404() {
        when(layouts.findFirstByInstituteIdAndVersionAndStatusIn(eq(INST), eq(1), any())).thenReturn(Optional.empty());
        LearnerHomeException e = assertThrows(LearnerHomeException.class, () -> service.restore(INST, USER, 1, true));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("VERSION_NOT_FOUND", e.getCode());
    }
}
