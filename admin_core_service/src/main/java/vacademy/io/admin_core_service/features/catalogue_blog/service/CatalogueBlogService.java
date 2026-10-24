package vacademy.io.admin_core_service.features.catalogue_blog.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostPageResponse;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostRequest;
import vacademy.io.admin_core_service.features.catalogue_blog.dto.BlogPostResponse;
import vacademy.io.admin_core_service.features.catalogue_blog.entity.CatalogueBlogPost;
import vacademy.io.admin_core_service.features.catalogue_blog.enums.BlogPostStatus;
import vacademy.io.admin_core_service.features.catalogue_blog.repository.CatalogueBlogPostRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.text.Normalizer;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Blog posts of an institute's catalogue sites.
 *
 * Two audiences: the dashboard / MCP (every status, institute-checked) and the
 * public site (PUBLISHED and past its publish time only, no auth). The public
 * reads never touch drafts by construction — they go through
 * {@link #publicList} / {@link #publicGet}, which only know the PUBLISHED query.
 */
@Service
public class CatalogueBlogService {

    /** Bodies are bounded so one pasted page cannot become a multi-megabyte row. */
    private static final int MAX_CONTENT_CHARS = 400_000;
    private static final int MAX_SLUG_CHARS = 120;
    private static final int WORDS_PER_MINUTE = 200;
    private static final int MAX_PAGE_SIZE = 50;

    private static final Set<String> STATUSES = Set.of(
            BlogPostStatus.DRAFT.name(), BlogPostStatus.PUBLISHED.name(), BlogPostStatus.ARCHIVED.name());
    private static final Set<String> SOURCES = Set.of("EDITOR", "MCP", "AI");
    private static final String DEFAULT_TEMPLATE = "CLASSIC";
    private static final Set<String> TEMPLATES = Set.of(DEFAULT_TEMPLATE, "SIDEBAR_TOC", "MAGAZINE", "FOCUS");
    private static final int MAX_RECOMMENDED_COURSES = 6;

    @Autowired
    private CatalogueBlogPostRepository repository;

    @Autowired
    private InstituteAccessValidator accessValidator;

    private final ObjectMapper mapper = new ObjectMapper();

    /* ── admin ─────────────────────────────────────────────────────────── */

    public BlogPostPageResponse list(CustomUserDetails user, String instituteId, String status,
                                     String category, String q, int page, int size) {
        accessValidator.validateUserAccess(user, instituteId);
        String st = blank(status) || "ALL".equalsIgnoreCase(status) ? null : status.toUpperCase(Locale.ROOT);
        if (st != null && !STATUSES.contains(st)) {
            throw new VacademyException("Unknown status: " + status);
        }
        Page<CatalogueBlogPost> rows = repository.searchForAdmin(
                instituteId, st, blank(category) ? null : category.trim(), blank(q) ? null : q.trim(),
                PageRequest.of(Math.max(page, 0), clampSize(size)));
        return toPage(rows, false, repository.distinctCategories(instituteId, false, now()));
    }

    public BlogPostResponse get(CustomUserDetails user, String instituteId, String postId) {
        accessValidator.validateUserAccess(user, instituteId);
        return toResponse(require(instituteId, postId), true);
    }

    @Transactional
    public BlogPostResponse create(CustomUserDetails user, String instituteId, BlogPostRequest req) {
        accessValidator.validateUserAccess(user, instituteId);
        if (req == null || blank(req.getTitle())) {
            throw new VacademyException("Title is required");
        }
        String source = blank(req.getSource()) ? "EDITOR" : req.getSource().toUpperCase(Locale.ROOT);
        if (!SOURCES.contains(source)) {
            throw new VacademyException("Unknown source: " + req.getSource());
        }
        String slug = uniqueSlug(instituteId, blank(req.getSlug()) ? req.getTitle() : req.getSlug(), null);
        String status = blank(req.getStatus()) ? BlogPostStatus.DRAFT.name() : req.getStatus().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(status)) {
            throw new VacademyException("Unknown status: " + req.getStatus());
        }
        CatalogueBlogPost post = CatalogueBlogPost.builder()
                .instituteId(instituteId)
                .slug(slug)
                .title(req.getTitle().trim())
                .excerpt(trimOrNull(req.getExcerpt()))
                .contentHtml(capContent(req.getContentHtml()))
                .coverImageUrl(trimOrNull(req.getCoverImageUrl()))
                .authorName(trimOrNull(req.getAuthorName()))
                .authorUserId(user.getUserId())
                .category(trimOrNull(req.getCategory()))
                .tags(writeTags(req.getTags()))
                .status(status)
                .publishedAt(resolvePublishedAt(status, parseInstant(req.getPublishedAt()), null))
                .seoTitle(trimOrNull(req.getSeoTitle()))
                .seoDescription(trimOrNull(req.getSeoDescription()))
                .source(source)
                .readingMinutes(readingMinutes(req.getContentHtml()))
                .template(normaliseTemplate(req.getTemplate()))
                .recommendedCourseIds(writeCourseIds(req.getRecommendedCourseIds()))
                .createdBy(user.getUserId())
                .updatedBy(user.getUserId())
                .build();
        return toResponse(repository.save(post), true);
    }

    @Transactional
    public BlogPostResponse update(CustomUserDetails user, String instituteId, String postId, BlogPostRequest req) {
        accessValidator.validateUserAccess(user, instituteId);
        CatalogueBlogPost post = require(instituteId, postId);
        if (req == null) {
            return toResponse(post, true);
        }
        if (req.getTitle() != null) {
            if (blank(req.getTitle())) throw new VacademyException("Title cannot be empty");
            post.setTitle(req.getTitle().trim());
        }
        if (req.getSlug() != null && !blank(req.getSlug())) {
            post.setSlug(uniqueSlug(instituteId, req.getSlug(), post.getId()));
        }
        if (req.getExcerpt() != null) post.setExcerpt(trimOrNull(req.getExcerpt()));
        if (req.getContentHtml() != null) {
            post.setContentHtml(capContent(req.getContentHtml()));
            post.setReadingMinutes(readingMinutes(req.getContentHtml()));
        }
        if (req.getCoverImageUrl() != null) post.setCoverImageUrl(trimOrNull(req.getCoverImageUrl()));
        if (req.getAuthorName() != null) post.setAuthorName(trimOrNull(req.getAuthorName()));
        if (req.getCategory() != null) post.setCategory(trimOrNull(req.getCategory()));
        if (req.getTags() != null) post.setTags(writeTags(req.getTags()));
        if (req.getSeoTitle() != null) post.setSeoTitle(trimOrNull(req.getSeoTitle()));
        if (req.getSeoDescription() != null) post.setSeoDescription(trimOrNull(req.getSeoDescription()));
        if (req.getTemplate() != null) post.setTemplate(normaliseTemplate(req.getTemplate()));
        if (req.getRecommendedCourseIds() != null) {
            post.setRecommendedCourseIds(writeCourseIds(req.getRecommendedCourseIds()));
        }
        if (req.getStatus() != null && !blank(req.getStatus())) {
            String status = req.getStatus().toUpperCase(Locale.ROOT);
            if (!STATUSES.contains(status)) throw new VacademyException("Unknown status: " + req.getStatus());
            post.setStatus(status);
        }
        Timestamp requested = parseInstant(req.getPublishedAt());
        post.setPublishedAt(resolvePublishedAt(post.getStatus(), requested, post.getPublishedAt()));
        post.setUpdatedBy(user.getUserId());
        return toResponse(repository.save(post), true);
    }

    @Transactional
    public BlogPostResponse setStatus(CustomUserDetails user, String instituteId, String postId, BlogPostStatus status) {
        accessValidator.validateUserAccess(user, instituteId);
        CatalogueBlogPost post = require(instituteId, postId);
        post.setStatus(status.name());
        post.setPublishedAt(resolvePublishedAt(status.name(), null, post.getPublishedAt()));
        post.setUpdatedBy(user.getUserId());
        return toResponse(repository.save(post), true);
    }

    @Transactional
    public void delete(CustomUserDetails user, String instituteId, String postId) {
        accessValidator.validateUserAccess(user, instituteId);
        repository.delete(require(instituteId, postId));
    }

    /* ── public ────────────────────────────────────────────────────────── */

    public BlogPostPageResponse publicList(String instituteId, String category, int page, int size) {
        Timestamp now = now();
        Page<CatalogueBlogPost> rows = repository.findPublished(
                instituteId, blank(category) ? null : category.trim(), now,
                PageRequest.of(Math.max(page, 0), clampSize(size)));
        return toPage(rows, true, repository.distinctCategories(instituteId, true, now));
    }

    public Optional<BlogPostResponse> publicGet(String instituteId, String slug) {
        if (blank(instituteId) || blank(slug)) return Optional.empty();
        return repository.findByInstituteIdAndSlug(instituteId, slug.trim().toLowerCase(Locale.ROOT))
                .filter(this::isPublic)
                .map(p -> toResponse(p, true));
    }

    /* ── helpers ───────────────────────────────────────────────────────── */

    private boolean isPublic(CatalogueBlogPost p) {
        return BlogPostStatus.PUBLISHED.name().equals(p.getStatus())
                && p.getPublishedAt() != null
                && !p.getPublishedAt().after(now());
    }

    private CatalogueBlogPost require(String instituteId, String postId) {
        if (blank(postId)) throw new VacademyException("postId is required");
        return repository.findByIdAndInstituteId(postId, instituteId)
                .orElseThrow(() -> new VacademyException("Blog post not found"));
    }

    /**
     * Publish time rules: an explicit value always wins (backdate / schedule);
     * a first publish with no time stamps now; leaving PUBLISHED keeps the
     * original date so editing an article never bumps it to the top.
     */
    private Timestamp resolvePublishedAt(String status, Timestamp requested, Timestamp existing) {
        if (requested != null) return requested;
        if (BlogPostStatus.PUBLISHED.name().equals(status) && existing == null) return now();
        return existing;
    }

    /**
     * URL-safe slug: ASCII-folded, lowercase, dashes; unique within the
     * institute by suffixing -2, -3… (skipping the row being edited).
     */
    private String uniqueSlug(String instituteId, String raw, String selfId) {
        String base = slugify(raw);
        if (base.isEmpty()) base = "post";
        String candidate = base;
        int n = 2;
        while (true) {
            Optional<CatalogueBlogPost> clash = repository.findByInstituteIdAndSlug(instituteId, candidate);
            if (clash.isEmpty() || (selfId != null && selfId.equals(clash.get().getId()))) {
                return candidate;
            }
            String suffix = "-" + n++;
            candidate = base.substring(0, Math.min(base.length(), MAX_SLUG_CHARS - suffix.length())) + suffix;
        }
    }

    static String slugify(String raw) {
        if (raw == null) return "";
        String s = Normalizer.normalize(raw, Normalizer.Form.NFKD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return s.length() > MAX_SLUG_CHARS ? s.substring(0, MAX_SLUG_CHARS).replaceAll("-+$", "") : s;
    }

    static Integer readingMinutes(String html) {
        if (blank(html)) return null;
        String text = html.replaceAll("<[^>]+>", " ").replaceAll("&[a-z#0-9]+;", " ").trim();
        if (text.isEmpty()) return null;
        int words = text.split("\\s+").length;
        return Math.max(1, (int) Math.ceil(words / (double) WORDS_PER_MINUTE));
    }

    private String capContent(String html) {
        if (html == null) return null;
        if (html.length() > MAX_CONTENT_CHARS) {
            throw new VacademyException("Post body is too long (max " + MAX_CONTENT_CHARS + " characters)");
        }
        return html;
    }

    private String writeTags(List<String> tags) {
        if (tags == null) return null;
        // Deduplicated, trimmed, order preserved; an empty list clears the tags.
        Set<String> clean = new LinkedHashSet<>();
        for (String t : tags) {
            if (!blank(t)) clean.add(t.trim());
        }
        try {
            return mapper.writeValueAsString(new ArrayList<>(clean));
        } catch (Exception e) {
            throw new VacademyException("Could not store tags");
        }
    }

    /** An unknown or missing layout falls back to CLASSIC rather than failing the save. */
    static String normaliseTemplate(String raw) {
        if (blank(raw)) return DEFAULT_TEMPLATE;
        String t = raw.trim().toUpperCase(Locale.ROOT);
        return TEMPLATES.contains(t) ? t : DEFAULT_TEMPLATE;
    }

    private String writeCourseIds(List<String> ids) {
        if (ids == null) return null;
        Set<String> clean = new LinkedHashSet<>();
        for (String id : ids) {
            if (!blank(id)) clean.add(id.trim());
        }
        if (clean.size() > MAX_RECOMMENDED_COURSES) {
            throw new VacademyException("At most " + MAX_RECOMMENDED_COURSES + " recommended courses per post");
        }
        try {
            return mapper.writeValueAsString(new ArrayList<>(clean));
        } catch (Exception e) {
            throw new VacademyException("Could not store recommended courses");
        }
    }

    private List<String> readTags(String json) {
        if (blank(json)) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private Timestamp parseInstant(String iso) {
        if (blank(iso)) return null;
        try {
            return Timestamp.from(Instant.parse(iso.trim()));
        } catch (DateTimeParseException ignored) {
            try {
                return Timestamp.from(OffsetDateTime.parse(iso.trim()).toInstant());
            } catch (DateTimeParseException e) {
                throw new VacademyException("published_at must be ISO-8601, got: " + iso);
            }
        }
    }

    private BlogPostPageResponse toPage(Page<CatalogueBlogPost> rows, boolean publicView, List<String> categories) {
        List<BlogPostResponse> content = rows.getContent().stream().map(p -> toResponse(p, false)).toList();
        return BlogPostPageResponse.builder()
                .content(content)
                .page(rows.getNumber())
                .size(rows.getSize())
                .totalElements(rows.getTotalElements())
                .totalPages(rows.getTotalPages())
                .categories(categories == null ? List.of() : categories)
                .build();
    }

    private BlogPostResponse toResponse(CatalogueBlogPost p, boolean withContent) {
        return BlogPostResponse.builder()
                .id(p.getId())
                .instituteId(p.getInstituteId())
                .slug(p.getSlug())
                .title(p.getTitle())
                .excerpt(p.getExcerpt())
                .contentHtml(withContent ? p.getContentHtml() : null)
                .coverImageUrl(p.getCoverImageUrl())
                .authorName(p.getAuthorName())
                .authorUserId(p.getAuthorUserId())
                .category(p.getCategory())
                .tags(readTags(p.getTags()))
                .status(p.getStatus())
                .publishedAt(iso(p.getPublishedAt()))
                .seoTitle(p.getSeoTitle())
                .seoDescription(p.getSeoDescription())
                .source(p.getSource())
                .readingMinutes(p.getReadingMinutes())
                .template(blank(p.getTemplate()) ? DEFAULT_TEMPLATE : p.getTemplate())
                .recommendedCourseIds(readTags(p.getRecommendedCourseIds()))
                .createdBy(p.getCreatedBy())
                .updatedBy(p.getUpdatedBy())
                .createdAt(iso(p.getCreatedAt()))
                .updatedAt(iso(p.getUpdatedAt()))
                .build();
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
        return s == null || s.trim().isEmpty();
    }

    private static String trimOrNull(String s) {
        return blank(s) ? null : s.trim();
    }
}
