package vacademy.io.admin_core_service.features.institute.service.setting;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.styledxmlparser.jsoup.Jsoup;
import com.itextpdf.styledxmlparser.jsoup.nodes.Document;
import com.itextpdf.styledxmlparser.jsoup.nodes.Entities;
import com.itextpdf.styledxmlparser.jsoup.nodes.Element;
import com.itextpdf.styledxmlparser.jsoup.select.Elements;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.admin_core_service.features.institute.constants.ConstantsSettingDefaultValue;
import vacademy.io.admin_core_service.features.institute.dto.CertificationGenerationRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingDataDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.naming.NameSettingRequest;
import vacademy.io.admin_core_service.features.institute.enums.CertificateTypeEnum;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.certificate.dto.ResolvedCertificateConfig;
import vacademy.io.admin_core_service.features.institute.dto.settings.certificate.CertificateNumberingDto;
import vacademy.io.admin_core_service.features.certificate.entity.IssuedCertificate;
import vacademy.io.admin_core_service.features.certificate.repository.IssuedCertificateRepository;
import vacademy.io.admin_core_service.features.certificate.service.CertificateCodeService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateCustomFieldService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateTextFitService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateNumberService;
import vacademy.io.admin_core_service.features.certificate.service.CertificateSettingsResolver;
import vacademy.io.admin_core_service.features.certificate.service.CertificateVerificationService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.learner_operation.entity.LearnerOperation;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationEnum;
import vacademy.io.admin_core_service.features.learner_operation.enums.LearnerOperationSourceEnum;
import vacademy.io.admin_core_service.features.learner_operation.repository.LearnerOperationRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.dto.InMemoryMultipartFile;
import vacademy.io.common.media.service.FileService;

import java.io.ByteArrayOutputStream;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@Service
public class InstituteSettingService {

    private final SettingStrategyFactory settingStrategyFactory;
    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;
    private final MediaService mediaService;
    private final AuthService authService;
    private final InstituteCustomFiledService instituteCustomFiledService;
    private final IssuedCertificateRepository issuedCertificateRepository;
    private final CertificateSettingsResolver certificateSettingsResolver;
    private final CertificateNumberService certificateNumberService;
    private final CertificateCodeService certificateCodeService;
    private final CertificateVerificationService certificateVerificationService;
    private final CertificateCustomFieldService certificateCustomFieldService;
    private final CertificateTextFitService certificateTextFitService;
    private final LearnerOperationRepository learnerOperationRepository;
    private final InstituteSettingWriter instituteSettingWriter;

    // The default completion threshold now lives in
    // CertificateSettingsResolver.DEFAULT_THRESHOLD_PERCENT, alongside the rest
    // of the resolution logic.

    public InstituteSettingService(InstituteRepository instituteRepository, ObjectMapper objectMapper,
            FileService fileService, MediaService mediaService, AuthService authService,
            InstituteCustomFiledService instituteCustomFiledService, SettingStrategyFactory settingStrategyFactory,
            IssuedCertificateRepository issuedCertificateRepository,
            CertificateSettingsResolver certificateSettingsResolver,
            CertificateNumberService certificateNumberService,
            CertificateCodeService certificateCodeService,
            CertificateVerificationService certificateVerificationService,
            CertificateCustomFieldService certificateCustomFieldService,
            CertificateTextFitService certificateTextFitService,
            LearnerOperationRepository learnerOperationRepository,
            InstituteSettingWriter instituteSettingWriter) {
        this.instituteRepository = instituteRepository;
        this.objectMapper = objectMapper;
        this.mediaService = mediaService;
        this.authService = authService;
        this.instituteCustomFiledService = instituteCustomFiledService;
        this.settingStrategyFactory = settingStrategyFactory;
        this.issuedCertificateRepository = issuedCertificateRepository;
        this.certificateSettingsResolver = certificateSettingsResolver;
        this.certificateNumberService = certificateNumberService;
        this.certificateCodeService = certificateCodeService;
        this.certificateVerificationService = certificateVerificationService;
        this.certificateCustomFieldService = certificateCustomFieldService;
        this.certificateTextFitService = certificateTextFitService;
        this.learnerOperationRepository = learnerOperationRepository;
        this.instituteSettingWriter = instituteSettingWriter;
    }

    public void createNewNamingSetting(Institute institute, NameSettingRequest request) {
        String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.NAMING_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);
    }

    public void createNewCertificateSetting(Institute institute, CertificateSettingStrategy request) {
        String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.CERTIFICATE_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);
    }

    @Transactional
    public void updateCertificateSetting(Institute institute, CertificateSettingRequest request) {
        String settingJsonString = settingStrategyFactory.rebuildOldSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.CERTIFICATE_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);

        // Issued certificates are immutable: editing the template must NOT change
        // a certificate a learner has already been issued. We therefore do NOT
        // clear learners' cached certificate file ids here. Learners who already
        // have a certificate (automated_completion_certificate_file_id set) keep
        // it; only learners not yet issued (null file id) render against this
        // freshly-saved template the next time they cross the completion
        // threshold. See getCurrentCertificateTemplate (always returns the
        // current saved template) and the file-id guard in
        // InstituteCertificateManager.generateAutomatedCourseCompletionCertificate
        // (renders once, then serves the cached file thereafter).
    }

    public void createDefaultCertificateSetting(Institute institute) {
        CertificateSettingRequest request = new CertificateSettingRequest();
        CertificateSettingDto settingDto = new CertificateSettingDto();

        Map<String, String> placeHolderValueMapping = new HashMap<>();
        placeHolderValueMapping.put("6", "Official Signatory");
        placeHolderValueMapping.put("7", "");

        settingDto.setKey(CertificateTypeEnum.COURSE_COMPLETION.name());
        settingDto.setIsDefaultCertificateSettingOn(false);
        settingDto.setDefaultHtmlCertificateTemplate(
                ConstantsSettingDefaultValue.getDefaultHtmlForType(CertificateTypeEnum.COURSE_COMPLETION.name()));
        settingDto.setCurrentHtmlCertificateTemplate(
                ConstantsSettingDefaultValue.getDefaultHtmlForType(CertificateTypeEnum.COURSE_COMPLETION.name()));
        settingDto.setPlaceHoldersMapping(placeHolderValueMapping);

        Map<String, CertificateSettingDto> settingDtoMap = new HashMap<>();
        settingDtoMap.put(CertificateTypeEnum.COURSE_COMPLETION.name(), settingDto);
        request.setRequest(settingDtoMap);

        String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.CERTIFICATE_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);
    }

    public void createDefaultSettingsForInstitute(Institute institute) {
        try {
            createDefaultNamingSetting(institute, ConstantsSettingDefaultValue.getDefaultNamingSettingRequest());
        } catch (Exception e) {
            log.error("Error Occurred in Creating Default Setting: " + e.getMessage());
        }

        try {
            createDefaultCertificateSetting(institute);
        } catch (Exception e) {
            log.error("Error Occurred in Creating Default Certificate Setting: " + e.getMessage());
        }

        try {
            createDefaultCustomFieldSetting(institute);
        } catch (Exception e) {
            log.error("Error Occurred in Creating Default Custom Field Setting: " + e.getMessage());
        }

        try {
            createDefaultInvoiceSetting(institute);
        } catch (Exception e) {
            log.error("Error creating default invoice setting: " + e.getMessage());
        }

        try {
            createDefaultOnboardingSetting(institute);
        } catch (Exception e) {
            log.error("Error creating default onboarding setting: " + e.getMessage());
        }
        // Doubt notification templates: a single global default row lives at institute_id =
        // 'DEFAULT' (see V215). New institutes fall back to it automatically via
        // DoubtNotificationService.resolveTemplateId — no per-institute seeding needed.
    }

    /**
     * Adds INVOICE_SETTING key-value to institute settings if not already present.
     * Default: sendInvoiceEmail=false, plus tax/currency defaults. Does not
     * overwrite existing.
     */
    public void createDefaultInvoiceSetting(Institute institute) {
        if (getSpecificSetting(institute, "INVOICE_SETTING") != null) {
            return;
        }
        Map<String, Object> defaultData = new HashMap<>();
        defaultData.put("taxIncluded", false);
        defaultData.put("taxRate", 0.0);
        defaultData.put("taxLabel", "Tax");
        defaultData.put("currency", "INR");
        defaultData.put("sendInvoiceEmail", false);
        // Admin copy: when sendAdminCopy is true, the admins in adminCopyUserIds also
        // receive the invoice / payment-confirmation emails (see InvoiceAdminCopyRecipientResolver).
        defaultData.put("sendAdminCopy", false);
        defaultData.put("adminCopyUserIds", new ArrayList<>());
        // Country + tax components: the operating country, the institute's own tax
        // registration number (e.g. GSTIN/VAT no.) and a list of named tax components
        // (label + rate). These are injectable into invoice templates via the
        // {{country}}, {{tax_registration_number}} and {{tax_components}} placeholders.
        Map<String, Object> country = new HashMap<>();
        country.put("code", "");
        country.put("name", "");
        country.put("taxRegistrationNumber", "");
        // HSN/SAC code (SAC for services such as courses). Injectable via {{hsn_code}}.
        country.put("hsnSacCode", "");
        country.put("taxComponents", new ArrayList<>());
        defaultData.put("country", country);
        // Invoice number strategy. These defaults reproduce the old hardcoded
        // INV-yyyyMMdd-0001 exactly, so numbering only changes when an admin edits it in
        // Settings > Invoice Settings > Numbering. See InvoiceNumberConfig.legacyDefault().
        Map<String, Object> numbering = new HashMap<>();
        numbering.put("format", "INV-{{YYYYMMDD}}-{{seq}}");
        numbering.put("seqPadding", 4);
        numbering.put("seqScope", "DAILY");
        numbering.put("instituteCode", "");
        // First month of the financial year for {{FY}}/{{FYY}}/{{FQ}}: 4 = April (India, UK),
        // 7 = Australia, 1 = calendar year.
        numbering.put("fyStartMonth", 4);
        numbering.put("sanitizeTokens", true);
        // Floor for the sequence, for institutes continuing a series from another accounting
        // system. 0 = no floor; it can only push the next number forward, never backwards.
        numbering.put("startFrom", 0);
        defaultData.put("numbering", numbering);
        GenericSettingRequest request = GenericSettingRequest.builder()
                .settingName("Invoice Setting")
                .settingData(defaultData)
                .build();
        createNewGenericSetting(institute, "INVOICE_SETTING", request);
    }

    /**
     * Adds ONBOARDING_SETTING key-value to institute settings if not already present.
     * Default is disabled (enabled=false) -- with the setting off, none of the onboarding
     * feature's UI or auto-start behavior is active and the institute behaves exactly as
     * it did before the feature existed. Does not overwrite an existing value.
     */
    public void createDefaultOnboardingSetting(Institute institute) {
        if (getSpecificSetting(institute, "ONBOARDING_SETTING") != null) {
            return;
        }
        Map<String, Object> defaultData = new HashMap<>();
        defaultData.put("enabled", false);
        GenericSettingRequest request = GenericSettingRequest.builder()
                .settingName("Onboarding Setting")
                .settingData(defaultData)
                .build();
        createNewGenericSetting(institute, "ONBOARDING_SETTING", request);
    }

    @Transactional
    public void createDefaultCustomFieldSetting(Institute institute) {
        try {
            List<InstituteCustomField> defaultCustomFields = instituteCustomFiledService
                    .createDefaultCustomFieldsForInstitute(institute);

            CustomFieldSettingRequest request = new CustomFieldSettingRequest();

            List<CustomFieldDto> customFieldsAndGroups = createFieldsAndGroupsForInstitute(defaultCustomFields);

            request.setFixedCustomFields(customFieldsAndGroups.stream().map(CustomFieldDto::getCustomFieldId).toList());
            request.setAllCustomFields(customFieldsAndGroups.stream().map(CustomFieldDto::getCustomFieldId).toList());
            request.setCustomFieldLocations(ConstantsSettingDefaultValue.getDefaultCustomFieldLocations());
            request.setCustomFieldsAndGroups(customFieldsAndGroups);
            request.setFixedFieldRenameDtos(ConstantsSettingDefaultValue.getFixedColumnsRenameDto());
            request.setCustomGroup(new HashMap<>());

            List<String> compulsoryCustomFields = new ArrayList<>();
            List<String> customFieldsName = new ArrayList<>();

            customFieldsAndGroups.forEach(field -> {
                customFieldsName.add(field.getFieldName());
                compulsoryCustomFields.add(field.getCustomFieldId());
            });
            request.setCompulsoryCustomFields(compulsoryCustomFields);
            request.setCustomFieldsName(customFieldsName);

            String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, request,
                    SettingKeyEnums.CUSTOM_FIELD_SETTING.name());
            instituteSettingWriter.save(institute, settingJsonString);
        } catch (Exception e) {
            throw new VacademyException("Failed to create default setting: " + e.getMessage());
        }
    }

    private List<CustomFieldDto> createFieldsAndGroupsForInstitute(List<InstituteCustomField> defaultCustomFields) {
        List<CustomFieldDto> response = new ArrayList<>();
        AtomicReference<Integer> order = new AtomicReference<>(1);
        defaultCustomFields.forEach(instituteCustomField -> {
            Optional<CustomFields> customFields = instituteCustomFiledService
                    .getCustomFieldById(instituteCustomField.getCustomFieldId());

            customFields.ifPresent(fields -> response.add(CustomFieldDto.builder()
                    .instituteId(instituteCustomField.getInstituteId())
                    .id(instituteCustomField.getId())
                    .customFieldId(instituteCustomField.getCustomFieldId())
                    .fieldType(fields.getFieldType())
                    .fieldName(fields.getFieldName())
                    .locations(isCompulsory(fields.getFieldName())
                            ? ConstantsSettingDefaultValue.getDefaultCustomFieldLocations()
                            : new ArrayList<>())
                    .individualOrder(order.getAndSet(order.get() + 1))
                    .status("ACTIVE")
                    .canBeDeleted(false)
                    .canBeEdited(false)
                    .canBeRenamed(false).build()));
        });

        return response;
    }

    private boolean isCompulsory(String field) {
        return true;
    }

    public void updateCustomFieldSetting(Institute institute, CustomFieldSettingRequest request) {
        String settingJsonString = settingStrategyFactory.rebuildOldSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.CUSTOM_FIELD_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);
    }

    public void updateNamingSetting(Institute institute, NameSettingRequest request) {
        String settingJsonString = settingStrategyFactory.rebuildOldSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.NAMING_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);
    }

    public void createDefaultNamingSetting(Institute institute, NameSettingRequest request) {
        String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, request,
                SettingKeyEnums.NAMING_SETTING.name());
        instituteSettingWriter.save(institute, settingJsonString);
    }

    // Generic methods for any setting type
    public void createNewGenericSetting(Institute institute, String settingKey, Object settingData) {
        String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, settingData,
                settingKey);
        instituteSettingWriter.save(institute, settingJsonString);
    }

    public void updateGenericSetting(Institute institute, String settingKey, Object settingData) {
        String settingJsonString = settingStrategyFactory.rebuildOldSettingAndGetSettingJsonString(institute,
                settingData, settingKey);
        instituteSettingWriter.save(institute, settingJsonString);
    }

    // Upsert method - creates if doesn't exist, updates if exists
    public void saveGenericSetting(Institute institute, String settingKey, Object settingData) {
        String settingJsonString = settingStrategyFactory.buildNewSettingAndGetSettingJsonString(institute, settingData,
                settingKey);
        instituteSettingWriter.save(institute, settingJsonString);
    }

    // GET methods for retrieving settings
    public InstituteSettingDto getAllSettings(Institute institute) {
        String settingJsonString = institute.getSetting();
        if (Objects.isNull(settingJsonString)) {
            return InstituteSettingDto.builder()
                    .instituteId(institute.getId())
                    .setting(Map.of())
                    .build();
        }

        try {
            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readValue(settingJsonString, InstituteSettingDto.class);
        } catch (Exception e) {
            throw new VacademyException("Error parsing settings: " + e.getMessage());
        }
    }

    public SettingDto getSpecificSetting(Institute institute, String settingKey) {
        InstituteSettingDto allSettings = getAllSettings(institute);

        if (allSettings.getSetting() == null || !allSettings.getSetting().containsKey(settingKey)) {
            return null;
        }

        return allSettings.getSetting().get(settingKey);
    }

    public Object getSettingData(Institute institute, String settingKey) {
        SettingDto setting = getSpecificSetting(institute, settingKey);
        if (setting == null) {
            return null;
        }
        return setting.getData();
    }

    public String getSettingsAsRawJson(Institute institute) {
        return institute.getSetting();
    }

    public Optional<FileDetailsDTO> ifEligibleForCourseCertificationForUserAndPackageSession(String learnerId,
            String packageSessionId, String instituteId,
            Optional<StudentSessionInstituteGroupMapping> instituteStudentMapping,
            CertificationGenerationRequest request) {
        if (instituteStudentMapping.isEmpty())
            return Optional.empty();
        if (instituteStudentMapping.get().getInstitute() == null)
            return Optional.empty();

        StudentSessionInstituteGroupMapping mapping = instituteStudentMapping.get();
        String setting = mapping.getInstitute().getSetting();
        if (!StringUtils.hasText(setting))
            return Optional.empty();

        // Resolve course override → institute default → disabled. All precedence
        // lives in CertificateSettingsResolver so the issuance gate, the admin
        // settings dialog and the learner config endpoint can never disagree.
        ResolvedCertificateConfig config = certificateSettingsResolver.resolve(
                mapping.getInstitute(), resolvePackageId(mapping), CertificateTypeEnum.COURSE_COMPLETION.name());

        // Opt-in feature gate. Without this an institute that switched certificates
        // off still issued them to every learner past the threshold, because the
        // only enable check lived in the learner client.
        if (!config.isEnabled()) {
            return Optional.empty();
        }

        // Threshold gate against server-side progress. The request still carries a
        // client-computed percentage, but it is only a fallback now: trusting it
        // meant anyone who could call the endpoint could claim 100.
        Integer completionPercentage = resolveCompletionPercentage(mapping, request);
        if (completionPercentage == null || completionPercentage < config.getThresholdPercent()) {
            return Optional.empty();
        }

        Map<String, String> placeHoldersValueMapping = config.getPlaceHolders() != null
                ? config.getPlaceHolders()
                : extractPlaceholders(setting);

        String template = StringUtils.hasText(config.getTemplateHtml())
                ? config.getTemplateHtml()
                : getCurrentCertificateTemplate(setting, CertificateTypeEnum.COURSE_COMPLETION.name()).orElse(null);
        if (!StringUtils.hasText(template)) {
            return Optional.empty();
        }

        return createCertificateUrlFromTemplateAndLearnerData(template, mapping,
                placeHoldersValueMapping, request, setting, config, completionPercentage);
    }

    /**
     * What the certificate QR should encode.
     *
     * <p>Defaults to the bare certificate number. An institute can instead
     * configure a verification URL template containing {@code {{CERTIFICATE_ID}}}
     * — e.g. {@code https://myschool.com/verify?c={{CERTIFICATE_ID}}} — and the
     * QR will encode that, so a scan lands on a page proving the certificate is
     * genuine.
     *
     * <p>Falls back to the platform verification page on the institute's own
     * learner portal, which is unauthenticated — a QR pointing at an
     * authenticated route would just show a scanner a login wall.
     */
    private String resolveCertificateCodePayload(Institute institute, String certificateId,
                                                 String verificationToken) {
        if (!StringUtils.hasText(certificateId)) {
            return null;
        }
        String settingJson = institute != null ? institute.getSetting() : null;
        String template = readCertificateSettingText(settingJson, "qrVerificationUrlTemplate");
        if (StringUtils.hasText(template)) {
            return template.trim().replace("{{CERTIFICATE_ID}}", certificateId);
        }

        // No institute-specific template configured: point the QR at the
        // platform verification page on the institute's own learner portal, so a
        // white-labelled school sends its graduates to its own domain.
        String platformVerifyUrl = certificateVerificationService
                .buildVerificationUrl(institute, certificateId, verificationToken);
        if (StringUtils.hasText(platformVerifyUrl)) {
            return platformVerifyUrl;
        }

        // Last resort — no portal configured, or a legacy certificate with no
        // token. Encoding the bare number at least identifies the certificate.
        //
        // Deliberately NOT changed to the compound `number*code` payload, even
        // though that would verify where the bare number cannot. Institutes in
        // this branch never opted into anything, and some scan the number into
        // their own systems; silently changing what their QR emits would break
        // that. The fix for these institutes is to configure a learner portal,
        // which puts them on the verifying branch above.
        return certificateId;
    }

    /**
     * What {@code {{CERTIFICATE_BARCODE}}} encodes, per the institute's
     * {@code barcodeContent} setting.
     *
     * <p>A barcode cannot hold the verification URL the QR carries — Code 128
     * spends ~11 modules per character, so the URL would need a barcode roughly
     * a quarter of an A4 landscape page wide before it scanned reliably. The
     * short code exists for exactly this: {@code <number>*<code>} is ~21
     * characters and fits.
     *
     * <p>Defaults to the bare number, which is what every certificate issued
     * before this setting existed encodes. Switching an institute to verifying
     * barcodes is opt-in because it makes the barcode noticeably wider, and an
     * unannounced width change would break templates whose barcode box was sized
     * by hand.
     */
    private String resolveCertificateBarcodePayload(String settingJson, String certificateId,
                                                    String shortCode) {
        if (!StringUtils.hasText(certificateId)) {
            return null;
        }
        String mode = readCertificateSettingText(settingJson, "barcodeContent");
        if (!"VERIFICATION_CODE".equalsIgnoreCase(mode)) {
            return certificateId;
        }
        // Legacy certificate with no short code: fall back to the number rather
        // than emitting a dangling separator that would resolve to nothing.
        return Optional
                .ofNullable(certificateVerificationService.buildBarcodePayload(certificateId, shortCode))
                .orElse(certificateId);
    }

    /**
     * Whether the platform may stamp this part of the badge. Absent, malformed
     * or unreadable all mean {@code true}: the historical behaviour, and the
     * safe direction — a certificate that carries its number and a scannable
     * code when it did not have to is a cosmetic surprise, while one silently
     * missing them cannot be verified at all.
     */
    static boolean isAutoStampEnabled(String settingJson, String fieldName) {
        try {
            if (!StringUtils.hasText(settingJson)) return true;
            // Its own mapper rather than the injected one: this is a read-only
            // parse of a settings blob, and being static is what lets the
            // decision be tested on its own — the switch it implements is the
            // difference between a code an admin removed staying removed and
            // reappearing on every certificate.
            JsonNode entries = new ObjectMapper().readTree(settingJson)
                    .path("setting").path("CERTIFICATE_SETTING").path("data").path("data");
            if (entries.isArray()) {
                for (JsonNode config : entries) {
                    if (CertificateTypeEnum.COURSE_COMPLETION.name().equals(config.path("key").asText(null))) {
                        JsonNode flag = config.path(fieldName);
                        return !flag.isBoolean() || flag.asBoolean();
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not read certificate setting '{}'; stamping as before", fieldName, e);
        }
        return true;
    }

    /**
     * One string field off the COURSE_COMPLETION certificate config. Every read
     * of this blob has the same three-deep path and the same "a malformed blob
     * must not break issuance" requirement, so it lives in one place.
     */
    private String readCertificateSettingText(String settingJson, String fieldName) {
        try {
            if (!StringUtils.hasText(settingJson)) return null;
            JsonNode entries = objectMapper.readTree(settingJson)
                    .path("setting").path("CERTIFICATE_SETTING").path("data").path("data");
            if (entries.isArray()) {
                for (JsonNode config : entries) {
                    if (CertificateTypeEnum.COURSE_COMPLETION.name().equals(config.path("key").asText(null))) {
                        return config.path(fieldName).asText(null);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Could not read certificate setting '{}'; using the default", fieldName, e);
        }
        return null;
    }

    /** Branding that the shipped default certificate template hardcoded until this fix. */
    private static final String LEGACY_HARDCODED_WEBSITE = "WWW.CODECIRCLE.ORG";

    /**
     * Normalise an institute's website for display in the certificate footer:
     * drop the scheme and any trailing slash, and uppercase it to match the
     * template's typography. Returns "" when unset, which collapses the footer
     * instead of printing a stray token.
     */
    static String formatWebsiteForDisplay(String websiteUrl) {
        if (!StringUtils.hasText(websiteUrl)) {
            return "";
        }
        String trimmed = websiteUrl.trim()
                .replaceFirst("(?i)^https?://", "")
                .replaceFirst("/+$", "");
        return trimmed.toUpperCase();
    }

    /**
     * Strip the legacy hardcoded domain from a saved template.
     *
     * <p>No website is shown by default. The whole footer element is removed
     * rather than blanked, so the certificate doesn't render a stray rule or gap
     * where another company's name used to be. An institute that wants its own
     * website back can place {@code {{INSTITUTE_WEBSITE}}} in the template
     * editor, which still substitutes.
     */
    static String scrubHardcodedDefaultBranding(String html) {
        if (html == null || !html.toUpperCase().contains(LEGACY_HARDCODED_WEBSITE)) {
            return html;
        }
        // Drop the containing footer-link block, falling back to blanking just
        // the text if the markup doesn't match.
        String withoutBlock = html.replaceAll(
                "(?is)<div class=\"footer-link\">.*?</div>", "");
        if (!withoutBlock.toUpperCase().contains(LEGACY_HARDCODED_WEBSITE)) {
            return withoutBlock;
        }
        return html.replaceAll("(?i)" + java.util.regex.Pattern.quote(LEGACY_HARDCODED_WEBSITE), "");
    }

    /**
     * The certificate already issued to this learner for this batch, if any.
     *
     * <p>A re-render reuses both its number and its original issuance date. The
     * number matters so regenerating doesn't mint duplicates; the date matters
     * because the audit row is keyed on the number, so {@code save()} updates it
     * in place — stamping {@code new Date()} would silently rewrite when the
     * learner earned the certificate.
     *
     * <p>Best-effort: on any failure we allocate a fresh number rather than
     * blocking the certificate.
     */
    private Optional<IssuedCertificate> resolveExistingCertificate(StudentSessionInstituteGroupMapping mapping,
                                                                   String certificateType) {
        try {
            String packageSessionId = mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null;
            if (!StringUtils.hasText(packageSessionId)) {
                return Optional.empty();
            }
            // Course-completion rows predate the type column, so they are matched with the
            // untyped finder (null or COURSE_COMPLETION both mean "the course certificate").
            // Every other type is matched strictly by type.
            Optional<IssuedCertificate> existing =
                    CertificateTypeEnum.COURSE_COMPLETION.name().equals(certificateType)
                            ? issuedCertificateRepository
                                    .findFirstByUserIdAndPackageSessionIdOrderByIssuedAtDesc(
                                            mapping.getUserId(), packageSessionId)
                                    .filter(c -> c.getCertificateType() == null
                                            || CertificateTypeEnum.COURSE_COMPLETION.name()
                                                    .equals(c.getCertificateType()))
                            : issuedCertificateRepository
                                    .findFirstByUserIdAndPackageSessionIdAndCertificateTypeOrderByIssuedAtDesc(
                                            mapping.getUserId(), packageSessionId, certificateType);
            return existing.filter(c -> StringUtils.hasText(c.getCertificateId()));
        } catch (Exception e) {
            log.warn("Could not look up the existing certificate for user {}; allocating a new number",
                    mapping != null ? mapping.getUserId() : "?", e);
            return Optional.empty();
        }
    }

    /** The owning course id, used to look up the per-course certificate override. */
    private String resolvePackageId(StudentSessionInstituteGroupMapping mapping) {
        return Optional.ofNullable(mapping.getPackageSession())
                .map(ps -> ps.getPackageEntity())
                .map(PackageEntity::getId)
                .orElse(null);
    }

    /**
     * Authoritative completion percentage for this learner in this batch, read
     * from the same {@code learner_operation} rollup the course dashboard reports.
     * Falls back to the client-supplied value only when no rollup row exists yet.
     */
    private Integer resolveCompletionPercentage(StudentSessionInstituteGroupMapping mapping,
                                                CertificationGenerationRequest request) {
        String packageSessionId = mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null;
        if (StringUtils.hasText(packageSessionId)) {
            try {
                Optional<LearnerOperation> row = learnerOperationRepository
                        .findByUserIdAndSourceAndSourceIdAndOperation(
                                mapping.getUserId(),
                                LearnerOperationSourceEnum.PACKAGE_SESSION.name(),
                                packageSessionId,
                                LearnerOperationEnum.PERCENTAGE_PACKAGE_SESSION_COMPLETED.name());
                if (row.isPresent() && StringUtils.hasText(row.get().getValue())) {
                    return (int) Math.floor(Double.parseDouble(row.get().getValue().trim()));
                }
            } catch (Exception e) {
                log.warn("Could not read server-side completion for user {} in {}; falling back to request value",
                        mapping.getUserId(), packageSessionId, e);
            }
        }
        return request != null ? request.getCompletionPercentage() : null;
    }

    /**
     * Builds a human-readable certificate id of the form
     * {@code XX-NNNN-YYYY} where {@code XX} is the first two alphanumeric
     * letters of the institute name, {@code NNNN} is a 4-digit random number,
     * and {@code YYYY} is the current year. Retries on collision using the
     * audit table as the uniqueness oracle.
     */
    /**
     * Self-heal: ensure an {@link IssuedCertificate} audit row exists for a
     * (user, packageSession) pair whose certificate has already been generated
     * and cached on the {@code StudentSessionInstituteGroupMapping}. Older
     * issuances pre-date the audit table, so they have a {@code file_id} on
     * the mapping but no row here. The manager calls this on the cached path
     * to backfill those rows the first time the cert URL is fetched after
     * deploy. Fresh issuances continue to insert via the normal render path.
     *
     * <p>Backfilled rows have {@code template_html_snapshot = null} and
     * {@code completion_percentage = null} because that data is irrecoverable.
     * Best-effort: failures are logged and swallowed — never block delivery.
     */
    public void backfillIssuedCertificateIfMissing(StudentSessionInstituteGroupMapping mapping,
                                                   String fileId, String courseName) {
        try {
            if (mapping == null || !StringUtils.hasText(fileId)) return;
            String packageSessionId = mapping.getPackageSession() != null
                    ? mapping.getPackageSession().getId() : null;
            if (packageSessionId == null) return;
            if (issuedCertificateRepository
                    .findFirstByUserIdAndPackageSessionIdOrderByIssuedAtDesc(
                            mapping.getUserId(), packageSessionId).isPresent()) {
                return; // already have an audit row
            }
            // Resolve the institute's numbering config rather than passing null.
            // Null means "shipped defaults", which draws from the per-year
            // counter — but an institute that turned the yearly restart off is
            // counting in a different one, so a backfill could hand out a number
            // that series has already issued. It also means backfilled rows now
            // carry the institute's own format instead of the default shape.
            CertificateNumberingDto backfillNumbering = null;
            try {
                ResolvedCertificateConfig backfillConfig = certificateSettingsResolver.resolve(
                        mapping.getInstitute(), null, CertificateTypeEnum.COURSE_COMPLETION.name());
                backfillNumbering = backfillConfig != null ? backfillConfig.getNumbering() : null;
            } catch (Exception e) {
                log.warn("Could not read numbering settings while backfilling a certificate for user {}; "
                        + "using defaults", mapping.getUserId(), e);
            }
            // Generate once and write to *both* `id` (PK) and `certificate_id`
            // (self-documenting column) so the two stay 1:1.
            String backfilledCertId = certificateNumberService.generate(
                    mapping.getInstitute(), backfillNumbering, null);
            IssuedCertificate audit = IssuedCertificate.builder()
                    .id(backfilledCertId)
                    .certificateId(backfilledCertId)
                    .instituteId(mapping.getInstitute() != null ? mapping.getInstitute().getId() : null)
                    .userId(mapping.getUserId())
                    .packageSessionId(packageSessionId)
                    .courseName(courseName)
                    .completionPercentage(null)
                    .issuedAt(new Date())
                    .fileId(fileId)
                    .templateHtmlSnapshot(null)
                    .build();
            issuedCertificateRepository.save(audit);
            log.info("Backfilled IssuedCertificate row for user {} session {}",
                    mapping.getUserId(), packageSessionId);
        } catch (Exception e) {
            log.error("Failed to backfill IssuedCertificate for user {}: {}",
                    mapping != null ? mapping.getUserId() : "?", e.getMessage());
        }
    }


    /**
     * Appends a fixed bottom-right badge displaying the certificate id to the
     * rendered HTML. Uses {@code position: fixed} so OpenHTML2PDF repeats it on
     * every page if the certificate spans multiple pages.
     */
    /**
     * Which code the institute wants stamped on the badge: {@code QR} (default)
     * or {@code BARCODE}. Unreadable settings fall back to QR rather than
     * dropping the code.
     */
    private String resolveBadgeCodeType(String settingJson) {
        String type = readCertificateSettingText(settingJson, "badgeCodeType");
        return StringUtils.hasText(type) ? type : "QR";
    }

    /**
     * Blanks any {@code {{TOKEN}}} still standing after every substitution pass.
     *
     * <p>Nothing upstream guarantees a template only uses tokens the renderer
     * knows. An admin can drop a field the platform has no value for, delete a
     * custom field definition a saved template still references, or paste HTML
     * from elsewhere — and until this ran, the literal text {@code {{GRADE}}}
     * printed on the learner's certificate. A blank is always the better
     * failure: the certificate looks slightly sparse instead of visibly broken.
     *
     * <p>Matches only {@code [A-Za-z0-9_]} with optional inner whitespace, the
     * exact shape this pipeline emits. Anything else inside braces is left
     * alone, so hand-written CSS or script in an HTML-editor template is never
     * touched.
     */
    static String scrubUnresolvedTokens(String html) {
        if (!StringUtils.hasText(html)) {
            return html;
        }
        try {
            return html.replaceAll("\\{\\{\\s*[A-Za-z0-9_]+\\s*\\}\\}", "");
        } catch (Exception e) {
            // Leaving a raw token is bad; failing the render is worse.
            log.warn("Could not scrub unresolved certificate tokens", e);
            return html;
        }
    }

    /**
     * Whether a template positions {@code token} itself, matched the same
     * tolerant way the substitution pass does — whitespace padding and case
     * variations included, so `{{ certificate_id }}` counts as placed.
     */
    private boolean templateContainsToken(String template, String token) {
        if (!StringUtils.hasText(template)) return false;
        String inner = token.substring(2, token.length() - 2);
        try {
            return java.util.regex.Pattern
                    .compile("\\{\\{\\s*" + java.util.regex.Pattern.quote(inner) + "\\s*\\}\\}",
                            java.util.regex.Pattern.CASE_INSENSITIVE)
                    .matcher(template)
                    .find();
        } catch (Exception e) {
            // Regex trouble must not silently turn into "not placed" — that
            // would stamp a duplicate. Fall back to the literal check.
            return template.contains(token);
        }
    }

    /**
     * Stamp the certificate number bottom-right, with a scannable code beside it.
     *
     * <p>This is the fallback for whatever the template does not place itself,
     * so a certificate is never issued without a machine-readable form of its
     * number — verifying one by hand means typing the number off the paper.
     *
     * <p>Either part may be blank: a blank {@code certificateId} means the
     * design already positions the number, and a blank {@code codeDataUri}
     * means either the design positions a code or generation failed. Blank on
     * both sides means there is nothing left to stamp and the html is returned
     * untouched.
     */
    private String appendCertificateIdBadge(String html, String certificateId, String codeDataUri,
                                            boolean isBarcode, boolean barcodeVerifies) {
        // Nothing left to stamp: the template positions both the number and a
        // code itself, so the automatic badge would only duplicate them.
        if (!StringUtils.hasText(certificateId) && !StringUtils.hasText(codeDataUri)) {
            return html;
        }
        // A 1D barcode needs a wide, short box; a QR needs a square one. Sizing
        // both the same squashes the barcode until it stops scanning.
        //
        // A verifying barcode carries roughly twice the payload (the number plus
        // a 10-character code), so it needs roughly twice the width. Stamping it
        // at the number-only size prints bars too thin to scan — a verification
        // code nobody can read is worse than no code at all.
        String barcodeStyle = barcodeVerifies
                ? "width:60mm;height:14mm;display:block;"
                : "width:34mm;height:11mm;display:block;";
        String codeStyle = isBarcode ? barcodeStyle : "width:16mm;height:16mm;display:block;";
        String codeImg = StringUtils.hasText(codeDataUri)
                ? "<img src=\"" + codeDataUri + "\" alt=\"\" style=\"" + codeStyle + "\" />"
                : "";
        String idSpan = StringUtils.hasText(certificateId)
                ? "<span style=\"display:block;margin-top:3px;\">" + certificateId + "</span>"
                : "";
        // Plain: the code, the number under it, nothing else. It used to be
        // drawn as a bordered, translucent-white chip, which read as a sticker
        // applied to the certificate rather than part of it — and on a design
        // with its own artwork behind, a grey box is exactly what you notice
        // first. The QR carries its own white quiet zone (CertificateCodeService),
        // so it stays scannable without a panel drawn behind it.
        String badge = "<div style=\"position:fixed;bottom:8mm;right:10mm;"
                + "font-family:Arial,sans-serif;font-size:8px;color:#6b7280;"
                + "letter-spacing:0.4px;text-align:center;\">"
                + codeImg
                + idSpan
                + "</div>";
        int closing = html.lastIndexOf("</body>");
        if (closing >= 0) {
            return html.substring(0, closing) + badge + html.substring(closing);
        }
        // No body tag (partial HTML) — just append; convertHtmlToPdf will wrap it.
        return html + badge;
    }

    // isCertificateIssuanceEnabled() and getAutoIssuePercentage() used to live
    // here. Both moved into CertificateSettingsResolver so enablement and the
    // threshold resolve in exactly one place (course override -> institute ->
    // disabled). They are deliberately not left behind as unused helpers: a
    // dead gate that still looks live is what caused certificates to keep
    // issuing after the switch was turned off.

    /**
     * Reads aspect_ratio (and optional custom dimensions) from certificate
     * settings. Returns null when absent so the renderer applies its historical
     * A4 landscape default.
     */
    private float[] getPageSizeMm(String settingJson, String key) {
        try {
            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode certificateSettings = root.path("setting").path("CERTIFICATE_SETTING").path("data").path("data");
            if (certificateSettings.isArray()) {
                for (JsonNode certificateConfig : certificateSettings) {
                    if (key.equals(certificateConfig.path("key").asText(null))) {
                        String aspect = certificateConfig.path("aspectRatio").asText(null);
                        if (aspect == null) return null;
                        switch (aspect) {
                            case "A4_PORTRAIT":  return new float[]{210f, 297f};
                            case "A3_LANDSCAPE": return new float[]{420f, 297f};
                            case "A3_PORTRAIT":  return new float[]{297f, 420f};
                            case "CUSTOM":
                                int w = certificateConfig.path("customWidthMm").asInt(297);
                                int h = certificateConfig.path("customHeightMm").asInt(210);
                                return new float[]{w, h};
                            case "A4_LANDSCAPE":
                            default:             return new float[]{297f, 210f};
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // fall through
        }
        return null;
    }

    private Optional<FileDetailsDTO> createCertificateUrlFromTemplateAndLearnerData(
            String template,
            StudentSessionInstituteGroupMapping studentSessionInstituteGroupMapping,
            Map<String, String> placeHoldersValueMapping, CertificationGenerationRequest request,
            String settingJson, ResolvedCertificateConfig config, Integer completionPercentage) {
        return createCertificateUrlFromTemplateAndLearnerData(template, studentSessionInstituteGroupMapping,
                placeHoldersValueMapping, request, settingJson, config, completionPercentage,
                CertificateTypeEnum.COURSE_COMPLETION.name(), null);
    }

    /**
     * Render + issue a certificate of any type for a learner/batch mapping, for callers that have
     * ALREADY decided the learner is entitled to it. The course-completion path gates on progress
     * before calling this; the partner-affiliation path gates on the plan being active.
     *
     * @param certificateType        which CERTIFICATE_SETTING entry the page size comes from, which
     *                               existing certificate a re-render reuses, and what the audit row
     *                               records
     * @param extraNamedPlaceholders tokens the caller resolves itself (e.g. {@code {{ORG_NAME}}});
     *                               merged after the built-ins, so a caller cannot accidentally
     *                               shadow {@code {{CERTIFICATE_ID}}} — that one is always the
     *                               allocated number
     */
    public Optional<FileDetailsDTO> issueCertificateForMapping(
            String template,
            StudentSessionInstituteGroupMapping mapping,
            CertificationGenerationRequest request,
            ResolvedCertificateConfig config,
            String certificateType,
            Map<String, String> extraNamedPlaceholders) {
        String settingJson = mapping.getInstitute() != null ? mapping.getInstitute().getSetting() : null;
        Map<String, String> placeHoldersValueMapping = config != null && config.getPlaceHolders() != null
                ? config.getPlaceHolders()
                : (StringUtils.hasText(settingJson) ? extractPlaceholders(settingJson) : new HashMap<>());
        return createCertificateUrlFromTemplateAndLearnerData(template, mapping, placeHoldersValueMapping,
                request, settingJson, config, null, certificateType, extraNamedPlaceholders);
    }

    private Optional<FileDetailsDTO> createCertificateUrlFromTemplateAndLearnerData(
            String template,
            StudentSessionInstituteGroupMapping studentSessionInstituteGroupMapping,
            Map<String, String> placeHoldersValueMapping, CertificationGenerationRequest request,
            String settingJson, ResolvedCertificateConfig config, Integer completionPercentage,
            String certificateType, Map<String, String> extraNamedPlaceholders) {
        final String type = StringUtils.hasText(certificateType)
                ? certificateType : CertificateTypeEnum.COURSE_COMPLETION.name();

        // Your mapping (placeholder key -> actual value)
        Map<String, String> placeHolderMapping = new HashMap<>();
        String studentId = studentSessionInstituteGroupMapping.getUserId();
        // Pull the full user record once — we need fullName for {{STUDENT_NAME}}
        // *and* email/mobile for the contact-detail tokens. Guarded so a missing
        // user (deleted account, auth service hiccup) downgrades to empty
        // strings rather than NPE-ing through the rest of the render.
        UserDTO learner = null;
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(studentId));
            if (users != null && !users.isEmpty()) {
                learner = users.get(0);
            }
        } catch (Exception ignored) {
            // fall through with learner = null
        }
        String learnerName = learner != null ? learner.getFullName() : "";
        String learnerEmail = learner != null ? learner.getEmail() : "";
        String learnerMobile = learner != null ? learner.getMobileNumber() : "";
        String enrollmentNumber =
                Optional.ofNullable(studentSessionInstituteGroupMapping.getInstituteEnrolledNumber())
                        .orElse("");

        String instituteImageUrl = mediaService
                .getFileUrlById(studentSessionInstituteGroupMapping.getInstitute().getLogoFileId());

        // Resolve a course/package display name. Prefer the value the frontend
        // forwarded (already localized); fall back to package metadata.
        String courseName = request != null && StringUtils.hasText(request.getCourseName())
                ? request.getCourseName()
                : Optional.ofNullable(studentSessionInstituteGroupMapping.getPackageSession())
                        .map(ps -> ps.getPackageEntity())
                        .map(PackageEntity::getPackageName)
                        .orElse("");

        // Certificate number, resolved up front so the same value is embedded in
        // the HTML and persisted to the audit table.
        //
        // A re-render REUSES the learner's existing number rather than minting a
        // new one. Without this, every regenerate — the learner's Refresh button,
        // or the admin action — produced a fresh number, a fresh audit row and a
        // fresh email; one learner ended up with three certificates carrying three
        // different ids. Reusing the number also means the audit `save` below
        // updates that row (the number is the PK) instead of inserting a duplicate.
        Optional<IssuedCertificate> alreadyIssued =
                resolveExistingCertificate(studentSessionInstituteGroupMapping, type);
        String certificateId = alreadyIssued
                .map(IssuedCertificate::getCertificateId)
                .orElseGet(() -> certificateNumberService.generate(
                        studentSessionInstituteGroupMapping.getInstitute(),
                        config != null ? config.getNumbering() : null,
                        config != null ? config.getCourseCode() : null));
        // Keep the original issuance date on a re-render — see resolveExistingCertificate.
        final Date originalIssuedAt = alreadyIssued.map(IssuedCertificate::getIssuedAt).orElse(null);

        // Verification token: reused on a re-render so a certificate already in
        // circulation keeps working, minted fresh otherwise. Rotating it would
        // silently break every QR already printed or emailed.
        final String verificationToken = alreadyIssued
                .map(IssuedCertificate::getVerificationToken)
                .filter(StringUtils::hasText)
                .orElseGet(certificateVerificationService::newVerificationToken);

        // The barcode's credential, reused on a re-render for the same reason.
        // Minted even for certificates whose institute currently prints a bare
        // number: the setting can be switched on later, and a re-render is not
        // guaranteed to happen, so an unused short code costs nothing while a
        // missing one would leave the barcode permanently unverifiable.
        final String shortCode = alreadyIssued
                .map(IssuedCertificate::getShortCode)
                .filter(StringUtils::hasText)
                .orElseGet(certificateVerificationService::newShortCode);

        placeHolderMapping.put("1",
                studentSessionInstituteGroupMapping.getPackageSession().getSession().getSessionName());
        placeHolderMapping.put("2", studentSessionInstituteGroupMapping.getPackageSession().getLevel().getLevelName());
        placeHolderMapping.put("3", learnerName);
        placeHolderMapping.put("4", DateUtil.convertDateToString(request.getCompletionDate()));
        placeHolderMapping.put("5", instituteImageUrl);
        placeHolderMapping.put("6", placeHoldersValueMapping.get("6"));
        placeHolderMapping.put("7", placeHoldersValueMapping.get("7"));
        placeHolderMapping.put("8", studentSessionInstituteGroupMapping.getInstitute().getInstituteName());
        placeHolderMapping.put("9", DateUtil.convertDateToString(new Date()));

        // Your default placeholders
        Map<String, String> defaultPlaceHolders = ConstantsSettingDefaultValue.getDefaultPlaceHolders();

        String filledTemplate = template;

        // Named placeholders introduced by the new certificate UX. These run
        // FIRST so the correct values land before the legacy numeric pass —
        // the legacy map has a historical bug where it points "1" at
        // {{COURSE_NAME}} but stores the session name there, which mangles
        // {{COURSE_NAME}} into the session name on every render. Running the
        // named pass first claims the correct tokens; the legacy pass only
        // fills in tokens the named pass didn't already consume.
        Map<String, String> namedPlaceholders = new HashMap<>();
        namedPlaceholders.put("{{CERTIFICATE_ID}}", certificateId);
        namedPlaceholders.put("{{COURSE_NAME}}", courseName);
        namedPlaceholders.put("{{PACKAGE_NAME}}", courseName);
        namedPlaceholders.put("{{PACKAGE_LEVEL}}",
                Optional.ofNullable(studentSessionInstituteGroupMapping.getPackageSession())
                        .map(ps -> ps.getLevel())
                        .map(l -> l.getLevelName()).orElse(""));
        namedPlaceholders.put("{{SESSION_NAME}}",
                Optional.ofNullable(studentSessionInstituteGroupMapping.getPackageSession())
                        .map(ps -> ps.getSession())
                        .map(s -> s.getSessionName()).orElse(""));
        namedPlaceholders.put("{{INSTITUTE_NAME}}",
                studentSessionInstituteGroupMapping.getInstitute().getInstituteName());
        // The institute's own website, shown in the certificate footer. The
        // shipped default template used to hardcode one customer's domain
        // (WWW.CODECIRCLE.ORG), so every institute issued certificates footed
        // with someone else's branding. Empty when unset, which collapses the
        // footer rather than printing a stray token.
        namedPlaceholders.put("{{INSTITUTE_WEBSITE}}",
                formatWebsiteForDisplay(studentSessionInstituteGroupMapping.getInstitute().getWebsiteUrl()));
        namedPlaceholders.put("{{STUDENT_NAME}}", learnerName);
        namedPlaceholders.put("{{COMPLETION_PERCENTAGE}}",
                request != null && request.getCompletionPercentage() != null
                        ? request.getCompletionPercentage().toString()
                        : "");
        // `date_of_completion` replaces the legacy `issue_date` field. Both
        // tokens substitute to the same value (the learner's completion date,
        // falling back to today) so saved templates from before the rename
        // continue to render the right value without re-saving.
        Date completionDate = request != null && request.getCompletionDate() != null
                ? request.getCompletionDate()
                : new Date();
        String completionDateStr = DateUtil.convertDateToString(completionDate);
        namedPlaceholders.put("{{DATE_OF_COMPLETION}}", completionDateStr);
        namedPlaceholders.put("{{ISSUE_DATE}}", completionDateStr);
        // Identity + contact tokens. These were exposed in the visual editor's
        // chip palette but had no backend substitution, so admins who placed
        // them saw raw {{TOKEN}} text on the issued PDF. Empty string is the
        // safe fallback when the value is missing.
        namedPlaceholders.put("{{USER_ID}}", Optional.ofNullable(studentId).orElse(""));
        namedPlaceholders.put("{{EMAIL}}", Optional.ofNullable(learnerEmail).orElse(""));
        namedPlaceholders.put("{{MOBILE_NUMBER}}", Optional.ofNullable(learnerMobile).orElse(""));
        namedPlaceholders.put("{{ENROLLMENT_NUMBER}}", enrollmentNumber);
        // Institute logo as a URL is already handled by the legacy numeric
        // pass via key "5", but place it in the named map too so any template
        // referencing {{INSTITUTE_LOGO}} renders correctly even when the
        // legacy pass is short-circuited.
        namedPlaceholders.put("{{INSTITUTE_LOGO}}",
                Optional.ofNullable(instituteImageUrl).orElse(""));
        // Scannable forms of the certificate number, embedded as PNG data URIs so
        // the renderer never has to fetch them. Both are img-src tokens: a
        // template uses them as <img src="{{CERTIFICATE_QR}}">.
        String codePayload = resolveCertificateCodePayload(
                studentSessionInstituteGroupMapping.getInstitute(), certificateId, verificationToken);
        namedPlaceholders.put("{{CERTIFICATE_QR}}",
                Optional.ofNullable(certificateCodeService.generateQrDataUri(codePayload)).orElse(""));
        String barcodePayload = resolveCertificateBarcodePayload(settingJson, certificateId, shortCode);
        namedPlaceholders.put("{{CERTIFICATE_BARCODE}}",
                Optional.ofNullable(certificateCodeService.generateBarcodeDataUri(barcodePayload)).orElse(""));
        // The short code in readable form, so a certificate carrying a barcode
        // can also print the code beside it — a damaged or unscannable barcode
        // then still verifies by typing it into the public verify page.
        namedPlaceholders.put("{{CERTIFICATE_SHORT_CODE}}", Optional.ofNullable(shortCode).orElse(""));
        // Admin-defined fields. Merged before substitution runs so they go
        // through the same tolerant two-pass replacement as everything else.
        namedPlaceholders.putAll(
                certificateCustomFieldService.resolveTokens(settingJson, studentId));
        // Names the partner-affiliation design uses for values the pipeline already has: the
        // allocated number doubles as the registration number, and the issue date is the
        // completion/issue date. Aliases rather than new state, so they can never disagree
        // with {{CERTIFICATE_ID}} / {{ISSUE_DATE}} printed elsewhere on the same page.
        namedPlaceholders.put("{{REGISTRATION_NUMBER}}", certificateId);
        namedPlaceholders.put("{{DATE_OF_ISSUE}}", completionDateStr);
        // Caller-resolved tokens (organisation name/address, validity…). Added last, and never
        // over the number: whatever the caller passes, {{CERTIFICATE_ID}} stays the allocated one.
        if (extraNamedPlaceholders != null) {
            extraNamedPlaceholders.forEach((token, value) -> {
                if (value == null || "{{CERTIFICATE_ID}}".equals(token) || "{{REGISTRATION_NUMBER}}".equals(token)) {
                    return;
                }
                namedPlaceholders.put(token, value);
            });
        }
        // Institute theme color, used for borders / accents in the certificate.
        // Falls back to the historical default border color so older templates
        // that hardcoded {{INSTITUTE_THEME_COLOR}} still render sanely.
        // Only prefix # for bare hex codes (3/6/8 hex chars); leave CSS color
        // names like "purple" alone — "#purple" is invalid CSS.
        String themeColor = studentSessionInstituteGroupMapping.getInstitute().getInstituteThemeCode();
        if (themeColor == null || themeColor.isBlank()) {
            themeColor = "#1e4fa1";
        } else {
            String trimmed = themeColor.trim();
            if (trimmed.matches("^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")) {
                themeColor = "#" + trimmed;
            } else {
                themeColor = trimmed;
            }
        }
        namedPlaceholders.put("{{INSTITUTE_THEME_COLOR}}", themeColor);

        // Two-pass tolerant substitution. Pass 1 is a regex that allows
        // whitespace padding and case variations inside the braces (handles
        // `{{ ISSUE_DATE }}`, `{{issue_date}}`, non-breaking spaces, etc. that
        // creep in when admins paste templates from Google Docs / Word).
        // Pass 2 is a plain literal `String.replace` belt-and-suspenders catch
        // for the canonical `{{TOKEN}}` form — so even if the regex misses an
        // edge case (e.g., values containing `{{` that confuse subsequent
        // matches), the exact-match token still gets resolved. Without pass 2,
        // bugs in pass 1 would silently render tokens as raw text on the
        // issued PDF.
        for (Map.Entry<String, String> entry : namedPlaceholders.entrySet()) {
            if (entry.getValue() == null) continue;
            String token = entry.getKey();
            String inner = token.substring(2, token.length() - 2);
            String pattern = "\\{\\{\\s*" + java.util.regex.Pattern.quote(inner) + "\\s*\\}\\}";
            try {
                filledTemplate = java.util.regex.Pattern
                        .compile(pattern, java.util.regex.Pattern.CASE_INSENSITIVE)
                        .matcher(filledTemplate)
                        .replaceAll(java.util.regex.Matcher.quoteReplacement(entry.getValue()));
            } catch (Exception ignored) {
                // Regex blew up for some reason — fall through to the literal
                // pass below.
            }
            // Pass 2: literal exact-match replacement. Safe even if pass 1
            // already replaced everything (contains() returns false then).
            if (filledTemplate.contains(token)) {
                filledTemplate = filledTemplate.replace(token, entry.getValue());
            }
        }

        // Legacy numeric placeholder pass — runs AFTER the named pass so its
        // historically-swapped mapping (key "1" points at {{COURSE_NAME}} but
        // stores the session name) can no longer hijack tokens the named pass
        // already consumed. Existing templates that rely on the legacy pass
        // for tokens like {{DATE_OF_COMPLETION}} / {{TODAY_DATE}} / {{LEVEL}}
        // / {{INSTITUTE_LOGO}} / {{SIGNATURE}} / {{DESIGNATION}} still work
        // because the named pass doesn't touch those.
        for (Map.Entry<String, String> entry : defaultPlaceHolders.entrySet()) {
            String placeholder = entry.getValue();
            String value = placeHolderMapping.get(entry.getKey());
            if (value != null && filledTemplate.contains(placeholder)) {
                filledTemplate = filledTemplate.replace(placeholder, value);
            }
        }

        // Critical-token guard: a final unconditional pass over the must-show
        // tokens. The loops above usually catch everything, but if a saved
        // template has an unusual variant the loops miss, this guarantees the
        // learner never sees a raw {{TOKEN}} on the issued PDF. Each line is
        // a plain `String.replace` so there's no way for it to silently no-op.
        String safeCertId = certificateId == null ? "" : certificateId;
        String safeStudent = learnerName == null ? "" : learnerName;
        String safeCourse = courseName == null ? "" : courseName;
        String safeInstitute = studentSessionInstituteGroupMapping.getInstitute() != null
                && studentSessionInstituteGroupMapping.getInstitute().getInstituteName() != null
                ? studentSessionInstituteGroupMapping.getInstitute().getInstituteName() : "";
        filledTemplate = filledTemplate.replace("{{CERTIFICATE_ID}}", safeCertId);
        filledTemplate = filledTemplate.replace("{{STUDENT_NAME}}", safeStudent);
        filledTemplate = filledTemplate.replace("{{COURSE_NAME}}", safeCourse);
        filledTemplate = filledTemplate.replace("{{PACKAGE_NAME}}", safeCourse);
        filledTemplate = filledTemplate.replace("{{INSTITUTE_NAME}}", safeInstitute);
        String safeDate = completionDateStr == null ? "" : completionDateStr;
        filledTemplate = filledTemplate.replace("{{DATE_OF_COMPLETION}}", safeDate);
        filledTemplate = filledTemplate.replace("{{ISSUE_DATE}}", safeDate);

        String safeWebsite = formatWebsiteForDisplay(
                studentSessionInstituteGroupMapping.getInstitute() != null
                        ? studentSessionInstituteGroupMapping.getInstitute().getWebsiteUrl()
                        : null);
        filledTemplate = filledTemplate.replace("{{INSTITUTE_WEBSITE}}", safeWebsite);

        // Codes are img-src tokens, so an unsubstituted one would leave a broken
        // image on the PDF rather than visible text. Blank them unconditionally.
        filledTemplate = filledTemplate.replace("{{CERTIFICATE_QR}}",
                Optional.ofNullable(namedPlaceholders.get("{{CERTIFICATE_QR}}")).orElse(""));
        filledTemplate = filledTemplate.replace("{{CERTIFICATE_BARCODE}}",
                Optional.ofNullable(namedPlaceholders.get("{{CERTIFICATE_BARCODE}}")).orElse(""));

        // Strip the branding that the shipped default template used to hardcode.
        // 502 of 527 institutes already have "WWW.CODECIRCLE.ORG" — one customer's
        // domain — baked into their *saved* template, so fixing the constant alone
        // would only help institutes created from here on. Removing it at render
        // time repairs every existing institute without rewriting their settings
        // blob. No website is shown by default; admins can add {{INSTITUTE_WEBSITE}}
        // from the template editor if they want theirs.
        filledTemplate = scrubHardcodedDefaultBranding(filledTemplate);

        // Last line of defence before the PDF is drawn: no raw {{TOKEN}} ever
        // reaches a learner. Runs after every substitution pass, so it only sees
        // tokens nothing could resolve.
        filledTemplate = scrubUnresolvedTokens(filledTemplate);

        // Shrink any field whose substituted value is too long for the box the
        // admin drew — a long learner name or course title. Must run after
        // substitution: the length of the real value is the whole input. A
        // no-op for templates that carry no field metadata, which is every
        // hand-authored one.
        filledTemplate = certificateTextFitService.fitTemplate(filledTemplate);

        // Guarantee every certificate carries its number and a scannable code by
        // stamping a bottom-right badge — but only for the parts the template
        // does not position itself. Wherever the admin placed a field, that
        // placement wins: the editor shows the badge exactly where it will
        // print, and dragging it there is what converts it into a real field.
        //
        // Both parts are checked independently. Every built-in template places
        // {{CERTIFICATE_ID}}, so stamping the number unconditionally printed it
        // twice — once where the design puts it, once bottom-right.
        //
        // Detection is token-tolerant for the same reason the substitution pass
        // is: templates pasted from Word arrive as `{{ certificate_id }}`, and a
        // strict contains() would miss those and duplicate anyway.
        //
        // The stamp is also switchable. It used to be unconditional, so an admin
        // who deleted the QR or the number from their design got it back
        // bottom-right on every issued certificate, with nothing anywhere to
        // turn it off. autoStampCode / autoStampNumber are that switch; both
        // default to on, which is exactly what every institute had before.
        boolean templatePlacesOwnCode = templateContainsToken(template, "{{CERTIFICATE_QR}}")
                || templateContainsToken(template, "{{CERTIFICATE_BARCODE}}");
        boolean templatePlacesOwnId = templateContainsToken(template, "{{CERTIFICATE_ID}}");
        boolean useBarcode = "BARCODE".equalsIgnoreCase(resolveBadgeCodeType(settingJson));
        String badgeCode = templatePlacesOwnCode || !isAutoStampEnabled(settingJson, "autoStampCode")
                ? null
                : namedPlaceholders.get(useBarcode ? "{{CERTIFICATE_BARCODE}}" : "{{CERTIFICATE_QR}}");
        String badgeId = templatePlacesOwnId || !isAutoStampEnabled(settingJson, "autoStampNumber")
                ? null
                : certificateId;
        boolean barcodeVerifies = "VERIFICATION_CODE"
                .equalsIgnoreCase(readCertificateSettingText(settingJson, "barcodeContent"));
        filledTemplate = appendCertificateIdBadge(filledTemplate, badgeId, badgeCode, useBarcode,
                barcodeVerifies);

        // Render the PDF using the institute-configured page size if present.
        final String renderedHtml = filledTemplate;
        float[] pageSizeMm = getPageSizeMm(settingJson, type);
        String fileStem = CertificateTypeEnum.COURSE_COMPLETION.name().equals(type)
                ? "course_certification" : type.toLowerCase(Locale.ROOT) + "_certificate";
        Optional<FileDetailsDTO> uploaded = uploadToAws(convertHtmlToPdf(renderedHtml, fileStem, pageSizeMm),
                studentSessionInstituteGroupMapping.getUserId() + fileStem);

        // Persist the audit row with the rendered HTML snapshot. Failures here
        // are logged but do not block delivery — the learner still gets the PDF.
        final Integer auditPercentage = completionPercentage != null
                ? completionPercentage
                : (request != null ? request.getCompletionPercentage() : null);
        uploaded.ifPresent(file -> {
            try {
                IssuedCertificate audit = IssuedCertificate.builder()
                        .id(certificateId)
                        // Mirror into the self-documenting column. Same value
                        // as `id` — the substitution loop above uses this same
                        // `certificateId` for {{CERTIFICATE_ID}} in both Visual
                        // and HTML editor templates, so reading certificate_id
                        // here is guaranteed to match what was rendered on the
                        // PDF the learner downloads.
                        .certificateId(certificateId)
                        .instituteId(studentSessionInstituteGroupMapping.getInstitute().getId())
                        .userId(studentSessionInstituteGroupMapping.getUserId())
                        .packageSessionId(studentSessionInstituteGroupMapping.getPackageSession() != null
                                ? studentSessionInstituteGroupMapping.getPackageSession().getId() : null)
                        .courseName(courseName)
                        .completionPercentage(auditPercentage)
                        // Re-render keeps the date the learner actually earned it.
                        .issuedAt(originalIssuedAt != null ? originalIssuedAt : new Date())
                        .verificationToken(verificationToken)
                        .shortCode(shortCode)
                        .fileId(file.getId())
                        .templateHtmlSnapshot(renderedHtml)
                        .certificateType(type)
                        .build();
                issuedCertificateRepository.save(audit);
            } catch (Exception e) {
                log.error("Failed to persist IssuedCertificate audit row: {}", e.getMessage());
            }
        });

        return uploaded;
    }

    public MultipartFile convertHtmlToPdf(String htmlContent, String fileName) {
        return convertHtmlToPdf(htmlContent, fileName, null);
    }

    public MultipartFile convertHtmlToPdf(String htmlContent, String fileName, float[] pageSizeMm) {
        try {
            String htmlWithCss;

            // Check if htmlContent is already a complete HTML document
            boolean isCompleteHtml = htmlContent.trim().toLowerCase().startsWith("<!doctype") ||
                    htmlContent.trim().toLowerCase().startsWith("<html");

            if (isCompleteHtml) {
                // Use the HTML content as-is since it's already complete
                htmlWithCss = htmlContent;
            } else {
                // Wrap partial HTML content with our default styling
                htmlWithCss = "<!DOCTYPE html>" +
                        "<html xmlns=\"http://www.w3.org/1999/xhtml\">" +
                        "<head>" +
                        "  <meta charset=\"UTF-8\" />" +
                        "  <style>" +
                        "    @page { " +
                        "      margin: 15mm; " +
                        "      size: auto; " +
                        "    } " +
                        "    body { " +
                        "      font-family: Arial, sans-serif; " +
                        "      line-height: 1.4; " +
                        "      max-width: 210mm; " + // A4 width minus margins
                        "      min-width: 100mm; " + // Minimum reasonable width
                        "      width: fit-content; " +
                        "      margin: 0 auto; " +
                        "      box-sizing: border-box; " +
                        "    } " +
                        "    * { " +
                        "      max-width: 100%; " +
                        "      box-sizing: border-box; " +
                        "    } " +
                        "    img { " +
                        "      max-width: 100%; " +
                        "      height: auto; " +
                        "    } " +
                        "    table { " +
                        "      width: 100%; " +
                        "      table-layout: auto; " +
                        "    } " +
                        "  </style>" +
                        "</head>" +
                        "<body>" +
                        htmlContent +
                        "</body></html>";
            }
            // Prepare output stream
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

            // Build the PDF
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();

            // Enable image support and set proper rendering options
            builder.useFont(() -> {
                try {
                    return this.getClass().getResourceAsStream("/fonts/Arial.ttf");
                } catch (Exception e) {
                    return null; // Fallback to system fonts
                }
            }, "Arial");

            // Process HTML to ensure images are properly handled
            String processedHtml = processImagesForPdf(htmlWithCss);

            // Set base URI for relative image paths (if needed)
            String baseUri = "file:///";
            builder.withHtmlContent(sanitizeToXhtml(processedHtml), baseUri);

            // Apply institute-configured page size if provided; otherwise fall
            // back to the historical A4 landscape default.
            if (pageSizeMm != null && pageSizeMm.length == 2) {
                builder.useDefaultPageSize(pageSizeMm[0], pageSizeMm[1], PdfRendererBuilder.PageSizeUnits.MM);
            } else {
                builder.useDefaultPageSize(297f, 210f, PdfRendererBuilder.PageSizeUnits.MM); // A4 landscape as fallback
            }

            // Remove fixed page size to allow dynamic sizing based on content

            builder.toStream(outputStream);
            builder.run();

            // Create MultipartFile from the PDF bytes
            return new InMemoryMultipartFile(
                    fileName,
                    fileName + ".pdf",
                    "application/pdf",
                    outputStream.toByteArray());
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    public static String sanitizeToXhtml(String html) {
        Document doc = Jsoup.parse(html);
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml);
        doc.outputSettings().escapeMode(Entities.EscapeMode.xhtml);
        String xhtml = doc.html();
        // Jsoup emits <style>/<script> contents verbatim, so a bare '&' inside
        // e.g. a Google Fonts rule — @import url('...?family=A&family=B&display=swap')
        // — survives unescaped and breaks OpenHTML2PDF's strict XML parser
        // ("The reference to entity 'family' must end with the ';' delimiter").
        // Escape any ampersand that isn't already a valid XML/HTML entity so such
        // templates (and the bundled default fallback) render instead of throwing.
        xhtml = xhtml.replaceAll("&(?!(?:amp|lt|gt|quot|apos|#\\d+|#x[0-9a-fA-F]+);)", "&amp;");
        return xhtml;
    }

    private String processImagesForPdf(String html) {
        try {
            Document doc = Jsoup.parse(html);
            Elements images = doc.select("img");

            for (Element img : images) {
                String src = img.attr("src");
                if (src != null && !src.isEmpty()) {
                    // Handle different image source types
                    if (src.startsWith("http://") || src.startsWith("https://")) {
                        // For HTTP/HTTPS URLs, try to convert to base64
                        try {
                            String base64Image = convertUrlToBase64(src);
                            if (base64Image != null) {
                                img.attr("src", base64Image);
                            }
                        } catch (Exception e) {
                            // If conversion fails, keep original URL
                            System.err.println("Failed to convert image URL to base64: " + src);
                        }
                    }
                    // For data: URLs (base64), keep as-is
                    // For file: URLs, keep as-is (will be resolved with baseUri)

                    // Keep loose images from overflowing the page — but never
                    // touch one the template has positioned itself.
                    //
                    // This used to append "max-width: 100%; height: auto" to
                    // *every* image. Inline styles outrank the stylesheet, so on
                    // a certificate that rule silently replaced the artwork's
                    // `height: 100%` with `height: auto`: the background then
                    // drew at its own aspect ratio instead of filling the
                    // canvas, and whatever it no longer covered came out blank
                    // white. It only showed up when the uploaded artwork's
                    // aspect ratio differed from the page, which is why the
                    // stock templates looked fine. `object-fit: cover` would
                    // have masked it, but openhtmltopdf is a CSS 2.1 renderer
                    // and ignores object-fit entirely.
                    //
                    // The guard is deliberately broad: an absolutely positioned
                    // image, an image with its own dimensions, or one dressed by
                    // a stylesheet class is placed on purpose, and a generic
                    // "fit to the page" rule can only break it.
                    if (!isTemplatePositioned(img)) {
                        String style = img.attr("style");
                        if (!style.contains("max-width")) {
                            style += (style.isEmpty() ? "" : "; ") + "max-width: 100%; height: auto;";
                            img.attr("style", style);
                        }
                    }
                }
            }

            return doc.html();
        } catch (Exception e) {
            System.err.println("Error processing images for PDF: " + e.getMessage());
            return html; // Return original HTML if processing fails
        }
    }

    /**
     * Whether the template positions or sizes this image itself, in which case
     * the generic page-fitting rule must be left off.
     *
     * <p>Covers the three ways a certificate template takes control: a stylesheet
     * class (the full-bleed background is {@code <img class="bg">} with no inline
     * style at all), absolute positioning, or explicit inline dimensions.
     */
    static boolean isTemplatePositioned(Element img) {
        if (StringUtils.hasText(img.attr("class"))) {
            return true;
        }
        String style = img.attr("style").replace(" ", "").toLowerCase();
        return style.contains("position:absolute")
                || style.contains("position:fixed")
                || style.contains("width:")
                || style.contains("height:");
    }

    private String convertUrlToBase64(String imageUrl) {
        try {
            java.net.URL url = new java.net.URL(imageUrl);
            java.net.HttpURLConnection connection = (java.net.HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(5000); // 5 seconds timeout
            connection.setReadTimeout(10000); // 10 seconds timeout
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (PDF Generator)");

            if (connection.getResponseCode() == 200) {
                try (java.io.InputStream inputStream = connection.getInputStream();
                        java.io.ByteArrayOutputStream outputStream = new java.io.ByteArrayOutputStream()) {

                    byte[] buffer = new byte[4096];
                    int bytesRead;
                    while ((bytesRead = inputStream.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, bytesRead);
                    }

                    byte[] imageBytes = outputStream.toByteArray();
                    String contentType = connection.getContentType();
                    if (contentType == null) {
                        contentType = "image/png"; // Default fallback
                    }

                    String base64 = java.util.Base64.getEncoder().encodeToString(imageBytes);
                    return "data:" + contentType + ";base64," + base64;
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to convert URL to base64: " + imageUrl + " - " + e.getMessage());
        }
        return null;
    }

    private Optional<FileDetailsDTO> uploadToAws(MultipartFile file, String title) {
        try {
            return Optional.of(mediaService.uploadFileV2(file));
        } catch (Exception e) {
            e.printStackTrace();
            return Optional.empty();
        }
    }

    public Optional<String> getCurrentCertificateTemplate(String json, String key) {
        try {
            JsonNode root = objectMapper.readTree(json);

            JsonNode certificateSettings = root.path("setting").path("CERTIFICATE_SETTING").path("data").path("data");
            if (certificateSettings.isArray() && !certificateSettings.isEmpty()) {

                for (JsonNode certificateConfig : certificateSettings) {
                    String configKey = certificateConfig.path("key").asText(null);

                    if (key.equals(configKey)) {
                        // Saving the template implies activation: if the admin
                        // has persisted a non-empty currentHtmlCertificateTemplate,
                        // always render it. The legacy isDefaultCertificateSettingOn
                        // gate is intentionally ignored — its semantics drifted
                        // from "use default" to "feature enabled" and the
                        // completion-percentage threshold upstream already gates
                        // issuance.
                        String saved = certificateConfig.path("currentHtmlCertificateTemplate").asText(null);
                        if (StringUtils.hasText(saved)) {
                            return Optional.of(saved);
                        }
                        return Optional.ofNullable(ConstantsSettingDefaultValue.getDefaultHtmlForType(key));
                    }
                }
            }

        } catch (Exception e) {
            log.warn("Failed to parse certificate template from institute setting", e);
        }
        return Optional.ofNullable(ConstantsSettingDefaultValue.getDefaultHtmlForType(key));
    }

    private static final Map<String, String> DEFAULT_PLACEHOLDERS = Map.of(
            "6", "Official Signatory",
            "7", " ");

    public static Map<String, String> extractPlaceholders(String json) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            CertificateSettingDataDto dataDto = mapper.readValue(json, CertificateSettingDataDto.class);

            if (dataDto == null || dataDto.getData() == null || dataDto.getData().isEmpty()) {
                return DEFAULT_PLACEHOLDERS;
            }

            CertificateSettingDto firstSetting = dataDto.getData().get(0);

            if (firstSetting == null || firstSetting.getPlaceHoldersMapping() == null) {
                return DEFAULT_PLACEHOLDERS;
            }

            return firstSetting.getPlaceHoldersMapping();

        } catch (Exception e) {
            // In case JSON parsing fails
            return DEFAULT_PLACEHOLDERS;
        }
    }

    @Transactional
    public String updateInstituteCurrentTemplate(Institute institute, CertificationGenerationRequest request)
            throws JsonProcessingException {
        String settingJson = institute.getSetting();

        // Deserialize
        InstituteSettingDto instituteSettingDto = objectMapper.readValue(settingJson, InstituteSettingDto.class);
        SettingDto certificateSettingDto = instituteSettingDto.getSetting().get("CERTIFICATE_SETTING");

        // Convert object to CertificateSettingDataDto properly
        CertificateSettingDataDto dataDto = objectMapper.convertValue(certificateSettingDto.getData(),
                CertificateSettingDataDto.class);

        // Update current template
        for (CertificateSettingDto data : dataDto.getData()) {
            if (data.getKey().equals(request.getKey())) {
                data.setCurrentHtmlCertificateTemplate(request.getCurrentHtmlTemplate());
            }
        }

        // Set the updated data back
        certificateSettingDto.setData(dataDto);

        // Put it back into settings map
        instituteSettingDto.getSetting().put("CERTIFICATE_SETTING", certificateSettingDto);

        // Serialize back to JSON
        String updatedJson = objectMapper.writeValueAsString(instituteSettingDto);

        // Update entity
        instituteSettingWriter.save(institute, updatedJson);

        // Issued certificates are immutable: do NOT clear learners' cached
        // certificate file ids when the template changes. Already-issued
        // learners keep their certificate; only learners not yet issued render
        // against this newly-saved template on their next view. (Same rationale
        // as updateCertificateSetting.)

        return "Certificate Template Updated Successfully!";
    }

    public Object getSettingByInstituteIdAndKey(String instituteId, String settingKey) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute Not Found"));
        return getSettingData(institute, settingKey);
    }

    public void syncUserIdentifier(String instituteId, String userIdentifier) {
        authService.updateInstituteSettings(instituteId, userIdentifier);
    }
}
