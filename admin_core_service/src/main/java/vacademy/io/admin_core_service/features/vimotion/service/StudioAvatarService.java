package vacademy.io.admin_core_service.features.vimotion.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.vimotion.dto.StudioAvatarDTO;
import vacademy.io.admin_core_service.features.vimotion.entity.StudioAvatar;
import vacademy.io.admin_core_service.features.vimotion.repository.StudioAvatarRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
// vendor-call-log: stores fal.ai avatar ids, makes no call
public class StudioAvatarService {

    private static final String PROVIDER_CUSTOM = "custom";
    private static final Set<String> VALID_PROVIDERS = Set.of(PROVIDER_CUSTOM, "argil", "veed");

    @Autowired
    private StudioAvatarRepository repository;

    public List<StudioAvatarDTO> list(String instituteId) {
        return repository.findByInstituteIdOrderByCreatedAtDesc(instituteId).stream()
                .map(StudioAvatarService::toDto)
                .collect(Collectors.toList());
    }

    public StudioAvatarDTO get(String id, String instituteId) {
        return toDto(loadOrThrow(id, instituteId));
    }

    @Transactional
    public StudioAvatarDTO create(String instituteId, StudioAvatarDTO dto, String userId) {
        if (dto == null) throw new VacademyException("Invalid request");
        if (!StringUtils.hasText(dto.getName())) throw new VacademyException("Avatar name is required");

        String provider = normalizeProvider(dto.getProvider());
        validatePerProviderFields(provider, dto.getFaceImageUrl(), dto.getExternalAvatarId());

        StudioAvatar avatar = StudioAvatar.builder()
                .instituteId(instituteId)
                .name(dto.getName())
                .provider(provider)
                .externalAvatarId(PROVIDER_CUSTOM.equals(provider) ? null : dto.getExternalAvatarId())
                .faceImageUrl(PROVIDER_CUSTOM.equals(provider) ? dto.getFaceImageUrl() : null)
                .previewImageUrl(resolvePreviewImageUrl(provider, dto))
                .description(dto.getDescription())
                .voiceId(dto.getVoiceId())
                .voiceProvider(dto.getVoiceProvider())
                .voiceLanguage(dto.getVoiceLanguage())
                .voiceGender(dto.getVoiceGender())
                .createdBy(userId)
                .build();

        return toDto(repository.save(avatar));
    }

    @Transactional
    public StudioAvatarDTO update(String id, String instituteId, StudioAvatarDTO dto, String userId) {
        StudioAvatar avatar = loadOrThrow(id, instituteId);

        // Provider switching is allowed; revalidate against the resulting state.
        String nextProvider = StringUtils.hasText(dto.getProvider())
                ? normalizeProvider(dto.getProvider())
                : avatar.getProvider();
        String nextFaceImageUrl = dto.getFaceImageUrl() != null
                ? dto.getFaceImageUrl()
                : avatar.getFaceImageUrl();
        String nextExternalId = dto.getExternalAvatarId() != null
                ? dto.getExternalAvatarId()
                : avatar.getExternalAvatarId();
        validatePerProviderFields(nextProvider, nextFaceImageUrl, nextExternalId);

        if (StringUtils.hasText(dto.getName())) avatar.setName(dto.getName());
        avatar.setProvider(nextProvider);
        avatar.setExternalAvatarId(PROVIDER_CUSTOM.equals(nextProvider) ? null : nextExternalId);
        avatar.setFaceImageUrl(PROVIDER_CUSTOM.equals(nextProvider) ? nextFaceImageUrl : null);

        if (dto.getPreviewImageUrl() != null) {
            avatar.setPreviewImageUrl(dto.getPreviewImageUrl());
        } else if (dto.getProvider() != null || dto.getFaceImageUrl() != null) {
            // Re-derive preview when provider/face changed and caller didn't pass an explicit one.
            avatar.setPreviewImageUrl(
                    PROVIDER_CUSTOM.equals(nextProvider) ? nextFaceImageUrl : null);
        }

        if (dto.getDescription() != null) avatar.setDescription(dto.getDescription());
        if (dto.getVoiceId() != null) avatar.setVoiceId(dto.getVoiceId());
        if (dto.getVoiceProvider() != null) avatar.setVoiceProvider(dto.getVoiceProvider());
        if (dto.getVoiceLanguage() != null) avatar.setVoiceLanguage(dto.getVoiceLanguage());
        if (dto.getVoiceGender() != null) avatar.setVoiceGender(dto.getVoiceGender());

        return toDto(repository.save(avatar));
    }

    @Transactional
    public void delete(String id, String instituteId) {
        StudioAvatar avatar = loadOrThrow(id, instituteId);
        repository.delete(avatar);
    }

    private StudioAvatar loadOrThrow(String id, String instituteId) {
        return repository.findByIdAndInstituteId(id, instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Avatar not found"));
    }

    private static String normalizeProvider(String value) {
        if (value == null || value.isBlank()) return PROVIDER_CUSTOM;
        String v = value.trim().toLowerCase();
        if (!VALID_PROVIDERS.contains(v)) {
            throw new VacademyException("provider must be one of: custom, argil, veed");
        }
        return v;
    }

    private static void validatePerProviderFields(
            String provider, String faceImageUrl, String externalAvatarId) {
        if (PROVIDER_CUSTOM.equals(provider)) {
            if (!StringUtils.hasText(faceImageUrl)) {
                throw new VacademyException("Custom avatars require a face image");
            }
        } else if (!StringUtils.hasText(externalAvatarId)) {
            throw new VacademyException(
                    "Built-in avatars require external_avatar_id (fal.ai catalog id)");
        }
    }

    private static String resolvePreviewImageUrl(String provider, StudioAvatarDTO dto) {
        if (StringUtils.hasText(dto.getPreviewImageUrl())) return dto.getPreviewImageUrl();
        // Custom avatars implicitly preview their face. Built-ins fall back to null
        // (FE renders initials until we self-host catalog thumbnails).
        if (PROVIDER_CUSTOM.equals(provider)) return dto.getFaceImageUrl();
        return null;
    }

    private static StudioAvatarDTO toDto(StudioAvatar a) {
        return StudioAvatarDTO.builder()
                .id(a.getId())
                .name(a.getName())
                .provider(a.getProvider())
                .externalAvatarId(a.getExternalAvatarId())
                .faceImageUrl(a.getFaceImageUrl())
                .previewImageUrl(a.getPreviewImageUrl())
                .description(a.getDescription())
                .voiceId(a.getVoiceId())
                .voiceProvider(a.getVoiceProvider())
                .voiceLanguage(a.getVoiceLanguage())
                .voiceGender(a.getVoiceGender())
                .createdAt(a.getCreatedAt() == null ? null : a.getCreatedAt().getTime())
                .updatedAt(a.getUpdatedAt() == null ? null : a.getUpdatedAt().getTime())
                .build();
    }
}
