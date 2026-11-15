package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.entity.CommerceImportImageQueue;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ProductPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.repository.CommerceImportImageQueueRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.INSTITUTE;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.reference;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.row;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn.*;

class CommerceImportProductWriterTest {

    private CommerceProductService productService;
    private CommerceProductMediaService mediaService;
    private CommerceProductMediaRepository mediaRepository;
    private CommerceImportImageQueueRepository queueRepository;
    private CommerceImportProductWriter writer;

    @BeforeEach
    void setUp() {
        productService = mock(CommerceProductService.class);
        mediaService = mock(CommerceProductMediaService.class);
        mediaRepository = mock(CommerceProductMediaRepository.class);
        queueRepository = mock(CommerceImportImageQueueRepository.class);
        writer = new CommerceImportProductWriter(productService, mediaService, mediaRepository, queueRepository,
                mock(PlatformTransactionManager.class));
    }

    @Test
    void aNewProductGoesThroughSaveWithItsGalleryAndItsQueuedAddresses() {
        ProductPlan plan = plan(reference(), row(2, HANDLE, "kurta", EXTERNAL_REF, "woo-1", NAME_HI, "कुर्ता",
                SKU, "K-1", PRICE, "100", IMAGE_MEDIA_IDS, "m-1|m-2",
                IMAGE_URLS, "https://old.example/a.jpg|https://old.example/b.jpg"));
        when(productService.save(eq(INSTITUTE), eq("user-1"), any()))
                .thenReturn(ProductResponse.builder().packageId("pkg-new").build());
        when(mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(INSTITUTE, "pkg-new")).thenReturn(List.of());
        when(queueRepository.findByInstituteIdAndPackageId(INSTITUTE, "pkg-new")).thenReturn(List.of());

        CommerceImportProductWriter.Result result = writer.write(INSTITUTE, "user-1", "job-1", plan);

        assertTrue(result.created());
        assertEquals("pkg-new", result.packageId());
        assertEquals(2, result.imageUrlsQueued());
        verify(productService, never()).update(any(), any(), any(), any());
        verify(productService, never()).get(any(), any());

        ArgumentCaptor<ProductMediaDTO> media = ArgumentCaptor.forClass(ProductMediaDTO.class);
        verify(mediaService, times(2)).attach(eq(INSTITUTE), eq("user-1"), media.capture());
        assertEquals(List.of("m-1", "m-2"), media.getAllValues().stream().map(ProductMediaDTO::getMediaId).toList());
        assertEquals("pkg-new", media.getAllValues().get(0).getPackageId());

        ArgumentCaptor<CommerceImportImageQueue> queued = ArgumentCaptor.forClass(CommerceImportImageQueue.class);
        verify(queueRepository, times(2)).save(queued.capture());
        CommerceImportImageQueue first = queued.getAllValues().get(0);
        assertEquals(INSTITUTE, first.getInstituteId());
        assertEquals("job-1", first.getJobId());
        assertEquals("pkg-new", first.getPackageId());
        assertEquals("https://old.example/a.jpg", first.getSourceUrl());
        assertEquals("PENDING", first.getStatus());
        assertEquals(0, first.getPosition());
        assertEquals(1, queued.getAllValues().get(1).getPosition());
    }

    @Test
    void aKnownProductGoesThroughUpdateAndNothingIsAddedTwice() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "kurta", "woo-1", null, "QUANTITY", "PCS", 1, "DRAFT", false));
        ProductPlan plan = plan(ref, row(2, HANDLE, "kurta", EXTERNAL_REF, "woo-1", NAME_HI, "कुर्ता",
                IMAGE_MEDIA_IDS, "m-1|m-2", IMAGE_URLS, "https://old.example/a.jpg|https://old.example/b.jpg"));
        when(productService.get(INSTITUTE, "pkg-1")).thenReturn(ProductResponse.builder().packageId("pkg-1")
                .translations(List.of()).build());
        when(productService.update(eq(INSTITUTE), eq("user-1"), eq("pkg-1"), any()))
                .thenReturn(ProductResponse.builder().packageId("pkg-1").build());
        CommerceProductMedia present = new CommerceProductMedia();
        present.setMediaId("m-1");
        when(mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(INSTITUTE, "pkg-1"))
                .thenReturn(List.of(present));
        CommerceImportImageQueue known = new CommerceImportImageQueue();
        known.setSourceUrl("https://old.example/a.jpg");
        when(queueRepository.findByInstituteIdAndPackageId(INSTITUTE, "pkg-1")).thenReturn(List.of(known));

        CommerceImportProductWriter.Result result = writer.write(INSTITUTE, "user-1", "job-2", plan);

        assertFalse(result.created());
        assertEquals(1, result.imageUrlsQueued());
        verify(productService, never()).save(any(), any(), any());
        verify(mediaService, times(1)).attach(eq(INSTITUTE), eq("user-1"), any());
        ArgumentCaptor<CommerceImportImageQueue> queued = ArgumentCaptor.forClass(CommerceImportImageQueue.class);
        verify(queueRepository, times(1)).save(queued.capture());
        assertEquals("https://old.example/b.jpg", queued.getValue().getSourceUrl());
        assertEquals(1, queued.getValue().getPosition());
    }

    @Test
    void theSameFileASecondTimeAddsNoGalleryEntryAndQueuesNothing() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "kurta", "woo-1", null, "QUANTITY", "PCS", 1, "DRAFT", false));
        ProductPlan plan = plan(ref, row(2, HANDLE, "kurta", EXTERNAL_REF, "woo-1", IMAGE_MEDIA_IDS, "m-1",
                IMAGE_URLS, "https://old.example/a.jpg"));
        when(productService.get(INSTITUTE, "pkg-1")).thenReturn(ProductResponse.builder().packageId("pkg-1").build());
        when(productService.update(any(), any(), any(), any()))
                .thenReturn(ProductResponse.builder().packageId("pkg-1").build());
        CommerceProductMedia present = new CommerceProductMedia();
        present.setMediaId("m-1");
        when(mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(INSTITUTE, "pkg-1"))
                .thenReturn(List.of(present));
        CommerceImportImageQueue known = new CommerceImportImageQueue();
        known.setSourceUrl("https://old.example/a.jpg");
        when(queueRepository.findByInstituteIdAndPackageId(INSTITUTE, "pkg-1")).thenReturn(List.of(known));

        CommerceImportProductWriter.Result result = writer.write(INSTITUTE, "user-1", "job-3", plan);

        assertEquals(0, result.imageUrlsQueued());
        verifyNoInteractions(mediaService);
        verify(queueRepository, never()).save(any());
    }

    @Test
    void anUpdateKeepsStoredTextAndContentBlocksWhereTheFileIsBlank() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "kurta", null, null, "QUANTITY", "PCS", 1, "DRAFT", false));
        ProductPlan plan = plan(ref, row(2, HANDLE, "kurta", SHORT_DESCRIPTION_EN, "New short text"));
        List<Map<String, Object>> blocks = List.of(Map.of("code", "care", "html", "<p>Hand wash</p>"));
        when(productService.get(INSTITUTE, "pkg-1")).thenReturn(ProductResponse.builder().packageId("pkg-1")
                .translations(List.of(
                        ProductTranslationDTO.builder().locale("en").name("Kurta").shortDescription("Old")
                                .descriptionHtml("<p>Long</p>").contentBlocks(blocks).build(),
                        ProductTranslationDTO.builder().locale("hi").name("कुर्ता").contentBlocks(blocks).build()))
                .build());
        when(productService.update(any(), any(), any(), any()))
                .thenReturn(ProductResponse.builder().packageId("pkg-1").build());

        writer.write(INSTITUTE, "user-1", "job-1", plan);

        ArgumentCaptor<ProductRequest> request = ArgumentCaptor.forClass(ProductRequest.class);
        verify(productService).update(eq(INSTITUTE), eq("user-1"), eq("pkg-1"), request.capture());
        List<ProductTranslationDTO> sent = request.getValue().getTranslations();
        assertEquals(2, sent.size());
        assertEquals("hi", sent.get(0).getLocale(), "Hindi stays first, so the legacy name does not flip to English");
        assertEquals("कुर्ता", sent.get(0).getName());
        assertEquals(blocks, sent.get(0).getContentBlocks());
        assertEquals("en", sent.get(1).getLocale());
        assertEquals("Kurta", sent.get(1).getName());
        assertEquals("New short text", sent.get(1).getShortDescription());
        assertEquals("<p>Long</p>", sent.get(1).getDescriptionHtml());
        assertEquals(blocks, sent.get(1).getContentBlocks());
    }

    @Test
    void mergeRules() {
        assertNull(CommerceImportProductWriter.mergeTranslations(null, List.of()));
        assertNull(CommerceImportProductWriter.mergeTranslations(List.of(), List.of()));
        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> CommerceImportProductWriter.mergeTranslations(
                        List.of(ProductTranslationDTO.builder().locale("hi").shortDescription("विवरण").build()),
                        List.of(ProductTranslationDTO.builder().locale("en").name("Kurta").build())));
        assertTrue(e.getMessage().contains("name_hi"));
    }

    @Test
    void aPlanWithErrorsIsNeverWritten() {
        ProductPlan plan = plan(reference(), row(2, HANDLE, "kurta", SKU, "K-1"));
        assertTrue(plan.hasErrors());
        assertThrows(IllegalArgumentException.class, () -> writer.write(INSTITUTE, "user-1", "job-1", plan));
        verifyNoInteractions(productService, mediaService, queueRepository);
    }

    private static ProductPlan plan(ImportReferenceData ref,
                                    vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow row) {
        return new ImportPlanner().plan(List.of(row), ref).products().get(0);
    }

    @Test
    void aBlockOfTheFileReplacesTheStoredOneOfItsCodeAndKeepsTheOthers() {
        List<Map<String, Object>> stored = List.of(
                Map.of("code", "care", "html", "<p>old care</p>"),
                Map.of("code", "size_guide", "html", "<p>typed by hand</p>"));
        List<Map<String, Object>> file = List.of(
                Map.of("code", "story", "html", "<p>new story</p>"),
                Map.of("code", "care", "html", "<p>new care</p>"));

        List<Map<String, Object>> merged = CommerceImportProductWriter.mergeBlocks(stored, file);

        assertEquals(List.of(
                Map.of("code", "care", "html", "<p>new care</p>"),
                Map.of("code", "size_guide", "html", "<p>typed by hand</p>"),
                Map.of("code", "story", "html", "<p>new story</p>")), merged);
        // A file without block cells leaves the stored blocks alone.
        assertEquals(stored, CommerceImportProductWriter.mergeBlocks(stored, null));
        assertEquals(file, CommerceImportProductWriter.mergeBlocks(null, file));
    }
}
