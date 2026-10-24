package vacademy.io.admin_core_service.features.institute.service.setting;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.constants.ConstantsSettingDefaultValue;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingDataDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingRequest;
import vacademy.io.admin_core_service.features.institute.enums.CertificateTypeEnum;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class CertificateSettingStrategy extends IInstituteSettingStrategy{


    @Override
    public String buildInstituteSetting(Institute institute, Object settingRequest) {

        setKey(SettingKeyEnums.CERTIFICATE_SETTING.name());

        String settingJsonString = institute.getSetting();
        if(Objects.isNull(settingJsonString)) return handleCaseWhereNoSettingPresent(institute, settingRequest);

        return handleCaseWhereInstituteSettingPresent(institute, settingRequest);
    }

    private String handleCaseWhereInstituteSettingPresent(Institute institute, Object settingRequest) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            CertificateSettingRequest certificateSettingRequest = (CertificateSettingRequest) settingRequest;
            if (certificateSettingRequest == null) throw new VacademyException("Invalid Request");

            // Parse the existing setting JSON string to Map
            InstituteSettingDto instituteSettingDto = objectMapper.readValue(
                    institute.getSetting(), InstituteSettingDto.class
            );

            Map<String, SettingDto> existingSettings = instituteSettingDto.getSetting();
            if (existingSettings == null) existingSettings = new HashMap<>();

            // Re-save path: certificate setting already exists for this
            // institute. Delegate to rebuildInstituteSetting under the
            // CERTIFICATE_SETTING key. (Earlier this passed NAMING_SETTING by
            // mistake — a copy-paste from the naming strategy — which silently
            // wrote each subsequent save into the wrong slot, so the UI saw
            // stale data and looked "reset" after every save.)
            if (existingSettings.containsKey(SettingKeyEnums.CERTIFICATE_SETTING.name())) {
                return rebuildInstituteSetting(institute, certificateSettingRequest, SettingKeyEnums.CERTIFICATE_SETTING.name());
            }

            // Otherwise, create a new naming setting and add it
            CertificateSettingDataDto data = createCertificateSettingFromRequest(certificateSettingRequest);

            SettingDto settingDto = new SettingDto();
            settingDto.setKey(SettingKeyEnums.CERTIFICATE_SETTING.name());
            settingDto.setName("Certificate Setting");
            settingDto.setData(data);

            existingSettings.put(SettingKeyEnums.CERTIFICATE_SETTING.name(), settingDto);
            instituteSettingDto.setSetting(existingSettings);

            return objectMapper.writeValueAsString(instituteSettingDto);
        } catch (Exception e) {
            throw new VacademyException("Error updating setting: " + e.getMessage());
        }
    }

    private CertificateSettingDataDto createCertificateSettingFromRequest(CertificateSettingRequest certificateSettingRequest) {
        return createCertificateSettingFromRequest(certificateSettingRequest, java.util.Collections.emptyMap());
    }

    /**
     * Build the persisted DTO list from the inbound request, falling back to
     * any matching existing record when a request field is null. The "preserve
     * on null" merge lets Visual-mode saves keep the admin's authored HTML
     * intact (htmlEditorTemplate) and lets HTML-mode saves keep the visual
     * editor state intact (imageTemplateJson). Without this both editors
     * would clobber the other's data on save.
     */
    private CertificateSettingDataDto createCertificateSettingFromRequest(
            CertificateSettingRequest certificateSettingRequest,
            Map<String, CertificateSettingDto> existingByKey) {
        List<CertificateSettingDto> certificateSetting = certificateSettingRequest.getRequest().entrySet().stream()
                .map(entry -> {
                    CertificateSettingDto incoming = entry.getValue();
                    CertificateSettingDto existing = existingByKey.getOrDefault(entry.getKey(), new CertificateSettingDto());
                    CertificateSettingDto dto = new CertificateSettingDto();
                    dto.setKey(entry.getKey());
                    dto.setIsDefaultCertificateSettingOn(incoming.getIsDefaultCertificateSettingOn() != null ? incoming.getIsDefaultCertificateSettingOn() : existing.getIsDefaultCertificateSettingOn());
                    dto.setCustomHtmlCertificateTemplate(incoming.getCustomHtmlCertificateTemplate() != null ? incoming.getCustomHtmlCertificateTemplate() : existing.getCustomHtmlCertificateTemplate());
                    dto.setCurrentHtmlCertificateTemplate(incoming.getCurrentHtmlCertificateTemplate() != null ? incoming.getCurrentHtmlCertificateTemplate() : existing.getCurrentHtmlCertificateTemplate());
                    dto.setDefaultHtmlCertificateTemplate(incoming.getDefaultHtmlCertificateTemplate() != null ? incoming.getDefaultHtmlCertificateTemplate() : existing.getDefaultHtmlCertificateTemplate());
                    dto.setPlaceHoldersMapping(incoming.getPlaceHoldersMapping() != null ? incoming.getPlaceHoldersMapping() : existing.getPlaceHoldersMapping());
                    dto.setAutoIssuePercentage(incoming.getAutoIssuePercentage() != null ? incoming.getAutoIssuePercentage() : existing.getAutoIssuePercentage());
                    dto.setAspectRatio(incoming.getAspectRatio() != null ? incoming.getAspectRatio() : existing.getAspectRatio());
                    dto.setCustomWidthMm(incoming.getCustomWidthMm() != null ? incoming.getCustomWidthMm() : existing.getCustomWidthMm());
                    dto.setCustomHeightMm(incoming.getCustomHeightMm() != null ? incoming.getCustomHeightMm() : existing.getCustomHeightMm());
                    dto.setImageTemplateJson(incoming.getImageTemplateJson() != null ? incoming.getImageTemplateJson() : existing.getImageTemplateJson());
                    dto.setHtmlEditorTemplate(incoming.getHtmlEditorTemplate() != null ? incoming.getHtmlEditorTemplate() : existing.getHtmlEditorTemplate());
                    dto.setPreferredEditorMode(incoming.getPreferredEditorMode() != null ? incoming.getPreferredEditorMode() : existing.getPreferredEditorMode());
                    dto.setCertificateNumbering(incoming.getCertificateNumbering() != null ? incoming.getCertificateNumbering() : existing.getCertificateNumbering());
                    dto.setQrVerificationUrlTemplate(incoming.getQrVerificationUrlTemplate() != null ? incoming.getQrVerificationUrlTemplate() : existing.getQrVerificationUrlTemplate());
                    dto.setBadgeCodeType(incoming.getBadgeCodeType() != null ? incoming.getBadgeCodeType() : existing.getBadgeCodeType());
                    dto.setBarcodeContent(incoming.getBarcodeContent() != null ? incoming.getBarcodeContent() : existing.getBarcodeContent());
                    dto.setAutoStampCode(incoming.getAutoStampCode() != null ? incoming.getAutoStampCode() : existing.getAutoStampCode());
                    dto.setAutoStampNumber(incoming.getAutoStampNumber() != null ? incoming.getAutoStampNumber() : existing.getAutoStampNumber());
                    dto.setVerificationNote(incoming.getVerificationNote() != null ? incoming.getVerificationNote() : existing.getVerificationNote());
                    dto.setVerificationHeadline(incoming.getVerificationHeadline() != null ? incoming.getVerificationHeadline() : existing.getVerificationHeadline());
                    dto.setVerificationShowCourse(incoming.getVerificationShowCourse() != null ? incoming.getVerificationShowCourse() : existing.getVerificationShowCourse());
                    dto.setVerificationShowIssueDate(incoming.getVerificationShowIssueDate() != null ? incoming.getVerificationShowIssueDate() : existing.getVerificationShowIssueDate());
                    dto.setVerificationShowCompletion(incoming.getVerificationShowCompletion() != null ? incoming.getVerificationShowCompletion() : existing.getVerificationShowCompletion());
                    dto.setVerificationShowFullDetails(incoming.getVerificationShowFullDetails() != null ? incoming.getVerificationShowFullDetails() : existing.getVerificationShowFullDetails());
                    // Same preserve-on-null merge as every field above: the settings
                    // screen posts only what it edits, so a null here means "leave it",
                    // not "clear it". Clearing a verification document is done by
                    // switching the mode back to PAGE, never by omitting the field.
                    dto.setVerificationMode(incoming.getVerificationMode() != null ? incoming.getVerificationMode() : existing.getVerificationMode());
                    dto.setVerificationDocumentType(incoming.getVerificationDocumentType() != null ? incoming.getVerificationDocumentType() : existing.getVerificationDocumentType());
                    dto.setVerificationDocumentHtml(incoming.getVerificationDocumentHtml() != null ? incoming.getVerificationDocumentHtml() : existing.getVerificationDocumentHtml());
                    dto.setVerificationDocumentFileId(incoming.getVerificationDocumentFileId() != null ? incoming.getVerificationDocumentFileId() : existing.getVerificationDocumentFileId());
                    // Preserve-on-null like the rest, so a save from an older
                    // client can't wipe the institute's field definitions.
                    // Clearing every field is still possible — that sends an
                    // empty list, which is not null.
                    dto.setCustomFields(incoming.getCustomFields() != null ? incoming.getCustomFields() : existing.getCustomFields());
                    return dto;
                })
                .collect(Collectors.toList());

        // Keep every entry the request does not mention. The settings UI only ever sends
        // COURSE_COMPLETION, so without this a routine save from Settings → Certificates wiped
        // any other kind of certificate the institute had configured (SUB_ORG_AFFILIATION —
        // the partner Certificate of Affiliation — is stored as a sibling entry here).
        Set<String> requested = certificateSettingRequest.getRequest().keySet();
        existingByKey.forEach((key, existing) -> {
            if (key != null && !requested.contains(key) && existing != null) {
                certificateSetting.add(existing);
            }
        });

        CertificateSettingDataDto dataDto = new CertificateSettingDataDto();
        dataDto.setData(certificateSetting);
        return dataDto;
    }

    /**
     * The shipped defaults keyed by certificate type, used as the merge base for
     * an institute that has never saved certificate settings. Anything the admin
     * did not send falls back to the default rather than to null.
     */
    private Map<String, CertificateSettingDto> extractDefaultsByKey(CertificateSettingRequest defaults) {
        Map<String, CertificateSettingDto> out = new HashMap<>();
        if (defaults == null || defaults.getRequest() == null) return out;
        defaults.getRequest().forEach((k, v) -> {
            if (v != null) out.put(k, v);
        });
        return out;
    }

    /**
     * Pull the existing CertificateSettingDto records out of the saved JSON
     * so a follow-up save can preserve fields the new request didn't include.
     * Tolerates malformed or missing data — returns an empty map on any error.
     */
    private Map<String, CertificateSettingDto> extractExistingByKey(SettingDto existingSetting) {
        Map<String, CertificateSettingDto> out = new HashMap<>();
        if (existingSetting == null || existingSetting.getData() == null) return out;
        try {
            ObjectMapper mapper = new ObjectMapper();
            String json = mapper.writeValueAsString(existingSetting.getData());
            CertificateSettingDataDto data = mapper.readValue(json, CertificateSettingDataDto.class);
            if (data.getData() != null) {
                for (CertificateSettingDto d : data.getData()) {
                    if (d != null && d.getKey() != null) out.put(d.getKey(), d);
                }
            }
        } catch (Exception ignored) {
            // best-effort; if the existing JSON is unparseable just skip the merge
        }
        return out;
    }

    private String handleCaseWhereNoSettingPresent(Institute institute, Object settingRequest) {
        try{
            ObjectMapper objectMapper = new ObjectMapper();
            CertificateSettingRequest certificateSettingRequest = (CertificateSettingRequest) settingRequest;
            if(certificateSettingRequest==null) throw new VacademyException("Invalid Request");

            CertificateSettingDataDto data = createCertificateSettingFromRequest(certificateSettingRequest);


            InstituteSettingDto instituteSettingDto = new InstituteSettingDto();
            instituteSettingDto.setInstituteId(institute.getId());

            Map<String, SettingDto> settingMap = new HashMap<>();
            SettingDto settingDto = new SettingDto();
            settingDto.setKey(SettingKeyEnums.CERTIFICATE_SETTING.name());
            settingDto.setName("Certificate Setting");
            settingDto.setData(data);

            settingMap.put(SettingKeyEnums.CERTIFICATE_SETTING.name(), settingDto);

            instituteSettingDto.setSetting(settingMap);

            return objectMapper.writeValueAsString(instituteSettingDto);
        } catch (Exception e) {
            throw new VacademyException("Error Creating Setting: " +e.getMessage());
        }
    }

    @Override
    public String rebuildInstituteSetting(Institute institute, Object settingRequest, String key) {
        setKey(SettingKeyEnums.CERTIFICATE_SETTING.name());
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            CertificateSettingRequest certificateSettingRequest = (CertificateSettingRequest) settingRequest;

            // An institute with no settings blob at all still has to be able to
            // configure certificates. Parsing null/empty here used to throw and
            // surface as "Error rebuilding setting", so those admins could never
            // turn certificates on.
            InstituteSettingDto instituteSettingDto;
            if (!StringUtils.hasText(institute.getSetting())) {
                instituteSettingDto = new InstituteSettingDto();
                instituteSettingDto.setInstituteId(institute.getId());
                instituteSettingDto.setSetting(new HashMap<>());
            } else {
                instituteSettingDto = objectMapper.readValue(
                        institute.getSetting(), InstituteSettingDto.class);
            }

            Map<String, SettingDto> settingMap = instituteSettingDto.getSetting();
            if (settingMap == null) {
                settingMap = new HashMap<>();
                instituteSettingDto.setSetting(settingMap);
            }

            CertificateSettingDataDto newData = null;

            if (!settingMap.containsKey(key)) {
                // Seed from the defaults, then apply what the admin actually
                // sent. The previous code discarded certificateSettingRequest
                // entirely here and persisted the defaults — so the very first
                // save of certificate settings silently wrote
                // isDefaultCertificateSettingOn=false while returning 200, and
                // the toggle sprang back to off on reload.
                Map<String, CertificateSettingDto> defaultsByKey =
                        extractDefaultsByKey(createDefaultCertificateSetting());
                newData = createCertificateSettingFromRequest(certificateSettingRequest, defaultsByKey);
                SettingDto settingDto = new SettingDto();
                settingDto.setKey(SettingKeyEnums.CERTIFICATE_SETTING.name());
                settingDto.setName("Certificate Setting");
                settingDto.setData(newData);

                // Replace and return updated JSON
                settingMap.put(key, settingDto);
                instituteSettingDto.setSetting(settingMap);
            }
            else{
                // Merge with the previously persisted CertificateSettingDto
                // values so a save from one editor (Visual or HTML) doesn't
                // wipe the other editor's data — both must coexist.
                SettingDto settingDto = settingMap.get(key);
                Map<String, CertificateSettingDto> existingByKey = extractExistingByKey(settingDto);
                newData = createCertificateSettingFromRequest(certificateSettingRequest, existingByKey);
                settingDto.setData(newData);

                // Replace and return updated JSON
                settingMap.put(key, settingDto);
                instituteSettingDto.setSetting(settingMap);
            }

            return objectMapper.writeValueAsString(instituteSettingDto);
        } catch (Exception e) {
            throw new VacademyException("Error rebuilding setting: " + e.getMessage());
        }
    }

    public CertificateSettingRequest createDefaultCertificateSetting(){
        CertificateSettingRequest request = new CertificateSettingRequest();
        CertificateSettingDto settingDto = new CertificateSettingDto();

        Map<String, String> placeHolderValueMapping = new HashMap<>();
        placeHolderValueMapping.put("6", "Official Signatory");
        placeHolderValueMapping.put("7", "");

        settingDto.setKey(CertificateTypeEnum.COURSE_COMPLETION.name());
        settingDto.setIsDefaultCertificateSettingOn(false);
        settingDto.setDefaultHtmlCertificateTemplate(ConstantsSettingDefaultValue.getDefaultHtmlForType(CertificateTypeEnum.COURSE_COMPLETION.name()));
        settingDto.setCurrentHtmlCertificateTemplate(ConstantsSettingDefaultValue.getDefaultHtmlForType(CertificateTypeEnum.COURSE_COMPLETION.name()));
        settingDto.setPlaceHoldersMapping(placeHolderValueMapping);

        Map<String, CertificateSettingDto> settingDtoMap = new HashMap<>();
        settingDtoMap.put(CertificateTypeEnum.COURSE_COMPLETION.name(), settingDto);
        request.setRequest(settingDtoMap);

        return request;
    }
}
