package vacademy.io.admin_core_service.features.course_catalogue.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CatalogueRevisionDTOs.RevisionResponse;
import vacademy.io.admin_core_service.features.course_catalogue.dtos.CatalogueRevisionDTOs.SaveDraftRequest;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueRevision;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CourseCatalogue;
import vacademy.io.admin_core_service.features.course_catalogue.enums.CatalogueRevisionStatusEnum;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueRevisionRepository;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CourseCatalogueRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class CatalogueRevisionService {

    /** Error code (message prefix) of the 409 a stale publish gets. */
    public static final String DRAFT_OLDER_THAN_LIVE = "DRAFT_OLDER_THAN_LIVE";

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Error code (message prefix) of the 409 a create-only draft save gets while a draft is open. */
    public static final String DRAFT_EXISTS = "DRAFT_EXISTS";

    /** Error code (message prefix) of the 409 when the draft is not the one the caller checked. */
    public static final String DRAFT_CHANGED = "DRAFT_CHANGED";

    /** Error code (message prefix) of the 409 when a checked-draft publish arrives while the stale guard is off. */
    public static final String STALE_GUARD_OFF = "STALE_GUARD_OFF";

    /**
     * Refuse (409) to publish a draft older than the live site. On by default:
     * the editor handles the 409 (Use the live site / Keep my draft / publish
     * anyway), and MCP publishing relies on it. Env override
     * CATALOGUE_PUBLISH_STALEGUARD_ENABLED=false turns it off. The stale flag
     * on getDraft is reported either way.
     */
    @Value("${catalogue.publish.stale-guard.enabled:true}")
    private boolean staleGuardEnabled;

    @Autowired
    private CatalogueRevisionRepository revisionRepository;

    @Autowired
    private CourseCatalogueRepository courseCatalogueRepository;

    /**
     * Latest DRAFT for the catalogue, or empty when none exists. Also says
     * whether the live site changed after the draft was started, so the
     * editor can warn before publishing it undoes that change.
     */
    @Transactional(readOnly = true)
    public Optional<RevisionResponse> getDraft(String catalogueId) {
        return findDraft(catalogueId).map(draft -> {
            CatalogueRevision live = findLive(catalogueId).orElse(null);
            RevisionResponse response = toResponse(draft, true);
            response.setLiveRevisionNo(live != null ? live.getRevisionNo() : null);
            response.setLiveUpdatedAt(live != null ? live.getUpdatedAt() : null);
            response.setLiveChangedSinceDraft(isStale(draft, live, liveJson(catalogueId)));
            return response;
        });
    }

    /** When the live site was last published (null: no published revision on record). */
    @Transactional(readOnly = true)
    public Date liveUpdatedAt(String catalogueId) {
        return findLive(catalogueId).map(CatalogueRevision::getUpdatedAt).orElse(null);
    }

    /** Revision number of the open DRAFT, or null when there is none. */
    @Transactional(readOnly = true)
    public Integer openDraftRevisionNo(String catalogueId) {
        return findDraft(catalogueId).map(CatalogueRevision::getRevisionNo).orElse(null);
    }

    /**
     * Upserts the single DRAFT row for a catalogue: updates it in place when
     * present, otherwise creates one with the next revision number.
     */
    @Transactional
    public RevisionResponse saveDraft(String catalogueId, SaveDraftRequest request, String userId) {
        CourseCatalogue catalogue = requireCatalogue(catalogueId);

        Optional<CatalogueRevision> open = revisionRepository
                .findFirstByCatalogueIdAndStatusOrderByRevisionNoDescIdDesc(catalogueId,
                        CatalogueRevisionStatusEnum.DRAFT.name());
        if (Boolean.TRUE.equals(request.getCreateOnly()) && open.isPresent()) {
            throw new VacademyException(HttpStatus.CONFLICT, DRAFT_EXISTS + ": the site has an unpublished draft (v"
                    + open.get().getRevisionNo() + "). Nothing was saved; publish or discard it first.");
        }
        // "Keep my draft" on a stale draft: start it again from now, so its
        // staleness is measured against the live site the editor has seen.
        // The old row is retired; its content goes on in the new one.
        String carriedSource = null;
        String carriedAiRunId = null;
        if (Boolean.TRUE.equals(request.getAcknowledgeLive()) && open.isPresent()
                && isStale(open.get(), findLive(catalogueId).orElse(null), catalogue.getCatalogueJson())) {
            CatalogueRevision retired = open.get();
            carriedSource = retired.getSource();
            carriedAiRunId = retired.getAiRunId();
            retired.setStatus(CatalogueRevisionStatusEnum.DISCARDED.name());
            revisionRepository.save(retired);
            open = Optional.empty();
        }

        CatalogueRevision draft = open
                .orElseGet(() -> CatalogueRevision.builder()
                        .catalogueId(catalogueId)
                        .revisionNo(nextRevisionNo(catalogueId))
                        .status(CatalogueRevisionStatusEnum.DRAFT.name())
                        .createdByUserId(userId)
                        .build());
        if (draft.getSource() == null) draft.setSource(carriedSource);
        if (draft.getAiRunId() == null) draft.setAiRunId(carriedAiRunId);

        draft.setCatalogueJson(request.getCatalogueJson());
        if (request.getSource() != null) draft.setSource(request.getSource());
        if (draft.getSource() == null) draft.setSource("MANUAL");
        if (request.getAiRunId() != null) draft.setAiRunId(request.getAiRunId());
        draft = revisionRepository.save(draft);
        return toResponse(draft, false);
    }

    /**
     * Promotes the current DRAFT to PUBLISHED and copies its JSON into
     * course_catalogue.catalogue_json — the column the learner app reads.
     *
     * Refuses with 409 DRAFT_OLDER_THAN_LIVE when publishing would undo a live
     * change: the live site was published after the draft was started, or
     * after the editor loaded it (expectedLiveRevisionNo), and differs from
     * the draft. overrideStale publishes anyway. Only while the stale guard is
     * enabled (see staleGuardEnabled).
     */
    @Transactional
    public RevisionResponse publish(String catalogueId, String userId, boolean overrideStale,
                                    Integer expectedLiveRevisionNo) {
        return publish(catalogueId, userId, overrideStale, expectedLiveRevisionNo, null);
    }

    /**
     * As above; expectedDraftSha256 (hex SHA-256 of the draft's catalogue_json
     * exactly as stored) refuses with 409 DRAFT_CHANGED when the open draft is
     * no longer the one the caller checked — an autosave or another editor
     * changed it in between. Checked under the catalogue row lock, whatever
     * overrideStale says. Null skips the check (the editor's call).
     *
     * A checked-draft publish (the MCP one) relies on the stale guard, so while
     * the guard is turned off it is refused with 409 STALE_GUARD_OFF instead of
     * publishing unguarded. The editor's publish (no hash) is unaffected.
     */
    @Transactional
    public RevisionResponse publish(String catalogueId, String userId, boolean overrideStale,
                                    Integer expectedLiveRevisionNo, String expectedDraftSha256) {
        CourseCatalogue catalogue = requireCatalogue(catalogueId);

        CatalogueRevision draft = findDraft(catalogueId)
                .orElseThrow(() -> new VacademyException(HttpStatus.BAD_REQUEST, "No draft to publish"));

        if (expectedDraftSha256 != null && !expectedDraftSha256.isBlank()
                && !expectedDraftSha256.trim().equalsIgnoreCase(sha256Hex(draft.getCatalogueJson()))) {
            throw new VacademyException(HttpStatus.CONFLICT, DRAFT_CHANGED
                    + ": the draft changed after it was checked. Nothing was published; check the draft again.");
        }
        if (expectedDraftSha256 != null && !expectedDraftSha256.isBlank() && !staleGuardEnabled) {
            throw new VacademyException(HttpStatus.CONFLICT, STALE_GUARD_OFF
                    + ": the publish stale guard is turned off on this server, so a checked draft cannot be "
                    + "published from here. Nothing was published; publish from the editor.");
        }

        if (staleGuardEnabled && !overrideStale) {
            CatalogueRevision live = findLive(catalogueId).orElse(null);
            Integer liveNo = live != null ? live.getRevisionNo() : null;
            String liveJson = catalogue.getCatalogueJson();
            if (liveMovedSinceLoad(catalogueId, expectedLiveRevisionNo, liveNo, liveJson, draft)) {
                throw staleConflict("the live site changed after you opened the editor (live v" + liveNo + ")");
            }
            if (isStale(draft, live, liveJson)) {
                throw staleConflict("the live site changed after this draft was started (live v" + liveNo + ")");
            }
        }

        // The promoted row is the live version, so it gets the highest number
        int next = nextRevisionNo(catalogueId);
        if (draft.getRevisionNo() == null || draft.getRevisionNo() < next - 1) draft.setRevisionNo(next);
        draft.setStatus(CatalogueRevisionStatusEnum.PUBLISHED.name());
        revisionRepository.save(draft);

        catalogue.setCatalogueJson(draft.getCatalogueJson());
        courseCatalogueRepository.save(catalogue);

        return toResponse(draft, false);
    }

    /**
     * The editor loaded live version expectedLiveRevisionNo; has the live
     * content changed since? A newer number with the same content (e.g. a
     * settings-only PUT /update) does not count, nor does a live site that
     * already equals the draft.
     */
    private boolean liveMovedSinceLoad(String catalogueId, Integer expectedLiveRevisionNo, Integer liveNo,
                                       String liveJson, CatalogueRevision draft) {
        if (expectedLiveRevisionNo == null || expectedLiveRevisionNo.equals(liveNo)) return false;
        if (sameJson(draft.getCatalogueJson(), liveJson)) return false;
        return revisionRepository
                .findFirstByCatalogueIdAndRevisionNoAndStatusOrderByUpdatedAtDescIdDesc(catalogueId,
                        expectedLiveRevisionNo, CatalogueRevisionStatusEnum.PUBLISHED.name())
                .map(loaded -> !sameJson(loaded.getCatalogueJson(), liveJson))
                .orElse(true);
    }

    private static VacademyException staleConflict(String why) {
        return new VacademyException(HttpStatus.CONFLICT, DRAFT_OLDER_THAN_LIVE + ": " + why
                + ". Publishing this draft would undo those changes. Discard the draft, or publish with overrideStale=true.");
    }

    /** Catalogue a revision belongs to (404 when the revision does not exist). */
    @Transactional(readOnly = true)
    public String catalogueIdOf(String revisionId) {
        return revisionRepository.findById(revisionId)
                .map(CatalogueRevision::getCatalogueId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Revision not found"));
    }

    /** Discards the current DRAFT (editor falls back to the published config). */
    @Transactional
    public void discardDraft(String catalogueId) {
        requireCatalogue(catalogueId);
        revisionRepository
                .findFirstByCatalogueIdAndStatusOrderByRevisionNoDescIdDesc(catalogueId,
                        CatalogueRevisionStatusEnum.DRAFT.name())
                .ifPresent(draft -> {
                    draft.setStatus(CatalogueRevisionStatusEnum.DISCARDED.name());
                    revisionRepository.save(draft);
                });
    }

    /** Revision history (draft + published), newest first, without JSON bodies. */
    @Transactional(readOnly = true)
    public List<RevisionResponse> getHistory(String catalogueId) {
        return revisionRepository
                .findByCatalogueIdAndStatusInOrderByRevisionNoDescIdDesc(catalogueId,
                        List.of(CatalogueRevisionStatusEnum.DRAFT.name(),
                                CatalogueRevisionStatusEnum.PUBLISHED.name()))
                .stream()
                .map(r -> toResponse(r, false))
                .collect(Collectors.toList());
    }

    /** One revision with its full JSON (for history preview / rollback). */
    @Transactional(readOnly = true)
    public RevisionResponse getRevision(String revisionId) {
        CatalogueRevision revision = revisionRepository.findById(revisionId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Revision not found"));
        return toResponse(revision, true);
    }

    /** Loads the parent catalogue with a row lock, serializing all revision
     *  writers for one catalogue (draft upsert / publish / discard races). */
    private CourseCatalogue requireCatalogue(String catalogueId) {
        return courseCatalogueRepository.findByIdForUpdate(catalogueId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Catalogue not found"));
    }

    /** Records a PUBLISHED revision for a legacy direct write to
     *  course_catalogue.catalogue_json, so out-of-band edits stay visible and
     *  restorable in history. */
    @Transactional
    public void recordLegacyPublishedRevision(String catalogueId, String catalogueJson, String userId) {
        requireCatalogue(catalogueId);
        CatalogueRevision revision = CatalogueRevision.builder()
                .catalogueId(catalogueId)
                .revisionNo(nextRevisionNo(catalogueId))
                .catalogueJson(catalogueJson)
                .status(CatalogueRevisionStatusEnum.PUBLISHED.name())
                .source("LEGACY_UPDATE")
                .createdByUserId(userId)
                .build();
        revisionRepository.save(revision);
    }

    /**
     * True when the live site was published after the draft was started AND
     * still differs from it (compared as JSON trees, so formatting and key
     * order do not count) — publishing the draft would undo that change.
     * A re-publish of the very content that was live when the draft started
     * (e.g. a settings-only PUT /update) does not count.
     */
    private boolean isStale(CatalogueRevision draft, CatalogueRevision live, String liveJson) {
        if (live == null || live.getUpdatedAt() == null || draft.getCreatedAt() == null) return false;
        if (!live.getUpdatedAt().after(draft.getCreatedAt())) return false;
        if (sameJson(draft.getCatalogueJson(), liveJson)) return false;
        return revisionRepository
                .findFirstByCatalogueIdAndStatusAndUpdatedAtLessThanEqualOrderByUpdatedAtDescIdDesc(
                        draft.getCatalogueId(), CatalogueRevisionStatusEnum.PUBLISHED.name(), draft.getCreatedAt())
                .map(base -> !sameJson(base.getCatalogueJson(), liveJson))
                .orElse(true);
    }

    /** Lower-case hex SHA-256 of the UTF-8 text ("" for null). */
    static String sha256Hex(String text) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((text == null ? "" : text).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    static boolean sameJson(String a, String b) {
        if (Objects.equals(a, b)) return true;
        if (a == null || b == null) return false;
        try {
            return JSON.readTree(a).equals(JSON.readTree(b));
        } catch (JsonProcessingException e) {
            return false;
        }
    }

    private Optional<CatalogueRevision> findDraft(String catalogueId) {
        return revisionRepository.findFirstByCatalogueIdAndStatusOrderByRevisionNoDescIdDesc(catalogueId,
                CatalogueRevisionStatusEnum.DRAFT.name());
    }

    private Optional<CatalogueRevision> findLive(String catalogueId) {
        return revisionRepository.findFirstByCatalogueIdAndStatusOrderByUpdatedAtDescIdDesc(catalogueId,
                CatalogueRevisionStatusEnum.PUBLISHED.name());
    }

    private String liveJson(String catalogueId) {
        return courseCatalogueRepository.findById(catalogueId).map(CourseCatalogue::getCatalogueJson).orElse(null);
    }

    private Integer nextRevisionNo(String catalogueId) {
        return revisionRepository.findFirstByCatalogueIdOrderByRevisionNoDescIdDesc(catalogueId)
                .map(r -> r.getRevisionNo() + 1)
                .orElse(1);
    }

    private RevisionResponse toResponse(CatalogueRevision r, boolean includeJson) {
        return RevisionResponse.builder()
                .id(r.getId())
                .revisionNo(r.getRevisionNo())
                .status(r.getStatus())
                .source(r.getSource())
                .aiRunId(r.getAiRunId())
                .createdByUserId(r.getCreatedByUserId())
                .createdAt(r.getCreatedAt())
                .updatedAt(r.getUpdatedAt())
                .catalogueJson(includeJson ? r.getCatalogueJson() : null)
                .build();
    }
}
