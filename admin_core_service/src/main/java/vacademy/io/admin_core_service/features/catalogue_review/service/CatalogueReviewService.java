package vacademy.io.admin_core_service.features.catalogue_review.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewAnswer;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewPageResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewResponse;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewSubmitRequest;
import vacademy.io.admin_core_service.features.catalogue_review.dto.ReviewUpdateRequest;
import vacademy.io.admin_core_service.features.catalogue_review.entity.CatalogueReview;
import vacademy.io.admin_core_service.features.catalogue_review.repository.CatalogueReviewRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Reviews site visitors leave through a `reviewCollector` block.
 *
 * Two audiences, like blog posts: the public site (submit, and read APPROVED
 * reviews only) and the dashboard (every status, institute-checked, approve /
 * reject / edit / delete). A new review is always PENDING; nothing a visitor
 * writes is public until an admin approves it.
 */
@Service
public class CatalogueReviewService {

    public static final String PENDING = "PENDING";
    public static final String APPROVED = "APPROVED";
    public static final String REJECTED = "REJECTED";
    private static final Set<String> STATUSES = Set.of(PENDING, APPROVED, REJECTED);

    private static final int MAX_TEXT_CHARS = 2000;
    private static final int MAX_NAME_CHARS = 120;
    private static final int MAX_CITY_CHARS = 120;
    private static final int MAX_FIELD_CHARS = 255;
    private static final int MAX_PAGE_SIZE = 50;
    /** One browser can post this many reviews a day. */
    private static final int MAX_PER_VISITOR_PER_DAY = 5;
    /** A flood guard for one institute, far above any real class. */
    private static final int MAX_PER_INSTITUTE_PER_HOUR = 300;
    private static final Pattern VISITOR_KEY = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");
    /** Custom questions per review, and the size of each answer. */
    private static final int MAX_ANSWERS = 20;
    private static final int MAX_ANSWER_KEY_CHARS = 64;
    private static final int MAX_ANSWER_LABEL_CHARS = 120;
    private static final int MAX_ANSWER_VALUE_CHARS = 1000;

    @Autowired
    private CatalogueReviewRepository repository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private InstituteAccessValidator accessValidator;

    @Autowired
    private ReviewSubmittedWorkflowNotifier workflowNotifier;

    @Autowired
    private ReviewAdminAlertService adminAlerts;

    private final ObjectMapper mapper = new ObjectMapper();

    /* ── public ────────────────────────────────────────────────────────── */

    /**
     * A visitor's review, saved as PENDING. A filled honeypot is answered like
     * a success and dropped, so a bot learns nothing.
     */
    @Transactional
    public ReviewResponse submit(ReviewSubmitRequest req) {
        if (req == null) throw new VacademyException(HttpStatus.BAD_REQUEST, "Review is required");
        if (!blank(req.getWebsite())) {
            return ReviewResponse.builder().status(PENDING).build();
        }
        String instituteId = trim(req.getInstituteId());
        if (instituteId == null || !instituteRepository.existsById(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Unknown institute");
        }
        Integer rating = req.getRating();
        if (rating == null || rating < 1 || rating > 5) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Rating must be 1 to 5 stars");
        }
        String name = limit(req.getReviewerName(), MAX_NAME_CHARS);
        if (name == null) throw new VacademyException(HttpStatus.BAD_REQUEST, "Name is required");
        String text = trim(req.getReviewText());
        if (text != null && text.length() > MAX_TEXT_CHARS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Review is too long");
        }
        String visitorKey = trim(req.getVisitorKey());
        if (visitorKey != null && !VISITOR_KEY.matcher(visitorKey).matches()) visitorKey = null;

        Timestamp now = now();
        if (visitorKey != null && repository.countByVisitorKeyAndCreatedAtAfter(
                visitorKey, Timestamp.from(now.toInstant().minus(Duration.ofDays(1)))) >= MAX_PER_VISITOR_PER_DAY) {
            throw new VacademyException(HttpStatus.TOO_MANY_REQUESTS, "Too many reviews from this browser today");
        }
        if (repository.countByInstituteIdAndCreatedAtAfter(
                instituteId, Timestamp.from(now.toInstant().minus(Duration.ofHours(1)))) >= MAX_PER_INSTITUTE_PER_HOUR) {
            throw new VacademyException(HttpStatus.TOO_MANY_REQUESTS, "Too many reviews right now, please try later");
        }

        CatalogueReview saved = repository.save(CatalogueReview.builder()
                .instituteId(instituteId)
                .catalogueTag(limit(req.getCatalogueTag(), 191))
                .pageRoute(limit(req.getPageRoute(), MAX_FIELD_CHARS))
                .rating(rating)
                .reviewText(text)
                .reviewerName(name)
                .city(limit(req.getCity(), MAX_CITY_CHARS))
                .courseName(limit(req.getCourseName(), MAX_FIELD_CHARS))
                .designation(limit(req.getDesignation(), MAX_FIELD_CHARS))
                .status(PENDING)
                .visitorKey(visitorKey)
                .answers(writeAnswers(req.getAnswers()))
                .build());
        fireSubmittedWorkflowAfterCommit(saved);
        return ReviewResponse.builder().id(saved.getId()).status(PENDING).build();
    }

    /** Approved reviews for a testimonials section, plus the overall average. */
    public ReviewPageResponse publicApproved(String instituteId, Integer minRating, int page, int size) {
        if (blank(instituteId)) throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId is required");
        int min = minRating == null ? 1 : Math.max(1, Math.min(5, minRating));
        Page<CatalogueReview> rows = repository.findApproved(instituteId.trim(), min,
                PageRequest.of(Math.max(page, 0), clampSize(size)));
        ReviewPageResponse out = toPage(rows, false);
        List<Object[]> summary = repository.approvedSummary(instituteId.trim());
        if (!summary.isEmpty() && summary.get(0) != null) {
            Object[] row = summary.get(0);
            out.setAverageRating(row[0] == null ? null : Math.round(((Number) row[0]).doubleValue() * 10) / 10.0);
            out.setApprovedCount(row[1] == null ? 0L : ((Number) row[1]).longValue());
        }
        return out;
    }

    /* ── admin ─────────────────────────────────────────────────────────── */

    public ReviewPageResponse list(CustomUserDetails user, String instituteId, String status, String q,
                                   int page, int size) {
        accessValidator.validateUserAccess(user, instituteId);
        String st = blank(status) || "ALL".equalsIgnoreCase(status) ? null : status.trim().toUpperCase(Locale.ROOT);
        if (st != null && !STATUSES.contains(st)) throw new VacademyException("Unknown status: " + status);
        Page<CatalogueReview> rows = repository.searchForAdmin(instituteId, st, trim(q),
                PageRequest.of(Math.max(page, 0), clampSize(size)));
        ReviewPageResponse out = toPage(rows, true);
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String s : List.of(PENDING, APPROVED, REJECTED)) counts.put(s, 0L);
        for (Object[] row : repository.countByStatus(instituteId)) {
            counts.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
        }
        out.setCounts(counts);
        return out;
    }

    @Transactional
    public ReviewResponse update(CustomUserDetails user, String instituteId, String reviewId, ReviewUpdateRequest req) {
        accessValidator.validateUserAccess(user, instituteId);
        CatalogueReview r = require(instituteId, reviewId);
        if (req != null) {
            if (req.getRating() != null) {
                if (req.getRating() < 1 || req.getRating() > 5) throw new VacademyException("Rating must be 1 to 5");
                r.setRating(req.getRating());
            }
            if (req.getReviewerName() != null) {
                String name = limit(req.getReviewerName(), MAX_NAME_CHARS);
                if (name == null) throw new VacademyException("Name is required");
                r.setReviewerName(name);
            }
            if (req.getReviewText() != null) {
                String text = trim(req.getReviewText());
                if (text != null && text.length() > MAX_TEXT_CHARS) throw new VacademyException("Review is too long");
                r.setReviewText(text);
            }
            if (req.getCity() != null) r.setCity(limit(req.getCity(), MAX_CITY_CHARS));
            if (req.getCourseName() != null) r.setCourseName(limit(req.getCourseName(), MAX_FIELD_CHARS));
            if (req.getDesignation() != null) r.setDesignation(limit(req.getDesignation(), MAX_FIELD_CHARS));
            if (!blank(req.getStatus())) applyStatus(r, req.getStatus(), user);
        }
        return toResponse(repository.save(r), true);
    }

    @Transactional
    public ReviewResponse setStatus(CustomUserDetails user, String instituteId, String reviewId, String status) {
        accessValidator.validateUserAccess(user, instituteId);
        CatalogueReview r = require(instituteId, reviewId);
        applyStatus(r, status, user);
        return toResponse(repository.save(r), true);
    }

    @Transactional
    public void delete(CustomUserDetails user, String instituteId, String reviewId) {
        accessValidator.validateUserAccess(user, instituteId);
        repository.delete(require(instituteId, reviewId));
    }

    /* ── helpers ───────────────────────────────────────────────────────── */

    private void applyStatus(CatalogueReview r, String status, CustomUserDetails user) {
        String st = status == null ? "" : status.trim().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(st)) throw new VacademyException("Unknown status: " + status);
        if (st.equals(r.getStatus())) return;
        r.setStatus(st);
        r.setReviewedBy(PENDING.equals(st) || user == null ? null : user.getUserId());
        r.setReviewedAt(PENDING.equals(st) ? null : now());
    }

    private CatalogueReview require(String instituteId, String reviewId) {
        if (blank(reviewId)) throw new VacademyException("reviewId is required");
        return repository.findByIdAndInstituteId(reviewId, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Review not found"));
    }

    private ReviewPageResponse toPage(Page<CatalogueReview> rows, boolean admin) {
        return ReviewPageResponse.builder()
                .content(rows.getContent().stream().map(r -> toResponse(r, admin)).toList())
                .page(rows.getNumber())
                .size(rows.getSize())
                .totalElements(rows.getTotalElements())
                .totalPages(rows.getTotalPages())
                .build();
    }

    private ReviewResponse toResponse(CatalogueReview r, boolean admin) {
        ReviewResponse.ReviewResponseBuilder b = ReviewResponse.builder()
                .id(r.getId())
                .rating(r.getRating())
                .reviewText(r.getReviewText())
                .reviewerName(r.getReviewerName())
                .city(r.getCity())
                .courseName(r.getCourseName())
                .designation(r.getDesignation())
                .createdAt(iso(r.getCreatedAt()));
        if (admin) {
            b.status(r.getStatus())
                    .catalogueTag(r.getCatalogueTag())
                    .pageRoute(r.getPageRoute())
                    .reviewedAt(iso(r.getReviewedAt()))
                    .answers(readAnswers(r.getAnswers()));
        }
        return b.build();
    }

    /**
     * The admins hear about a new review: the built-in bell alert and default
     * email (ReviewAdminAlertService) and REVIEW_SUBMITTED for their own
     * workflows. Only once the review is really saved, and off the request
     * thread, so nothing can see a row that rolls back or slow down or fail
     * the visitor's submit.
     */
    private void fireSubmittedWorkflowAfterCommit(CatalogueReview saved) {
        List<ReviewAnswer> answers = readAnswers(saved.getAnswers());
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    announce(saved, answers);
                }
            });
        } else {
            announce(saved, answers);
        }
    }

    /** The built-in admin alerts (bell + default email) and the admin's own workflows; both async. */
    private void announce(CatalogueReview saved, List<ReviewAnswer> answers) {
        adminAlerts.notifyAdmins(saved, answers);
        workflowNotifier.fire(saved, answers);
    }

    /**
     * Custom-field answers as stored: blank answers dropped, each part cut to
     * its limit, at most MAX_ANSWERS. Null when nothing is left.
     */
    private String writeAnswers(List<ReviewAnswer> answers) {
        if (answers == null || answers.isEmpty()) return null;
        List<ReviewAnswer> kept = new ArrayList<>();
        for (ReviewAnswer a : answers) {
            if (a == null || kept.size() >= MAX_ANSWERS) continue;
            String value = limit(a.getValue(), MAX_ANSWER_VALUE_CHARS);
            if (value == null) continue;
            String key = limit(a.getKey(), MAX_ANSWER_KEY_CHARS);
            String label = limit(a.getLabel(), MAX_ANSWER_LABEL_CHARS);
            kept.add(new ReviewAnswer(key, label == null ? key : label, value));
        }
        if (kept.isEmpty()) return null;
        try {
            return mapper.writeValueAsString(kept);
        } catch (Exception e) {
            return null;
        }
    }

    private List<ReviewAnswer> readAnswers(String json) {
        if (blank(json)) return null;
        try {
            return mapper.readValue(json, new TypeReference<List<ReviewAnswer>>() {});
        } catch (Exception e) {
            return null;
        }
    }

    private static String iso(Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    private static int clampSize(int size) {
        return size <= 0 ? 12 : Math.min(size, MAX_PAGE_SIZE);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String trim(String s) {
        return blank(s) ? null : s.trim();
    }

    /** Trimmed, cut to max characters; null when empty. */
    private static String limit(String s, int max) {
        String t = trim(s);
        if (t == null) return null;
        return t.length() > max ? t.substring(0, max) : t;
    }
}
