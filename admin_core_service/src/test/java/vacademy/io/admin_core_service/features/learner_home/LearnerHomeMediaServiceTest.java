package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.learner_home.media.LearnerHomeMediaService;
import vacademy.io.admin_core_service.features.learner_home.media.LearnerHomeRenditionClient;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.BannerConfig;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.ImageRef;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.learner_home.HomeFixtures.block;

/** Publish-time image work: renditions and URLs filled in, failures become warnings, never errors. */
class LearnerHomeMediaServiceTest {

    @Test
    void renditionsAreMadeOncePerFileAndFailuresOnlyWarn() throws Exception {
        LearnerHomeRenditionClient client = mock(LearnerHomeRenditionClient.class);
        CatalogMediaResolver resolver = mock(CatalogMediaResolver.class);
        when(client.generate("big", "inst")).thenReturn(new LearnerHomeRenditionClient.Result(1600, 800,
                new TreeMap<>(Map.of(320, "https://cdn/w320.webp", 1600, "https://cdn/w1600.webp"))));
        when(client.generate("busy", "inst")).thenThrow(new LearnerHomeRenditionClient.RenditionFailed("BUSY", "busy"));
        when(client.generate("small", "inst")).thenReturn(new LearnerHomeRenditionClient.Result(600, 300,
                new TreeMap<>(Map.of(320, "https://cdn/s320.webp"))));
        when(resolver.resolveOne("big")).thenReturn("https://cdn/big.jpg");
        LearnerHomeMediaService media = new LearnerHomeMediaService(client, resolver);

        Block b = block("{'block_key':'ban','type':'BANNER_CAROUSEL','config':{'slides':["
                + "{'key':'a','image':{'file_id':'big','alt':'x'}},"
                + "{'key':'b','image':{'file_id':'big','alt':'x','url':'https://cdn/own.jpg'}},"
                + "{'key':'c','image':{'file_id':'busy','alt':'x','url':'https://cdn/busy.jpg'}},"
                + "{'key':'d','image':{'file_id':'small','alt':'x','url':'https://cdn/small.jpg'}},"
                + "{'key':'e','image':{'file_id':'done','alt':'x','url':'https://cdn/done.jpg','width':1600,'height':800,"
                + "'renditions':{'320':'https://cdn/d320.webp'}}}]}}");
        List<Issue> warnings = new ArrayList<>();
        List<Block> out = media.prepare("inst", List.of(b), warnings);

        List<ImageRef> images = ((BannerConfig) out.get(0).config()).slides().stream().map(s -> s.image()).toList();
        assertEquals("https://cdn/big.jpg", images.get(0).url());
        assertEquals(2, images.get(0).renditions().size());
        assertEquals(1600, images.get(0).width());
        assertEquals("https://cdn/own.jpg", images.get(1).url(), "an image's own URL is kept");
        assertEquals(2, images.get(1).renditions().size());
        assertNull(images.get(2).renditions());
        assertEquals("https://cdn/busy.jpg", images.get(2).url());
        assertEquals("https://cdn/d320.webp", images.get(4).renditions().get("320"));

        verify(client, times(1)).generate(eq("big"), any());
        verify(client, never()).generate(eq("done"), any());
        assertTrue(warnings.stream().anyMatch(w -> w.code().equals("RENDITION_FAILED") && w.path().contains("slides[2]")));
        assertTrue(warnings.stream().anyMatch(w -> w.code().equals("IMAGE_TOO_SMALL") && w.path().contains("slides[3]")));
        assertFalse(warnings.stream().anyMatch(w -> w.code().equals("IMAGE_URL_MISSING")));
    }

    @Test
    void anUnverifiedFileGetsNoServerSideUrl() throws Exception {
        LearnerHomeRenditionClient client = mock(LearnerHomeRenditionClient.class);
        CatalogMediaResolver resolver = mock(CatalogMediaResolver.class);
        when(client.generate(any(), any())).thenThrow(new LearnerHomeRenditionClient.RenditionFailed("NOT_PUBLIC", "no"));
        LearnerHomeMediaService media = new LearnerHomeMediaService(client, resolver);
        Block b = block("{'block_key':'n','type':'NOTICE','config':{'title':'t','image':{'file_id':'someone-elses','alt':'x'}}}");
        List<Issue> warnings = new ArrayList<>();
        media.prepare("inst", List.of(b), warnings);
        verify(resolver, never()).resolveOne(any());
        assertTrue(warnings.stream().anyMatch(w -> w.code().equals("IMAGE_URL_MISSING")));
    }
}
