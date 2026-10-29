package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementAssetRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAsset;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementAssetRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Locale;

/**
 * The engine's assets: material the agent may send when a person asks for it. Admin-managed CRUD
 * plus the catalogue the reply brain reads. Engine ownership is the caller's job
 * (EngagementEngineService.requireEngine) — this class only trusts the engineId it is given.
 */
@Service
@RequiredArgsConstructor
public class EngagementAssetService {

    static final int MAX_ASSETS_PER_ENGINE = 50;
    private static final int MAX_TITLE = 200;
    private static final int MAX_DESCRIPTION = 1000;

    private final EngagementAssetRepository repository;

    public List<EngagementAsset> list(String engineId) {
        return repository.findByEngineIdOrderByCreatedAtAsc(engineId);
    }

    @Transactional
    public EngagementAsset add(String engineId, String instituteId, EngagementAssetRequest req, String createdBy) {
        if (repository.countByEngineId(engineId) >= MAX_ASSETS_PER_ENGINE) {
            throw new VacademyException("An engine holds at most " + MAX_ASSETS_PER_ENGINE + " items");
        }
        EngagementAsset asset = new EngagementAsset();
        asset.setEngineId(engineId);
        asset.setInstituteId(instituteId);
        asset.setCreatedBy(createdBy);
        apply(asset, req);
        return repository.save(asset);
    }

    @Transactional
    public void addAll(String engineId, String instituteId, List<EngagementAssetRequest> reqs, String createdBy) {
        if (reqs == null) return;
        if (reqs.size() > MAX_ASSETS_PER_ENGINE) {
            throw new VacademyException("An engine holds at most " + MAX_ASSETS_PER_ENGINE + " items");
        }
        for (EngagementAssetRequest r : reqs) add(engineId, instituteId, r, createdBy);
    }

    @Transactional
    public EngagementAsset update(String engineId, String assetId, EngagementAssetRequest req) {
        EngagementAsset asset = require(engineId, assetId);
        apply(asset, req);
        return repository.save(asset);
    }

    @Transactional
    public void delete(String engineId, String assetId) {
        repository.delete(require(engineId, assetId));
    }

    /** The assets with these ids that belong to this engine; ids from the model are never trusted. */
    public List<EngagementAsset> resolve(String engineId, List<String> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return repository.findByEngineIdAndIdIn(engineId, ids);
    }

    private EngagementAsset require(String engineId, String assetId) {
        EngagementAsset asset = repository.findById(assetId).orElse(null);
        if (asset == null || !engineId.equals(asset.getEngineId())) {
            throw new VacademyException("Asset not found");
        }
        return asset;
    }

    private static void apply(EngagementAsset asset, EngagementAssetRequest req) {
        if (req == null) throw new VacademyException("Asset is required");
        String title = req.getTitle() == null ? "" : req.getTitle().trim();
        if (title.isEmpty()) throw new VacademyException("Give the asset a title");
        if (title.length() > MAX_TITLE) throw new VacademyException("The title is too long");
        String description = req.getDescription() == null ? null : req.getDescription().trim();
        if (description != null && description.length() > MAX_DESCRIPTION) {
            throw new VacademyException("The description is too long (max " + MAX_DESCRIPTION + " characters)");
        }
        String type = req.getMediaType() == null ? "" : req.getMediaType().trim().toLowerCase(Locale.ROOT);
        if (!EngagementAsset.MEDIA_TYPES.contains(type)) {
            throw new VacademyException("Media type must be one of document, image, video, audio, link");
        }
        String url = req.getUrl() == null ? "" : req.getUrl().trim();
        // Meta fetches the file by link and the link is also shown to people: https only.
        if (!url.regionMatches(true, 0, "https://", 0, 8) || url.length() < 12) {
            throw new VacademyException("The item needs a public https URL");
        }
        asset.setTitle(title);
        asset.setDescription(description == null || description.isEmpty() ? null : description);
        asset.setMediaType(type);
        asset.setUrl(url);
        asset.setFileId(req.getFileId());
        asset.setFilename(req.getFilename());
        asset.setMimeType(req.getMimeType());
        asset.setSizeBytes(req.getSizeBytes());
    }
}
