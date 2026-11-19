package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import vacademy.io.common.external.VendorCallLog;
import vacademy.io.notification_service.constants.NotificationConstants;
import vacademy.io.notification_service.features.chatbot_flow.dto.WhatsAppTemplateDTO;
import vacademy.io.notification_service.features.chatbot_flow.entity.WhatsAppTemplate;
import vacademy.io.notification_service.features.chatbot_flow.exception.WhatsAppTemplateException;
import vacademy.io.notification_service.features.chatbot_flow.repository.WhatsAppTemplateRepository;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class WhatsAppTemplateManagerService {

    private final WhatsAppTemplateRepository templateRepository;
    private final InstituteInternalService instituteInternalService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final WhatsAppTemplateValidator validator;
    private final WhatsAppProviderErrorTranslator errorTranslator;

    // Pattern unused — remove to keep code clean

    // ==================== CRUD ====================

    @Transactional
    public WhatsAppTemplateDTO createDraft(WhatsAppTemplateDTO dto) {
        // Reject what the row itself can't hold (null name/category used to surface as an NPE or a
        // raw DataIntegrityViolationException, both of which reached the UI as "Failed to save").
        validator.validateForDraft(dto);

        // Normalise name: lowercase, underscores, no spaces (Meta requirement)
        String name = validator.normalizeName(dto.getName());
        String language = dto.getLanguage() != null ? dto.getLanguage() : "en";

        // Check for duplicate
        Optional<WhatsAppTemplate> existing = templateRepository
                .findByInstituteIdAndNameAndLanguage(dto.getInstituteId(), name, language);
        if (existing.isPresent() && !"DELETED".equals(existing.get().getStatus())) {
            throw WhatsAppTemplateException.conflict("TEMPLATE_NAME_EXISTS",
                    "A template named '" + name + "' already exists in " + language + " ("
                            + existing.get().getStatus() + ").",
                    "Pick a different name, or open the existing template to edit it.");
        }

        WhatsAppTemplate template = WhatsAppTemplate.builder()
                .instituteId(dto.getInstituteId())
                .name(name)
                .language(dto.getLanguage() != null ? dto.getLanguage() : "en")
                .category(dto.getCategory())
                .status("DRAFT")
                .headerType(dto.getHeaderType() != null ? dto.getHeaderType() : "NONE")
                .headerText(dto.getHeaderText())
                .headerSampleUrl(dto.getHeaderSampleUrl())
                .bodyText(dto.getBodyText())
                .footerText(dto.getFooterText())
                .buttonsConfig(toJson(dto.getButtons()))
                .bodySampleValues(toJson(dto.getBodySampleValues()))
                .bodyVariableNames(toJson(dto.getBodyVariableNames()))
                .headerSampleValues(toJson(dto.getHeaderSampleValues()))
                .createdViaVacademy(true)
                .createdBy(dto.getCreatedBy())
                .build();

        template = templateRepository.save(template);
        return toDTO(template);
    }

    public WhatsAppTemplateDTO getById(String id) {
        return toDTO(requireTemplate(id));
    }

    /** 404 rather than the platform's catch-all 511, so the UI can tell "gone" from "broken". */
    private WhatsAppTemplate requireTemplate(String id) {
        if (id == null || id.isBlank()) {
            throw WhatsAppTemplateException.invalid("MISSING_TEMPLATE_ID", "id",
                    "No template id was supplied.", null);
        }
        return templateRepository.findById(id)
                .orElseThrow(() -> WhatsAppTemplateException.notFound("Template " + id + " no longer exists."));
    }

    /**
     * Look up a template by its natural key, returning null when absent. Lets a caller that lost a
     * createDraft response (row committed here, response never arrived) adopt the existing draft by
     * name instead of re-creating it and hitting the (institute,name,language) uniqueness 409.
     */
    public WhatsAppTemplateDTO getByNameOrNull(String instituteId, String name, String language) {
        if (name == null) return null;
        String normalized = name.toLowerCase().replaceAll("[^a-z0-9_]", "_");
        String lang = language != null ? language : "en";
        return templateRepository.findByInstituteIdAndNameAndLanguage(instituteId, normalized, lang)
                .filter(t -> !"DELETED".equals(t.getStatus()))
                .map(this::toDTO)
                .orElse(null);
    }

    public List<WhatsAppTemplateDTO> getAll(String instituteId) {
        return templateRepository.findByInstituteIdOrderByUpdatedAtDesc(instituteId)
                .stream().map(this::toDTO).collect(Collectors.toList());
    }

    @Transactional
    public WhatsAppTemplateDTO update(String id, WhatsAppTemplateDTO dto) {
        WhatsAppTemplate template = requireTemplate(id);

        if (!"DRAFT".equals(template.getStatus()) && !"REJECTED".equals(template.getStatus())) {
            throw WhatsAppTemplateException.conflict("TEMPLATE_NOT_EDITABLE",
                    "This template is " + template.getStatus() + " and can no longer be edited.",
                    "Once a template is with Meta its content is locked. "
                            + "Create a new version under a different name instead.");
        }
        validator.validateForDraft(dto);

        // A rename can collide with a sibling template; catch it here rather than letting the
        // unique index blow up mid-flush with an unreadable constraint message.
        String newName = validator.normalizeName(dto.getName());
        String newLanguage = dto.getLanguage() != null ? dto.getLanguage() : "en";
        String currentId = template.getId();
        templateRepository.findByInstituteIdAndNameAndLanguage(template.getInstituteId(), newName, newLanguage)
                .filter(other -> !other.getId().equals(currentId))
                .filter(other -> !"DELETED".equals(other.getStatus()))
                .ifPresent(other -> {
                    throw WhatsAppTemplateException.conflict("TEMPLATE_NAME_EXISTS",
                            "Another template named '" + newName + "' already exists in " + newLanguage + ".",
                            "Choose a different name for this one.");
                });

        template.setName(newName);
        template.setLanguage(newLanguage);
        template.setCategory(dto.getCategory());
        template.setHeaderType(dto.getHeaderType());
        template.setHeaderText(dto.getHeaderText());
        template.setHeaderSampleUrl(dto.getHeaderSampleUrl());
        template.setBodyText(dto.getBodyText());
        template.setFooterText(dto.getFooterText());
        template.setButtonsConfig(toJson(dto.getButtons()));
        template.setBodySampleValues(toJson(dto.getBodySampleValues()));
        template.setBodyVariableNames(toJson(dto.getBodyVariableNames()));
        template.setHeaderSampleValues(toJson(dto.getHeaderSampleValues()));

        if ("REJECTED".equals(template.getStatus())) {
            template.setStatus("DRAFT");
            template.setRejectionReason(null);
        }

        template = templateRepository.save(template);
        return toDTO(template);
    }

    @Transactional
    public void delete(String id) {
        WhatsAppTemplate template = requireTemplate(id);

        // If submitted to Meta, delete from Meta first. A failure here is deliberately non-fatal —
        // the local row still goes to DELETED — but it is worth surfacing, because the name stays
        // reserved at Meta and re-creating it will fail with "already exists".
        if (template.getMetaTemplateId() != null && !"DRAFT".equals(template.getStatus())) {
            try {
                deleteFromMeta(template);
            } catch (Exception e) {
                log.warn("Deleted '{}' locally but Meta still has it — the name stays reserved there. Cause: {}",
                        template.getName(), e.getMessage());
            }
        }

        template.setStatus("DELETED");
        templateRepository.save(template);
    }

    // ==================== Meta API Integration ====================

    @Transactional
    public WhatsAppTemplateDTO submitToMeta(String id) {
        WhatsAppTemplate template = requireTemplate(id);

        if (!"DRAFT".equals(template.getStatus()) && !"REJECTED".equals(template.getStatus())) {
            String already = "PENDING".equals(template.getStatus())
                    ? "This template is already waiting on Meta's review."
                    : "This template is " + template.getStatus() + " and cannot be submitted again.";
            throw WhatsAppTemplateException.conflict("TEMPLATE_NOT_SUBMITTABLE", already,
                    "Only drafts and rejected templates can be submitted. "
                            + "Use \"Sync Templates\" to refresh the current status from Meta.");
        }

        // Everything Meta would reject for content reasons, caught before the round trip so the
        // admin gets a specific message instead of Meta's opaque "(#100) Invalid parameter".
        validator.validateForSubmit(template);

        // Resolve Meta credentials
        MetaCredentials creds = resolveMetaCredentials(template.getInstituteId());
        if (creds == null) {
            throw WhatsAppTemplateException.notConfigured(
                    "WhatsApp is not connected for this institute, so the template cannot be submitted.",
                    "Add the Meta access token and WABA id in Settings → WhatsApp, then submit again.");
        }

        // For media headers (IMAGE/VIDEO/DOCUMENT), Meta requires an upload
        // handle obtained via the Resumable Upload API — a public URL is NOT
        // accepted (subcode 2388273). Upload the sample media now and use the
        // returned handle in the template payload.
        String headerHandle = null;
        String headerType = template.getHeaderType();
        boolean needsHandle = headerType != null
                && !"NONE".equals(headerType)
                && !"TEXT".equals(headerType);
        if (needsHandle) {
            if (creds.appId == null || creds.appId.isBlank()) {
                throw WhatsAppTemplateException.notConfigured(
                        "Meta app id is missing, and it is required to upload the sample "
                                + headerType.toLowerCase() + " for this template.",
                        "Add app_id to the Meta WhatsApp settings for this institute, "
                                + "or switch the header to Text/None.");
            }
            // uploadHeaderMediaToMeta throws a WhatsAppTemplateException carrying Meta's own
            // wording so admins see exactly what went wrong (bad app_id, missing token scope,
            // unsupported file type).
            headerHandle = uploadHeaderMediaToMeta(template.getHeaderSampleUrl(), creds, headerType);
        }

        // Build Meta API payload
        Map<String, Object> payload = buildMetaTemplatePayload(template, headerHandle);

        String url = "https://graph.facebook.com/v22.0/" + creds.wabaId + "/message_templates";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(creds.accessToken);
        HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);

        ResponseEntity<String> response;
        try {
            response = restTemplate.postForEntity(url, request, String.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(url, "submit template", request, e);
            // The important branch: Meta answers a bad template with 400 + a JSON body naming the
            // problem. RestTemplate turns that into an exception whose message is escaped JSON, so
            // the translator digs out error_user_msg / code / subcode and phrases it for an admin.
            throw errorTranslator.translate("Meta", "submit template '" + template.getName() + "'", e);
        }

        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            log.error("Meta template creation returned an unusable response: status={}, body={}",
                    response.getStatusCode(), response.getBody());
            throw WhatsAppTemplateException
                    .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_EMPTY_RESPONSE",
                            "Meta accepted the connection but returned no template details (HTTP "
                                    + response.getStatusCode().value() + ").")
                    .hint("Click \"Sync Templates\" to check whether it was created anyway before re-submitting.")
                    .build();
        }

        JsonNode body;
        try {
            body = objectMapper.readTree(response.getBody());
        } catch (JsonProcessingException e) {
            throw WhatsAppTemplateException
                    .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_BAD_RESPONSE",
                            "Meta returned a response we could not read: " + response.getBody())
                    .hint("Click \"Sync Templates\" to check whether the template was created.")
                    .cause(e)
                    .build();
        }

        String metaTemplateId = body.path("id").asText(null);
        String metaStatus = body.path("status").asText("PENDING");
        // Meta can re-categorise at submit (e.g. UTILITY->MARKETING) and echo the assigned
        // category on the create response. Persist it so callers see Meta's real category,
        // not the one we requested — otherwise a synchronous APPROVED hides the recategorisation.
        String metaCategory = body.path("category").asText(null);

        template.setMetaTemplateId(metaTemplateId);
        template.setStatus(metaStatus.toUpperCase());
        if (metaCategory != null && !metaCategory.isBlank()) {
            template.setCategory(metaCategory.toUpperCase());
        }
        template.setSubmittedAt(new Timestamp(System.currentTimeMillis()));

        if ("APPROVED".equalsIgnoreCase(metaStatus)) {
            template.setApprovedAt(new Timestamp(System.currentTimeMillis()));
        }

        template = templateRepository.save(template);
        log.info("Template submitted to Meta: name={}, status={}, metaId={}",
                template.getName(), template.getStatus(), metaTemplateId);

        return toDTO(template);
    }

    @Transactional
    public int syncFromMeta(String instituteId) {
        // Detect provider from institute settings
        String provider = detectProvider(instituteId);

        return switch (provider) {
            case "WATI" -> syncFromWati(instituteId);
            default -> syncFromMetaDirect(instituteId);
        };
    }

    /**
     * Detect the WhatsApp provider configured for this institute.
     */
    private String detectProvider(String instituteId) {
        try {
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            JsonNode root = objectMapper.readTree(institute.getSetting());

            JsonNode ws = root.path("setting")
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);
            if (ws.isMissingNode()) {
                ws = root.path(NotificationConstants.WHATSAPP_SETTING)
                        .path(NotificationConstants.DATA)
                        .path(NotificationConstants.UTILITY_WHATSAPP);
            }

            return ws.path("provider").asText("META").toUpperCase();
        } catch (Exception e) {
            log.warn("Failed to detect provider, defaulting to META: {}", e.getMessage());
            return "META";
        }
    }

    private int syncFromMetaDirect(String instituteId) {
        MetaCredentials creds = resolveMetaCredentials(instituteId);
        if (creds == null) {
            throw WhatsAppTemplateException.notConfigured(
                    "WhatsApp is not connected for this institute, so there is nothing to sync.",
                    "Add the Meta access token and WABA id in Settings → WhatsApp.");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(creds.accessToken);

        String url = "https://graph.facebook.com/v22.0/" + creds.wabaId
                + "/message_templates?limit=100&fields=name,language,status,category,components,rejected_reason";

        int synced = 0;

        // Paginate through all pages of Meta templates
        while (url != null) {
            ResponseEntity<String> response;
            try {
                response = restTemplate.exchange(url, HttpMethod.GET,
                        new HttpEntity<>(headers), String.class);
            } catch (RestClientException e) {
                VendorCallLog.failed(url, "sync templates", null, e);
                // An expired token is the usual cause; the translator turns Meta's code 190 into
                // "the token is expired, update it in Settings" rather than a bare "Sync failed".
                throw errorTranslator.translate("Meta", "sync templates", e);
            }

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw WhatsAppTemplateException
                        .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_EMPTY_RESPONSE",
                                "Meta returned no template data (HTTP " + response.getStatusCode().value() + ").")
                        .build();
            }

            JsonNode body;
            try {
                body = objectMapper.readTree(response.getBody());
            } catch (JsonProcessingException e) {
                throw WhatsAppTemplateException
                        .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_BAD_RESPONSE",
                                "Meta returned template data we could not read.")
                        .cause(e)
                        .build();
            }

            JsonNode data = body.path("data");
            if (!data.isArray()) break;

            for (JsonNode tmpl : data) {
                syncSingleMetaTemplate(instituteId, tmpl);
                synced++;
            }

            // Follow pagination cursor if present
            url = body.path("paging").path("next").asText(null);
        }

        log.info("Synced {} templates from Meta for institute {}", synced, instituteId);
        return synced;
    }

    private void syncSingleMetaTemplate(String instituteId, JsonNode tmpl) {
        String name = tmpl.path("name").asText();
        String language = tmpl.path("language").asText("en");
        String status = tmpl.path("status").asText("PENDING").toUpperCase();
        String category = tmpl.path("category").asText("");
        String metaId = tmpl.path("id").asText(null);
        String rejectedReason = tmpl.path("rejected_reason").asText(null);

                // Parse components to extract body/header/footer/buttons
                String bodyText = "";
                String headerType = "NONE";
                String headerText = null;
                String footerText = null;
                List<WhatsAppTemplateDTO.TemplateButton> buttons = new ArrayList<>();

                JsonNode components = tmpl.path("components");
                if (components.isArray()) {
                    for (JsonNode comp : components) {
                        String type = comp.path("type").asText("").toUpperCase();
                        switch (type) {
                            case "HEADER" -> {
                                headerType = comp.path("format").asText("TEXT").toUpperCase();
                                if ("TEXT".equals(headerType)) headerText = comp.path("text").asText(null);
                            }
                            case "BODY" -> bodyText = comp.path("text").asText("");
                            case "FOOTER" -> footerText = comp.path("text").asText(null);
                            case "BUTTONS" -> {
                                JsonNode btns = comp.path("buttons");
                                if (btns.isArray()) {
                                    for (JsonNode btn : btns) {
                                        buttons.add(WhatsAppTemplateDTO.TemplateButton.builder()
                                                .type(btn.path("type").asText(""))
                                                .text(btn.path("text").asText(""))
                                                .url(btn.path("url").asText(null))
                                                .phoneNumber(btn.path("phone_number").asText(null))
                                                .build());
                                    }
                                }
                            }
                        }
                    }
                }

                // Upsert: find existing or create new
                Optional<WhatsAppTemplate> existingOpt = templateRepository
                        .findByInstituteIdAndNameAndLanguage(instituteId, name, language);

                WhatsAppTemplate template;
                if (existingOpt.isPresent()) {
                    template = existingOpt.get();
                    template.setStatus(status);
                    template.setMetaTemplateId(metaId);
                    template.setCategory(category);
                    template.setRejectionReason(rejectedReason);
                    // Sync content from Meta (may have been edited externally)
                    template.setHeaderType(headerType);
                    template.setHeaderText(headerText);
                    template.setBodyText(bodyText);
                    template.setFooterText(footerText);
                    template.setButtonsConfig(toJson(buttons));
                    if ("APPROVED".equals(status) && template.getApprovedAt() == null) {
                        template.setApprovedAt(new Timestamp(System.currentTimeMillis()));
                    }
                } else {
                    template = WhatsAppTemplate.builder()
                            .instituteId(instituteId)
                            .metaTemplateId(metaId)
                            .name(name)
                            .language(language)
                            .category(category)
                            .status(status)
                            .rejectionReason(rejectedReason)
                            .headerType(headerType)
                            .headerText(headerText)
                            .bodyText(bodyText)
                            .footerText(footerText)
                            .buttonsConfig(toJson(buttons))
                            .createdViaVacademy(false)
                            .build();
                    if ("APPROVED".equals(status)) {
                        template.setApprovedAt(new Timestamp(System.currentTimeMillis()));
                    }
                }

        templateRepository.save(template);
    }

    /**
     * Sync templates from WATI API: GET /api/v1/getMessageTemplates
     * Upserts templates into the local DB the same way Meta sync does.
     */
    private int syncFromWati(String instituteId) {
        WatiCredentials watiCreds = resolveWatiCredentials(instituteId);
        if (watiCreds == null) {
            throw WhatsAppTemplateException.notConfigured(
                    "WATI is selected as this institute's WhatsApp provider but no WATI API key is configured.",
                    "Add the WATI API key in Settings → WhatsApp, then sync again.");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Bearer " + watiCreds.apiKey);

        int pageSize = 100;
        int pageNumber = 1;
        int synced = 0;

        // Paginate through all pages of WATI templates
        while (true) {
            String url = watiCreds.apiUrl + "/api/v1/getMessageTemplates?pageSize=" + pageSize
                    + "&pageNumber=" + pageNumber;

            ResponseEntity<String> response;
            try {
                response = restTemplate.exchange(url, HttpMethod.GET,
                        new HttpEntity<>(headers), String.class);
            } catch (RestClientException e) {
                VendorCallLog.failed(url, "sync templates", null, e);
                throw errorTranslator.translate("WATI", "sync templates", e);
            }

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw WhatsAppTemplateException
                        .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_EMPTY_RESPONSE",
                                "WATI returned no template data (HTTP " + response.getStatusCode().value() + ").")
                        .build();
            }

            JsonNode body;
            try {
                body = objectMapper.readTree(response.getBody());
            } catch (JsonProcessingException e) {
                throw WhatsAppTemplateException
                        .builder(HttpStatus.BAD_GATEWAY, "PROVIDER_BAD_RESPONSE",
                                "WATI returned template data we could not read.")
                        .cause(e)
                        .build();
            }

            // WATI returns: { "messageTemplates": [...] } or { "result": [...] }
            JsonNode templateArray = body.path("messageTemplates");
            if (!templateArray.isArray()) {
                templateArray = body.path("result");
            }
            if (!templateArray.isArray() || templateArray.isEmpty()) break;

            for (JsonNode tmpl : templateArray) {
                syncSingleWatiTemplate(instituteId, tmpl);
                synced++;
            }

            // If we got fewer than pageSize, we've reached the last page
            if (templateArray.size() < pageSize) break;
            pageNumber++;
        }

        log.info("Synced {} templates from WATI for institute {}", synced, instituteId);
        return synced;
    }

    private void syncSingleWatiTemplate(String instituteId, JsonNode tmpl) {
        String name = tmpl.path("elementName").asText(tmpl.path("name").asText(""));
        String language = tmpl.path("languageCode").asText(tmpl.path("language").asText("en"));
        String status = tmpl.path("status").asText("APPROVED").toUpperCase();
        String category = tmpl.path("category").asText("");
        String rejectedReason = tmpl.path("rejectedReason").asText(null);

                // Parse body
                String bodyText = tmpl.path("body").asText(tmpl.path("bodyOriginal").asText(""));

                // Parse header
                String headerType = "NONE";
                String headerText = null;
                JsonNode headerNode = tmpl.path("header");
                if (!headerNode.isMissingNode() && headerNode.isObject()) {
                    String format = headerNode.path("format").asText(
                            headerNode.path("type").asText("TEXT")).toUpperCase();
                    headerType = format;
                    if ("TEXT".equals(format)) {
                        headerText = headerNode.path("text").asText(null);
                    }
                }

                // Parse footer
                String footerText = null;
                JsonNode footerNode = tmpl.path("footer");
                if (!footerNode.isMissingNode()) {
                    if (footerNode.isTextual()) {
                        footerText = footerNode.asText(null);
                    } else if (footerNode.isObject()) {
                        footerText = footerNode.path("text").asText(null);
                    }
                }

                // Parse buttons
                List<WhatsAppTemplateDTO.TemplateButton> buttons = new ArrayList<>();
                JsonNode buttonsNode = tmpl.path("buttons");
                if (buttonsNode.isArray()) {
                    for (JsonNode btn : buttonsNode) {
                        buttons.add(WhatsAppTemplateDTO.TemplateButton.builder()
                                .type(btn.path("type").asText(""))
                                .text(btn.path("text").asText(""))
                                .url(btn.path("url").asText(null))
                                .phoneNumber(btn.path("phone_number").asText(null))
                                .build());
                    }
                }

                // Upsert: find existing or create new
                Optional<WhatsAppTemplate> existingOpt = templateRepository
                        .findByInstituteIdAndNameAndLanguage(instituteId, name, language);

                WhatsAppTemplate template;
                if (existingOpt.isPresent()) {
                    template = existingOpt.get();
                    template.setStatus(status);
                    template.setCategory(category);
                    template.setRejectionReason(rejectedReason);
                    template.setHeaderType(headerType);
                    template.setHeaderText(headerText);
                    template.setBodyText(bodyText);
                    template.setFooterText(footerText);
                    template.setButtonsConfig(toJson(buttons));
                    if ("APPROVED".equals(status) && template.getApprovedAt() == null) {
                        template.setApprovedAt(new Timestamp(System.currentTimeMillis()));
                    }
                } else {
                    template = WhatsAppTemplate.builder()
                            .instituteId(instituteId)
                            .name(name)
                            .language(language)
                            .category(category)
                            .status(status)
                            .rejectionReason(rejectedReason)
                            .headerType(headerType)
                            .headerText(headerText)
                            .bodyText(bodyText)
                            .footerText(footerText)
                            .buttonsConfig(toJson(buttons))
                            .createdViaVacademy(false)
                            .build();
                    if ("APPROVED".equals(status)) {
                        template.setApprovedAt(new Timestamp(System.currentTimeMillis()));
                    }
                }

        templateRepository.save(template);
    }

    private WatiCredentials resolveWatiCredentials(String instituteId) {
        try {
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null || institute.getSetting() == null) return null;
            JsonNode root = objectMapper.readTree(institute.getSetting());

            JsonNode ws = root.path("setting")
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);
            if (ws.isMissingNode()) {
                ws = root.path(NotificationConstants.WHATSAPP_SETTING)
                        .path(NotificationConstants.DATA)
                        .path(NotificationConstants.UTILITY_WHATSAPP);
            }

            JsonNode wati = ws.path("wati");
            String apiKey = wati.path("apiKey").asText(wati.path("api_key").asText(""));
            String apiUrl = wati.path("apiUrl").asText(wati.path("api_url").asText("https://live-server.wati.io"));

            if (apiKey.isBlank()) return null;
            return new WatiCredentials(apiKey, apiUrl);
        } catch (Exception e) {
            log.error("Failed to resolve WATI credentials for institute {}: {}", instituteId, e.getMessage(), e);
            throw WhatsAppTemplateException
                    .builder(HttpStatus.BAD_GATEWAY, "SETTINGS_UNREADABLE",
                            "Could not read this institute's WhatsApp settings.")
                    .hint("This is a temporary problem on our side. Try again shortly.")
                    .cause(e)
                    .build();
        }
    }

    // ==================== Helpers ====================

    /**
     * Upload sample header media to Meta via the Resumable Upload API and
     * return the resulting handle for use as `example.header_handle` when
     * submitting an IMAGE/VIDEO/DOCUMENT-header template.
     *
     * Two-step flow per
     * https://developers.facebook.com/docs/graph-api/guides/upload :
     *   1) POST /v22.0/{app_id}/uploads?file_name=&file_length=&file_type=
     *      with Bearer auth → returns {"id": "upload:..."}
     *   2) POST /v22.0/{upload_session_id} with Authorization: OAuth <token>
     *      (NOT Bearer), header file_offset: 0, body = raw bytes
     *      → returns {"h": "<handle>"}
     */
    private String uploadHeaderMediaToMeta(String mediaUrl, MetaCredentials creds, String headerType) {
        // Step 0: download the bytes from the public sample URL.
        byte[] bytes;
        String contentType;
        try {
            ResponseEntity<byte[]> downloadResp = restTemplate.exchange(
                    toRequestUri(mediaUrl), HttpMethod.GET, HttpEntity.EMPTY, byte[].class);
            bytes = downloadResp.getBody();
            if (bytes == null || bytes.length == 0) {
                throw WhatsAppTemplateException.invalid("SAMPLE_MEDIA_EMPTY", "headerSampleUrl",
                        "The sample " + headerType.toLowerCase() + " at " + mediaUrl + " is empty.",
                        "Re-upload the sample file and try again.");
            }
            contentType = downloadResp.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE);
        } catch (RestClientException | IllegalArgumentException e) {
            VendorCallLog.failed(mediaUrl, "download template sample media", null, e);
            log.warn("Sample {} download failed for {}: {}", headerType, mediaUrl, e.getMessage());
            throw WhatsAppTemplateException.invalid("SAMPLE_MEDIA_UNREACHABLE", "headerSampleUrl",
                    "Could not download the sample " + headerType.toLowerCase() + " from " + mediaUrl + ".",
                    "The URL must be publicly reachable — Meta downloads it too. Re-upload the sample file.");
        }
        if (contentType == null || contentType.isBlank()) {
            contentType = guessContentTypeFromUrl(mediaUrl, headerType);
        }
        // Strip parameters like "; charset=..." that some CDNs return.
        int semi = contentType.indexOf(';');
        if (semi > 0) contentType = contentType.substring(0, semi).trim();

        String fileName = extractFileName(mediaUrl, headerType);

        // Step 1: start an upload session. Per Meta docs, both Bearer and the
        // access_token query param work — we use Bearer to match the rest of
        // this service's calls.
        //
        // IMPORTANT: do NOT URL-encode the `file_type` value. Meta validates it
        // against the regex /^[a-z]+(\/[A-Za-z.0-9-+]+)?$/ which requires a
        // literal '/'. URLEncoder.encode turns "image/png" into "image%2Fpng"
        // and Meta rejects it with error code 100.
        String startUrl = "https://graph.facebook.com/v22.0/" + creds.appId + "/uploads"
                + "?file_name=" + URLEncoder.encode(fileName, StandardCharsets.UTF_8)
                + "&file_length=" + bytes.length
                + "&file_type=" + contentType;

        HttpHeaders startHeaders = new HttpHeaders();
        startHeaders.setBearerAuth(creds.accessToken);
        HttpEntity<Void> startRequest = new HttpEntity<>(null, startHeaders);

        String uploadSessionId;
        try {
            ResponseEntity<String> startResp = restTemplate.exchange(
                    startUrl, HttpMethod.POST, startRequest, String.class);
            log.info("Meta resumable-upload start: status={}, body={}",
                    startResp.getStatusCode(), startResp.getBody());
            if (!startResp.getStatusCode().is2xxSuccessful() || startResp.getBody() == null) {
                throw uploadFailed(headerType, "Meta refused to start the sample upload (HTTP "
                        + startResp.getStatusCode().value() + "): " + startResp.getBody());
            }
            uploadSessionId = objectMapper.readTree(startResp.getBody()).path("id").asText(null);
            if (uploadSessionId == null || uploadSessionId.isBlank()) {
                throw uploadFailed(headerType,
                        "Meta started the sample upload but returned no session id: " + startResp.getBody());
            }
        } catch (RestClientException e) {
            VendorCallLog.failed(startUrl, "start sample upload", null, e);
            // Meta puts the real reason (bad app_id, token missing a scope) in the response body.
            throw errorTranslator.translate("Meta", "upload the sample " + headerType.toLowerCase(), e);
        } catch (JsonProcessingException e) {
            throw uploadFailed(headerType, "Meta returned an unreadable response when starting the sample upload.");
        }

        // Step 2: upload the bytes. NOTE: this leg uses "Authorization: OAuth <token>"
        // (the literal scheme name "OAuth", not "Bearer") and a "file_offset" header.
        String uploadUrl = "https://graph.facebook.com/v22.0/" + uploadSessionId;
        HttpHeaders uploadHeaders = new HttpHeaders();
        uploadHeaders.set(HttpHeaders.AUTHORIZATION, "OAuth " + creds.accessToken);
        uploadHeaders.set("file_offset", "0");
        uploadHeaders.setContentType(MediaType.parseMediaType(contentType));
        HttpEntity<byte[]> uploadRequest = new HttpEntity<>(bytes, uploadHeaders);

        try {
            ResponseEntity<String> uploadResp = restTemplate.exchange(
                    uploadUrl, HttpMethod.POST, uploadRequest, String.class);
            log.info("Meta resumable-upload bytes: status={}, body={}",
                    uploadResp.getStatusCode(), uploadResp.getBody());
            if (!uploadResp.getStatusCode().is2xxSuccessful() || uploadResp.getBody() == null) {
                throw uploadFailed(headerType, "Meta rejected the sample file (HTTP "
                        + uploadResp.getStatusCode().value() + "): " + uploadResp.getBody());
            }
            String handle = objectMapper.readTree(uploadResp.getBody()).path("h").asText(null);
            if (handle == null || handle.isBlank()) {
                throw uploadFailed(headerType,
                        "Meta accepted the sample file but returned no handle: " + uploadResp.getBody());
            }
            log.info("Meta resumable-upload succeeded: bytes={}, sessionId={}", bytes.length, uploadSessionId);
            return handle;
        } catch (RestClientException e) {
            VendorCallLog.failed(uploadUrl, "upload sample file", null, e);
            throw errorTranslator.translate("Meta", "upload the sample " + headerType.toLowerCase(), e);
        } catch (JsonProcessingException e) {
            throw uploadFailed(headerType, "Meta returned an unreadable response after the sample upload.");
        }
    }

    /**
     * Media-header uploads fail for reasons the admin can act on (wrong file type, file too large,
     * misconfigured app id), so they are reported as a fixable problem on the sample field rather
     * than an opaque server error.
     */
    private WhatsAppTemplateException uploadFailed(String headerType, String detail) {
        return WhatsAppTemplateException.invalid("SAMPLE_MEDIA_UPLOAD_FAILED", "headerSampleUrl",
                "Could not upload the sample " + headerType.toLowerCase() + " to Meta. " + detail,
                "Try a smaller file in a standard format (JPG/PNG for image, MP4 for video, PDF for document). "
                        + "The template has not been submitted.");
    }

    /**
     * The sample URL as a request URI, used exactly as stored. RestTemplate's String overloads treat
     * the argument as a URI template and percent-encode it again, so an uploaded key such as
     * "image_%2819%29.png" (from "image (19).png") was fetched as "image_%252819%2529.png" — an
     * object that does not exist, which the CDN answers with 403 — and the submit failed as "not
     * publicly reachable" although the URL was public. A pasted URL that is not valid as-is (a raw
     * space, say) is encoded once instead.
     */
    static URI toRequestUri(String url) {
        String trimmed = url == null ? "" : url.trim();
        try {
            URI uri = new URI(trimmed);
            if (uri.getScheme() != null && uri.getHost() != null) return uri;
        } catch (URISyntaxException ignored) {
            // not valid as-is; encode it below
        }
        return UriComponentsBuilder.fromUriString(trimmed).build().encode().toUri();
    }

    /**
     * Name sent to Meta's upload session. Meta only uses it as a label, so it is reduced to
     * characters that need no encoding in the query string — the stored key is percent-encoded and
     * would otherwise be encoded twice more on the way out.
     */
    static String extractFileName(String url, String headerType) {
        try {
            String path = url.split("\\?", 2)[0];
            int slash = path.lastIndexOf('/');
            String name = slash >= 0 ? path.substring(slash + 1) : path;
            String clean = name.replaceAll("%[0-9A-Fa-f]{2}", "_").replaceAll("[^A-Za-z0-9._-]", "_");
            if (!clean.isBlank()) return clean;
        } catch (Exception ignored) {
            // fall through to default
        }
        return "sample-" + headerType.toLowerCase();
    }

    private String guessContentTypeFromUrl(String url, String headerType) {
        String lower = url.toLowerCase().split("\\?", 2)[0];
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".3gp")) return "video/3gpp";
        if (lower.endsWith(".pdf")) return "application/pdf";
        // Sensible defaults per header type
        return switch (headerType) {
            case "IMAGE" -> "image/jpeg";
            case "VIDEO" -> "video/mp4";
            case "DOCUMENT" -> "application/pdf";
            default -> "application/octet-stream";
        };
    }

    private Map<String, Object> buildMetaTemplatePayload(WhatsAppTemplate template, String headerHandle) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", template.getName());
        payload.put("language", template.getLanguage());
        payload.put("category", template.getCategory());

        List<Map<String, Object>> components = new ArrayList<>();

        // Header
        if (!"NONE".equals(template.getHeaderType())) {
            Map<String, Object> header = new LinkedHashMap<>();
            header.put("type", "HEADER");
            if ("TEXT".equals(template.getHeaderType())) {
                header.put("format", "TEXT");
                header.put("text", template.getHeaderText());
                // Add example if header has placeholders
                if (template.getHeaderSampleValues() != null) {
                    List<String> samples = fromJsonList(template.getHeaderSampleValues());
                    if (!samples.isEmpty()) {
                        // Meta expects: {"header_text": ["sample1"]} — flat list, NOT nested
                        header.put("example", Map.of("header_text", samples));
                    }
                }
            } else {
                header.put("format", template.getHeaderType()); // IMAGE, VIDEO, DOCUMENT
                // Media headers require a handle obtained via Meta's Resumable
                // Upload API (passed in by the caller). A raw URL is rejected
                // by Meta with subcode 2388273.
                if (headerHandle != null && !headerHandle.isBlank()) {
                    header.put("example", Map.of("header_handle", List.of(headerHandle)));
                }
            }
            components.add(header);
        }

        // Body
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "BODY");
        body.put("text", template.getBodyText());
        // Add example if body has placeholders
        List<String> bodySamples = fromJsonList(template.getBodySampleValues());
        if (!bodySamples.isEmpty()) {
            body.put("example", Map.of("body_text", List.of(bodySamples)));
        }
        components.add(body);

        // Footer
        if (template.getFooterText() != null && !template.getFooterText().isBlank()) {
            components.add(Map.of("type", "FOOTER", "text", template.getFooterText()));
        }

        // Buttons
        List<WhatsAppTemplateDTO.TemplateButton> buttons = fromJsonButtons(template.getButtonsConfig());
        if (!buttons.isEmpty()) {
            List<Map<String, Object>> btnList = new ArrayList<>();
            for (WhatsAppTemplateDTO.TemplateButton btn : buttons) {
                Map<String, Object> btnMap = new LinkedHashMap<>();
                btnMap.put("type", btn.getType());
                btnMap.put("text", btn.getText());
                if ("URL".equals(btn.getType()) && btn.getUrl() != null) {
                    btnMap.put("url", btn.getUrl());
                    if (btn.getExample() != null && !btn.getExample().isEmpty()) {
                        btnMap.put("example", btn.getExample());
                    }
                }
                if ("PHONE_NUMBER".equals(btn.getType()) && btn.getPhoneNumber() != null) {
                    btnMap.put("phone_number", btn.getPhoneNumber());
                }
                btnList.add(btnMap);
            }
            components.add(Map.of("type", "BUTTONS", "buttons", btnList));
        }

        payload.put("components", components);
        return payload;
    }

    private void deleteFromMeta(WhatsAppTemplate template) {
        MetaCredentials creds = resolveMetaCredentials(template.getInstituteId());
        if (creds == null) return;

        String url = "https://graph.facebook.com/v22.0/" + creds.wabaId
                + "/message_templates?name=" + template.getName();

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(creds.accessToken);

        try {
            restTemplate.exchange(url, HttpMethod.DELETE, new HttpEntity<>(headers), String.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(url, "delete template", null, e);
            throw e;
        }
        log.info("Deleted template from Meta: name={}", template.getName());
    }

    private MetaCredentials resolveMetaCredentials(String instituteId) {
        try {
            InstituteInfoDTO institute = instituteInternalService.getInstituteByInstituteId(instituteId);
            if (institute == null || institute.getSetting() == null) {
                // "No settings at all" is genuinely not-configured; the callers' message is correct.
                return null;
            }
            JsonNode root = objectMapper.readTree(institute.getSetting());

            JsonNode ws = root.path("setting")
                    .path(NotificationConstants.WHATSAPP_SETTING)
                    .path(NotificationConstants.DATA)
                    .path(NotificationConstants.UTILITY_WHATSAPP);
            if (ws.isMissingNode()) {
                ws = root.path(NotificationConstants.WHATSAPP_SETTING)
                        .path(NotificationConstants.DATA)
                        .path(NotificationConstants.UTILITY_WHATSAPP);
            }

            JsonNode meta = ws.path("meta");
            String accessToken = meta.path("access_token").asText(meta.path("accessToken").asText(
                    ws.path("access_token").asText(ws.path("accessToken").asText(""))));
            String wabaId = meta.path("wabaId").asText(meta.path("waba_id").asText(""));
            // app_id is required for the Resumable Upload API used to obtain a
            // header_handle when submitting templates with IMAGE/VIDEO/DOCUMENT
            // headers. Same key as ChannelMappingController reads for webhook
            // subscription. Optional: if missing, media-header submit will fail
            // with a clearer error than Meta's subcode 2388273.
            String appId = meta.path("app_id").asText(meta.path("appId").asText(""));

            if (accessToken.isBlank() || wabaId.isBlank()) {
                log.warn("Institute {} has WhatsApp settings but is missing {}",
                        instituteId, accessToken.isBlank() ? "the Meta access token" : "the WABA id");
                return null;
            }
            return new MetaCredentials(accessToken, wabaId, appId);
        } catch (Exception e) {
            // Don't collapse "couldn't read the institute" into "not configured" — telling an admin
            // to go add credentials they already have sends them chasing the wrong thing.
            log.error("Failed to resolve Meta credentials for institute {}: {}", instituteId, e.getMessage(), e);
            throw WhatsAppTemplateException
                    .builder(HttpStatus.BAD_GATEWAY, "SETTINGS_UNREADABLE",
                            "Could not read this institute's WhatsApp settings.")
                    .hint("This is a temporary problem on our side, not a problem with your template. Try again shortly.")
                    .cause(e)
                    .build();
        }
    }

    private WhatsAppTemplateDTO toDTO(WhatsAppTemplate t) {
        return WhatsAppTemplateDTO.builder()
                .id(t.getId())
                .instituteId(t.getInstituteId())
                .metaTemplateId(t.getMetaTemplateId())
                .name(t.getName())
                .language(t.getLanguage())
                .category(t.getCategory())
                .status(t.getStatus())
                .rejectionReason(t.getRejectionReason())
                .headerType(t.getHeaderType())
                .headerText(t.getHeaderText())
                .headerSampleUrl(t.getHeaderSampleUrl())
                .bodyText(t.getBodyText())
                .footerText(t.getFooterText())
                .buttons(fromJsonButtons(t.getButtonsConfig()))
                .bodySampleValues(fromJsonList(t.getBodySampleValues()))
                .bodyVariableNames(fromJsonList(t.getBodyVariableNames()))
                .headerSampleValues(fromJsonList(t.getHeaderSampleValues()))
                .createdViaVacademy(t.isCreatedViaVacademy())
                .createdBy(t.getCreatedBy())
                .createdAt(t.getCreatedAt() != null ? t.getCreatedAt().toString() : null)
                .submittedAt(t.getSubmittedAt() != null ? t.getSubmittedAt().toString() : null)
                .approvedAt(t.getApprovedAt() != null ? t.getApprovedAt().toString() : null)
                .build();
    }

    private String toJson(Object obj) {
        if (obj == null) return null;
        try { return objectMapper.writeValueAsString(obj); }
        catch (JsonProcessingException e) { return null; }
    }

    private List<String> fromJsonList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try { return objectMapper.readValue(json, new TypeReference<>() {}); }
        catch (Exception e) { return List.of(); }
    }

    @SuppressWarnings("unchecked")
    private List<WhatsAppTemplateDTO.TemplateButton> fromJsonButtons(String json) {
        if (json == null || json.isBlank()) return List.of();
        try { return objectMapper.readValue(json, new TypeReference<>() {}); }
        catch (Exception e) { return List.of(); }
    }

    private record MetaCredentials(String accessToken, String wabaId, String appId) {}
    private record WatiCredentials(String apiKey, String apiUrl) {}
}
