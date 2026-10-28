package vacademy.io.admin_core_service.features.catalogue_review;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewPageResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewSubmitRequest;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewUpdateRequest;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;
import vacademy.io.admin_core_service.features.catalogue_review.repository.CatalogueReviewRepository;
import vacademy.io.admin_core_service.features.catalogue_review.service.CatalogueReviewService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Site reviews: a visitor's review always lands PENDING, bots and floods are
 * turned away, the public list is approved-only, and approving records who
 * did it.
 */
class CatalogueReviewServiceTest {

    private static final String INSTITUTE = "inst-1";

    private CatalogueReviewRepository repository;
    private InstituteRepository instituteRepository;
    private InstituteAccessValidator accessValidator;
    private CatalogueReviewService service;

    @BeforeEach
    void setUp() {
        repository = mock(CatalogueReviewRepository.class);
        instituteRepository = mock(InstituteRepository.class);
        accessValidator = mock(InstituteAccessValidator.class);
        service = new CatalogueReviewService();
        ReflectionTestUtils.setField(service, "repository", repository);
        ReflectionTestUtils.setField(service, "instituteRepository", instituteRepository);
        ReflectionTestUtils.setField(service, "accessValidator", accessValidator);
        when(instituteRepository.existsById(INSTITUTE)).thenReturn(true);
        when(repository.save(any(CatalogueReview.class))).thenAnswer(inv -> {
            CatalogueReview r = inv.getArgument(0);
            if (r.getId() == null) r.setId("r-new");
            return r;
        });
    }

    private static ReviewSubmitRequest request(Integer rating, String name) {
        ReviewSubmitRequest req = new ReviewSubmitRequest();
        req.setInstituteId(INSTITUTE);
        req.setRating(rating);
        req.setReviewerName(name);
        req.setReviewText("  Clear teaching  ");
        req.setCity("Ajmer");
        req.setVisitorKey("visitor-0123456789");
        return req;
    }

    private static CustomUserDetails admin() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("admin-1");
        dto.setUsername("admin@school.test");
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    // ── submit ───────────────────────────────────────────────────────────

    @Test
    void submit_savesAPendingReview_trimmed() {
        ReviewResponse res = service.submit(request(5, "  Asha "));
        assertEquals("PENDING", res.getStatus());
        ArgumentCaptor<CatalogueReview> saved = ArgumentCaptor.forClass(CatalogueReview.class);
        verify(repository).save(saved.capture());
        assertEquals("PENDING", saved.getValue().getStatus());
        assertEquals("Asha", saved.getValue().getReviewerName());
        assertEquals("Clear teaching", saved.getValue().getReviewText());
        assertEquals(5, saved.getValue().getRating());
    }

    @Test
    void submit_filledHoneypot_looksAcceptedButSavesNothing() {
        ReviewSubmitRequest req = request(5, "Bot");
        req.setWebsite("http://spam.example");
        assertEquals("PENDING", service.submit(req).getStatus());
        verify(repository, never()).save(any());
    }

    @Test
    void submit_rejectsBadRatingMissingNameAndUnknownInstitute() {
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.submit(request(0, "A"))).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.submit(request(6, "A"))).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class, () -> service.submit(request(4, "  "))).getStatus());
        ReviewSubmitRequest other = request(4, "A");
        other.setInstituteId("nope");
        assertThrows(VacademyException.class, () -> service.submit(other));
        verify(repository, never()).save(any());
    }

    @Test
    void submit_sixthReviewFromOneBrowserInADay_isRateLimited() {
        when(repository.countByVisitorKeyAndCreatedAtAfter(eq("visitor-0123456789"), any())).thenReturn(5L);
        VacademyException e = assertThrows(VacademyException.class, () -> service.submit(request(5, "Asha")));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
        verify(repository, never()).save(any());
    }

    // ── public list ──────────────────────────────────────────────────────

    @Test
    void publicApproved_readsApprovedOnly_withAverage_andNoModerationFields() {
        CatalogueReview r = CatalogueReview.builder().id("r1").instituteId(INSTITUTE).rating(5).reviewerName("Asha")
                .status("APPROVED").visitorKey("visitor-0123456789").catalogueTag("site").build();
        when(repository.findApproved(eq(INSTITUTE), eq(4), any(Pageable.class))).thenReturn(new PageImpl<>(List.of(r)));
        when(repository.approvedSummary(INSTITUTE)).thenReturn(List.<Object[]>of(new Object[]{4.66, 12L}));
        ReviewPageResponse page = service.publicApproved(INSTITUTE, 4, 0, 9);
        assertEquals(1, page.getContent().size());
        assertNull(page.getContent().get(0).getStatus());
        assertNull(page.getContent().get(0).getCatalogueTag());
        assertEquals(4.7, page.getAverageRating());
        assertEquals(12L, page.getApprovedCount());
    }

    // ── admin ────────────────────────────────────────────────────────────

    @Test
    void approve_recordsWhoAndWhen_andBackToPendingClearsIt() {
        CatalogueReview r = CatalogueReview.builder().id("r1").instituteId(INSTITUTE).rating(4).reviewerName("Asha").status("PENDING").build();
        when(repository.findByIdAndInstituteId("r1", INSTITUTE)).thenReturn(Optional.of(r));

        assertEquals("APPROVED", service.setStatus(admin(), INSTITUTE, "r1", "approved").getStatus());
        assertEquals("admin-1", r.getReviewedBy());
        assertNotNull(r.getReviewedAt());

        service.setStatus(admin(), INSTITUTE, "r1", "PENDING");
        assertNull(r.getReviewedBy());
        assertNull(r.getReviewedAt());
        verify(accessValidator, times(2)).validateUserAccess(any(), eq(INSTITUTE));
    }

    @Test
    void setStatus_unknownStatusOrOtherInstitutesReview_fails() {
        when(repository.findByIdAndInstituteId(anyString(), anyString())).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.setStatus(admin(), INSTITUTE, "r9", "APPROVED"));
        CatalogueReview r = CatalogueReview.builder().id("r1").instituteId(INSTITUTE).rating(4).reviewerName("A").status("PENDING").build();
        when(repository.findByIdAndInstituteId("r1", INSTITUTE)).thenReturn(Optional.of(r));
        assertThrows(VacademyException.class, () -> service.setStatus(admin(), INSTITUTE, "r1", "PUBLISHED"));
    }

    @Test
    void update_editsOnlyTheGivenFields() {
        CatalogueReview r = CatalogueReview.builder().id("r1").instituteId(INSTITUTE).rating(4).reviewerName("Asha")
                .reviewText("Gud").city("Ajmer").status("PENDING").build();
        when(repository.findByIdAndInstituteId("r1", INSTITUTE)).thenReturn(Optional.of(r));
        ReviewUpdateRequest req = new ReviewUpdateRequest();
        req.setReviewText("Good");
        service.update(admin(), INSTITUTE, "r1", req);
        assertEquals("Good", r.getReviewText());
        assertEquals("Ajmer", r.getCity());
        assertEquals(4, r.getRating());
    }

    @Test
    void list_fillsEveryStatusCount() {
        when(repository.searchForAdmin(eq(INSTITUTE), any(), any(), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));
        when(repository.countByStatus(INSTITUTE)).thenReturn(List.<Object[]>of(new Object[]{"PENDING", 3L}));
        ReviewPageResponse page = service.list(admin(), INSTITUTE, "ALL", null, 0, 20);
        assertEquals(3L, page.getCounts().get("PENDING"));
        assertEquals(0L, page.getCounts().get("APPROVED"));
        assertEquals(0L, page.getCounts().get("REJECTED"));
    }
}
