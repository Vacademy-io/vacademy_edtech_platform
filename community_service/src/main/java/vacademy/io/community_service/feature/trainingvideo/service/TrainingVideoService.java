package vacademy.io.community_service.feature.trainingvideo.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.community_service.feature.trainingvideo.dto.TrainingVideoDto;
import vacademy.io.community_service.feature.trainingvideo.dto.UpsertTrainingVideoRequest;
import vacademy.io.community_service.feature.trainingvideo.entity.TrainingVideo;
import vacademy.io.community_service.feature.trainingvideo.repository.TrainingVideoRepository;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * LMS training videos. Super admins publish them from the health-check dashboard (file bytes
 * go to S3 via media-service; only metadata lands here); every logged-in admin-dashboard user
 * reads the active ones for the Assist Dock "Training" popup.
 */
@Service
public class TrainingVideoService {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };

    /** Module path depth the admin popup's tree supports: Module → Sub-module → Topic. */
    private static final int MAX_PATH_DEPTH = 3;
    private static final int MAX_KEYWORDS = 40;
    private static final int MAX_KEYWORD_LENGTH = 80;

    @Autowired
    private TrainingVideoRepository repository;
    @Autowired
    private ObjectMapper objectMapper;

    /** Super-admin listing — includes inactive videos. */
    @Transactional(readOnly = true)
    public List<TrainingVideoDto> listAll() {
        return repository.findAllByOrderByCreatedAtDesc().stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    /** Institute-facing listing — active videos only, optionally filtered by a search term. */
    @Transactional(readOnly = true)
    public List<TrainingVideoDto> listActive(String search) {
        List<TrainingVideo> rows = StringUtils.hasText(search)
                ? repository.findActiveBySearch(search.trim())
                : repository.findByActiveTrueOrderByCreatedAtDesc();
        return rows.stream().map(this::toDto).collect(Collectors.toList());
    }

    @Transactional
    public TrainingVideoDto create(UpsertTrainingVideoRequest request) {
        List<String> modulePath = validate(request);
        TrainingVideo video = TrainingVideo.builder()
                .title(request.getTitle().trim())
                .description(trimToNull(request.getDescription()))
                .fileId(request.getFileId())
                .fileUrl(request.getFileUrl().trim())
                .modulePath(writePath(modulePath))
                .keywords(writePath(normalizeKeywords(request.getKeywords())))
                .sortOrder(normalizeSortOrder(request.getSortOrder()))
                .active(request.getActive() == null || request.getActive())
                .build();
        return toDto(repository.save(video));
    }

    @Transactional
    public TrainingVideoDto update(String id, UpsertTrainingVideoRequest request) {
        TrainingVideo video = getOrThrow(id);
        if (StringUtils.hasText(request.getTitle())) {
            video.setTitle(request.getTitle().trim());
        }
        if (request.getDescription() != null) {
            video.setDescription(trimToNull(request.getDescription()));
        }
        if (StringUtils.hasText(request.getFileUrl())) {
            video.setFileUrl(request.getFileUrl().trim());
            video.setFileId(request.getFileId());
        }
        if (request.getModulePath() != null && !request.getModulePath().isEmpty()) {
            video.setModulePath(writePath(normalizePath(request.getModulePath())));
        }
        if (request.getActive() != null) {
            video.setActive(request.getActive());
        }
        if (request.getKeywords() != null) {
            video.setKeywords(writePath(normalizeKeywords(request.getKeywords())));
        }
        if (request.getSortOrder() != null) {
            video.setSortOrder(normalizeSortOrder(request.getSortOrder()));
        }
        return toDto(repository.save(video));
    }

    @Transactional
    public void delete(String id) {
        repository.deleteById(id);
    }

    private List<String> validate(UpsertTrainingVideoRequest request) {
        if (request == null || !StringUtils.hasText(request.getTitle())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "title is required");
        }
        if (!StringUtils.hasText(request.getFileUrl())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "fileUrl is required");
        }
        List<String> modulePath = normalizePath(request.getModulePath());
        if (modulePath.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "at least one module path segment is required");
        }
        return modulePath;
    }

    /** Trims segments, drops empty ones and caps the breadcrumb at {@link #MAX_PATH_DEPTH}. */
    private List<String> normalizePath(List<String> raw) {
        if (raw == null) {
            return Collections.emptyList();
        }
        return raw.stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .limit(MAX_PATH_DEPTH)
                .collect(Collectors.toList());
    }

    /** Trims, drops blanks and case-insensitive duplicates, caps count and length. */
    private List<String> normalizeKeywords(List<String> raw) {
        if (raw == null) {
            return Collections.emptyList();
        }
        Set<String> seen = new HashSet<>();
        return raw.stream()
                .filter(StringUtils::hasText)
                .map(k -> k.trim().replaceAll("\\s+", " "))
                .map(k -> k.length() > MAX_KEYWORD_LENGTH ? k.substring(0, MAX_KEYWORD_LENGTH) : k)
                .filter(k -> seen.add(k.toLowerCase(Locale.ROOT)))
                .limit(MAX_KEYWORDS)
                .collect(Collectors.toList());
    }

    private Integer normalizeSortOrder(Integer value) {
        return value == null || value <= 0 ? null : value;
    }

    private String trimToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private TrainingVideo getOrThrow(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Training video not found: " + id));
    }

    private TrainingVideoDto toDto(TrainingVideo v) {
        return TrainingVideoDto.builder()
                .id(v.getId())
                .title(v.getTitle())
                .description(v.getDescription())
                .fileId(v.getFileId())
                .fileUrl(v.getFileUrl())
                .modulePath(readPath(v.getModulePath()))
                .keywords(readPath(v.getKeywords()))
                .sortOrder(v.getSortOrder())
                .active(v.isActive())
                .createdAt(v.getCreatedAt())
                .updatedAt(v.getUpdatedAt())
                .build();
    }

    private String writePath(List<String> modulePath) {
        try {
            return objectMapper.writeValueAsString(modulePath);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid modulePath");
        }
    }

    private List<String> readPath(String json) {
        if (!StringUtils.hasText(json)) {
            return Collections.emptyList();
        }
        try {
            List<String> parsed = objectMapper.readValue(json, STRING_LIST);
            return parsed != null ? parsed : Collections.emptyList();
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }
}
