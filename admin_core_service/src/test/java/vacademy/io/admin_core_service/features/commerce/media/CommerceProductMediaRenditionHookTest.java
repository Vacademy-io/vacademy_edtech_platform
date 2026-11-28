package vacademy.io.admin_core_service.features.commerce.media;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The gallery asks for renditions on attach and on a changed file, and for nothing else. */
class CommerceProductMediaRenditionHookTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PACKAGE = "pkg-1";

    private CommerceProductMediaRepository mediaRepository;
    private CommerceRenditionService renditionService;
    private CommerceProductMediaService service;

    @BeforeEach
    void setUp() {
        mediaRepository = mock(CommerceProductMediaRepository.class);
        CommerceProductRepository productRepository = mock(CommerceProductRepository.class);
        renditionService = mock(CommerceRenditionService.class);
        service = new CommerceProductMediaService(mediaRepository, productRepository,
                mock(CommerceVariantRepository.class), mock(CommerceAuditService.class), renditionService);
        when(productRepository.findByInstituteIdAndPackageId(INSTITUTE, PACKAGE))
                .thenReturn(Optional.of(new CommerceProduct()));
        when(mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(INSTITUTE, PACKAGE))
                .thenReturn(List.of());
        when(mediaRepository.save(any(CommerceProductMedia.class))).thenAnswer(call -> {
            CommerceProductMedia media = call.getArgument(0);
            if (media.getId() == null) {
                media.setId("row-1");
            }
            return media;
        });
    }

    private CommerceProductMedia existing(String kind) {
        CommerceProductMedia media = new CommerceProductMedia();
        media.setId("row-1");
        media.setInstituteId(INSTITUTE);
        media.setPackageId(PACKAGE);
        media.setMediaId("file-1");
        media.setKind(kind);
        media.setPosition(0);
        when(mediaRepository.findByInstituteIdAndId(INSTITUTE, "row-1")).thenReturn(Optional.of(media));
        return media;
    }

    @Test
    void attachingAnImageAsksForRenditionsAndAnswersBeforeTheyExist() {
        ProductMediaDTO saved = service.attach(INSTITUTE, "user-1",
                ProductMediaDTO.builder().packageId(PACKAGE).mediaId("file-1").build());

        assertEquals("row-1", saved.getId());
        assertNull(saved.getRenditions());
        verify(renditionService).requestAfterCommit("row-1");
    }

    @Test
    void attachingAVideoAsksForNothing() {
        service.attach(INSTITUTE, "user-1",
                ProductMediaDTO.builder().packageId(PACKAGE).mediaId("file-1").kind("VIDEO").build());

        verify(renditionService, never()).requestAfterCommit(anyString());
    }

    @Test
    void changingAltTextLeavesTheRenditionsAlone() {
        existing("IMAGE");

        service.update(INSTITUTE, "user-1", "row-1", ProductMediaDTO.builder().mediaId("file-1").tag("real").build());

        verify(renditionService, never()).resetForNewFile(any());
        verify(renditionService, never()).requestAfterCommit(anyString());
    }

    @Test
    void pointingTheEntryAtAnotherFileStartsOver() {
        CommerceProductMedia media = existing("IMAGE");

        service.update(INSTITUTE, "user-1", "row-1", ProductMediaDTO.builder().mediaId("file-2").build());

        verify(renditionService).resetForNewFile(media);
    }
}
