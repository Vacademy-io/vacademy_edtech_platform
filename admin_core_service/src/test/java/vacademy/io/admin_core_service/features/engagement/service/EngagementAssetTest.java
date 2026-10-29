package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementAssetRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAsset;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAssetRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The assets is what the agent may send to a lead on its own, so what goes into it is checked here:
 * only https URLs Meta can fetch, only WhatsApp-sendable media types, and an item can only be
 * touched through the engine that owns it.
 */
class EngagementAssetTest {

    private EngagementAssetRepository repo;
    private EngagementAssetService service;

    @BeforeEach
    void setUp() {
        repo = mock(EngagementAssetRepository.class);
        when(repo.save(any(EngagementAsset.class))).thenAnswer(i -> i.getArgument(0));
        service = new EngagementAssetService(repo);
    }

    private static EngagementAssetRequest brochure() {
        return EngagementAssetRequest.builder().title(" Course brochure ").description("Fees-free overview PDF")
                .mediaType("DOCUMENT").url("https://cdn.example.com/b.pdf").filename("b.pdf").build();
    }

    @Test
    void addsTrimmedItemWithLowercasedType() {
        EngagementAsset a = service.add("e1", "inst", brochure(), "u1");
        assertEquals("Course brochure", a.getTitle());
        assertEquals("document", a.getMediaType());
        assertEquals("e1", a.getEngineId());
        assertEquals("u1", a.getCreatedBy());
    }

    @Test
    void rejectsPlainHttpBecauseTheLinkIsFetchedAndShown() {
        EngagementAssetRequest r = brochure();
        r.setUrl("http://cdn.example.com/b.pdf");
        assertThrows(VacademyException.class, () -> service.add("e1", "inst", r, "u1"));
        verify(repo, never()).save(any());
    }

    @Test
    void rejectsMediaTypesWhatsAppCannotCarry() {
        EngagementAssetRequest r = brochure();
        r.setMediaType("zip");
        assertThrows(VacademyException.class, () -> service.add("e1", "inst", r, "u1"));
    }

    @Test
    void rejectsBlankTitle() {
        EngagementAssetRequest r = brochure();
        r.setTitle("  ");
        assertThrows(VacademyException.class, () -> service.add("e1", "inst", r, "u1"));
    }

    @Test
    void capsTheAssets() {
        when(repo.countByEngineId("e1")).thenReturn((long) EngagementAssetService.MAX_ASSETS_PER_ENGINE);
        assertThrows(VacademyException.class, () -> service.add("e1", "inst", brochure(), "u1"));
    }

    @Test
    void anotherEnginesItemIsNotFound() {
        EngagementAsset foreign = new EngagementAsset();
        foreign.setEngineId("other-engine");
        when(repo.findById("a1")).thenReturn(Optional.of(foreign));
        assertThrows(VacademyException.class, () -> service.delete("e1", "a1"));
        assertThrows(VacademyException.class, () -> service.update("e1", "a1", brochure()));
        verify(repo, never()).delete(any(EngagementAsset.class));
    }

    @Test
    void resolveWithNoIdsDoesNotHitTheDatabase() {
        assertTrue(service.resolve("e1", null).isEmpty());
        assertTrue(service.resolve("e1", List.of()).isEmpty());
        verify(repo, never()).findByEngineIdAndIdIn(any(), any());
    }

    @Test
    void catalogueShowsIdTypeTitleAndDescriptionButNeverTheUrl() {
        EngagementAsset a = service.add("e1", "inst", brochure(), "u1");
        a.setId("asset-1");
        String catalogue = EngagementReplyBrain.assetCatalogue(List.of(a));
        assertTrue(catalogue.contains("asset-1"));
        assertTrue(catalogue.contains("document"));
        assertTrue(catalogue.contains("Course brochure"));
        assertTrue(catalogue.contains("Fees-free overview PDF"));
        assertFalse(catalogue.contains("cdn.example.com"));
        assertEquals("(no assets yet)", EngagementReplyBrain.assetCatalogue(List.of()));
    }
}
