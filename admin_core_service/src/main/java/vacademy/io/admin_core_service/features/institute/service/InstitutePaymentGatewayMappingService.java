package vacademy.io.admin_core_service.features.institute.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingDTO;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingUpsertRequest;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayUsageDTO;
import vacademy.io.admin_core_service.features.institute.entity.InstitutePaymentGatewayMapping;
import vacademy.io.admin_core_service.features.institute.repository.InstitutePaymentGatewayMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentGateway;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class InstitutePaymentGatewayMappingService {

    /**
     * Credential keys masked in every admin read and preserved when sent back masked.
     * Must cover each {@code secret: true} field of the vendor forms in the admin
     * dashboard's PaymentGatewaySettings.tsx, or that value goes to the browser in clear.
     */
    private static final Set<String> SECRET_FIELDS = Set.of(
            "apiKey",
            "keySecret",
            "publishableKey",
            "clientSecret",
            "password",
            "encryptionKey",
            "webhookSecret",
            "webhookPassword",
            "saltKey"
    );

    private static final String MASK_PREFIX = "••••";

    @Autowired
    private InstitutePaymentGatewayMappingRepository institutePaymentGatewayMappingRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository invitationPaymentOptionRepository;

    public Map<String, Object> findInstitutePaymentGatewaySpecifData(String vendor, String instituteId) {
        InstitutePaymentGatewayMapping institutePaymentGatewayMapping = institutePaymentGatewayMappingRepository
                .findByInstituteIdAndVendorAndStatusIn(instituteId, vendor, List.of(StatusEnum.ACTIVE.name()))
                .orElseThrow(() -> {
                    return new VacademyException("No configurartion found for this payment gateway type");
                });
        return convertJsonToMap(institutePaymentGatewayMapping.getPaymentGatewaySpecificData());
    }

    public InstitutePaymentGatewayMapping findByInstituteIdAndVendor(String instituteId, String vendor) {
        return institutePaymentGatewayMappingRepository
                .findByInstituteIdAndVendorAndStatusIn(instituteId, vendor, List.of(StatusEnum.ACTIVE.name()))
                .orElseThrow(() -> new VacademyException("No configuration found for payment gateway type: " + vendor
                        + " and institute: " + instituteId));
    }

    private Map<String, Object> convertJsonToMap(String json) {
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            throw new VacademyException("Failed to convert JSON to map");
        }
    }

    public Map<String, Object> getPaymentGatewayOpenDetails(String instituteId, String vendor) {
        Map<String, Object> paymentGatewaySpecificData = findInstitutePaymentGatewaySpecifData(vendor, instituteId);
        PaymentGateway paymentGateway = PaymentGateway.fromString(vendor);
        switch (paymentGateway) {
            case STRIPE:
                return stripePaymentGatewayOpenDetails(paymentGatewaySpecificData);
            case RAZORPAY:
                return razorpayPaymentGatewayOpenDetails(paymentGatewaySpecificData);
            case EWAY:
                return ewayPaymentGatewayOpenDetails(paymentGatewaySpecificData);
            case PHONEPE:
                return phonePePaymentGatewayOpenDetails(paymentGatewaySpecificData);
            default:
                throw new IllegalArgumentException("Unsupported payment gateway: " + vendor);
        }
    }

    private Map<String, Object> phonePePaymentGatewayOpenDetails(Map<String, Object> paymentGatewaySpecificData) {
        return Map.of("clientId", paymentGatewaySpecificData.getOrDefault("clientId", ""));
    }

    private Map<String, Object> stripePaymentGatewayOpenDetails(Map<String, Object> paymentGatewaySpecificData) {
        return Map.of("publishableKey", paymentGatewaySpecificData.get("publishableKey"));
    }

    private Map<String, Object> razorpayPaymentGatewayOpenDetails(Map<String, Object> paymentGatewaySpecificData) {
        String keyId = null;
        if (paymentGatewaySpecificData != null) {
            keyId = (String) paymentGatewaySpecificData.get("apiKey");
            if (keyId == null) {
                keyId = (String) paymentGatewaySpecificData.get("keyId");
            }
        }
        return Map.of("keyId", keyId != null ? keyId : "");
    }

    private Map<String, Object> ewayPaymentGatewayOpenDetails(Map<String, Object> paymentGatewaySpecificData) {
        // safe casts to String; will be null if absent
        String encryptionKey = paymentGatewaySpecificData == null ? null
                : (String) paymentGatewaySpecificData.get("encryptionKey");
        String publicKey = paymentGatewaySpecificData == null ? null
                : (String) paymentGatewaySpecificData.get("publicKey");

        return Map.of(
                "encryptionKey", encryptionKey,
                "publicKey", publicKey);
    }

    /**
     * Data class to hold vendor information for EnrollInvite entries.
     */
    public static class VendorInfo {
        private final String vendor;
        private final String vendorId;

        public VendorInfo(String vendor, String vendorId) {
            this.vendor = vendor;
            this.vendorId = vendorId;
        }

        public String getVendor() {
            return vendor;
        }

        public String getVendorId() {
            return vendorId;
        }
    }

    /**
     * Get the latest payment gateway vendor info for an institute.
     * If no mapping exists, fallback to STRIPE as default.
     * 
     * @param instituteId The institute ID
     * @return VendorInfo containing vendor name and mapping ID (vendorId)
     */
    /**
     * Get all active payment gateway vendors configured for an institute.
     */
    public List<VendorInfo> getAllVendorsForInstitute(String instituteId) {
        return institutePaymentGatewayMappingRepository
                .findAllByInstituteIdAndStatusIn(instituteId, List.of(StatusEnum.ACTIVE.name()))
                .stream()
                .map(mapping -> new VendorInfo(mapping.getVendor(), mapping.getVendor()))
                .toList();
    }

    public VendorInfo getLatestVendorInfoForInstitute(String instituteId) {
        return institutePaymentGatewayMappingRepository
                .findFirstByInstituteIdAndStatusInOrderByCreatedAtDesc(instituteId, List.of(StatusEnum.ACTIVE.name()))
                .map(mapping -> new VendorInfo(mapping.getVendor(), mapping.getVendor()))
                .orElseGet(() -> new VendorInfo(PaymentGateway.STRIPE.name(), PaymentGateway.STRIPE.name()));
    }

    // ── Admin CRUD ────────────────────────────────────────────────────────────

    public List<PaymentGatewayMappingDTO> listForInstitute(String instituteId) {
        return institutePaymentGatewayMappingRepository
                .findAllByInstituteIdAndStatusIn(instituteId,
                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()))
                .stream()
                .map(this::toMaskedDto)
                .toList();
    }

    public PaymentGatewayMappingDTO createMapping(String instituteId, PaymentGatewayMappingUpsertRequest request) {
        if (request == null || request.getVendor() == null || request.getVendor().isBlank()) {
            throw new VacademyException("vendor is required");
        }
        PaymentGateway.fromString(request.getVendor());
        String vendor = request.getVendor().trim().toUpperCase();

        Optional<InstitutePaymentGatewayMapping> existing = institutePaymentGatewayMappingRepository
                .findByInstituteIdAndVendorAndStatusIn(instituteId, vendor,
                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()));
        if (existing.isPresent()) {
            InstitutePaymentGatewayMapping row = existing.get();
            if (StatusEnum.ACTIVE.name().equals(row.getStatus())) {
                throw new VacademyException("A configuration for vendor " + vendor
                        + " already exists for this institute. Use update instead.");
            }
            // A deactivated row for this vendor: bring it back with the new keys rather than
            // refusing. Keeping the same row (same id) means invite links need no change.
            row.setPaymentGatewaySpecificData(toJson(mergeCredentials(row, request.getPaymentGatewaySpecificData())));
            row.setStatus(resolveStatus(request.getStatus(), StatusEnum.ACTIVE.name()));
            return toMaskedDto(institutePaymentGatewayMappingRepository.save(row));
        }

        Map<String, Object> incoming = request.getPaymentGatewaySpecificData() == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(request.getPaymentGatewaySpecificData());
        for (Map.Entry<String, Object> entry : incoming.entrySet()) {
            if (SECRET_FIELDS.contains(entry.getKey()) && isMasked(entry.getValue())) {
                throw new VacademyException("Field '" + entry.getKey()
                        + "' must contain the real secret value when creating a new mapping.");
            }
        }

        InstitutePaymentGatewayMapping mapping = new InstitutePaymentGatewayMapping();
        mapping.setInstituteId(instituteId);
        mapping.setVendor(vendor);
        mapping.setPaymentGatewaySpecificData(toJson(incoming));
        mapping.setStatus(resolveStatus(request.getStatus(), StatusEnum.ACTIVE.name()));
        // createdAt/updatedAt are populated automatically via @CreationTimestamp/@UpdateTimestamp

        return toMaskedDto(institutePaymentGatewayMappingRepository.save(mapping));
    }

    public PaymentGatewayMappingDTO updateMapping(String instituteId, String mappingId,
            PaymentGatewayMappingUpsertRequest request) {
        InstitutePaymentGatewayMapping mapping = findOwnedMapping(instituteId, mappingId);

        mapping.setPaymentGatewaySpecificData(toJson(mergeCredentials(mapping,
                request == null ? null : request.getPaymentGatewaySpecificData())));

        if (request != null && request.getStatus() != null && !request.getStatus().isBlank()) {
            mapping.setStatus(resolveStatus(request.getStatus(), mapping.getStatus()));
        }
        // updatedAt is refreshed automatically via @UpdateTimestamp

        return toMaskedDto(institutePaymentGatewayMappingRepository.save(mapping));
    }

    public void deactivateMapping(String instituteId, String mappingId) {
        InstitutePaymentGatewayMapping mapping = findOwnedMapping(instituteId, mappingId);

        mapping.setStatus(StatusEnum.INACTIVE.name());
        // updatedAt is refreshed automatically via @UpdateTimestamp
        institutePaymentGatewayMappingRepository.save(mapping);
    }

    /**
     * Switches a deactivated gateway back on with its stored keys. Same row, same id, so
     * every invite link stamped with this vendor checks out again at once. Calling it on
     * an ACTIVE gateway changes nothing.
     */
    public PaymentGatewayMappingDTO activateMapping(String instituteId, String mappingId) {
        InstitutePaymentGatewayMapping mapping = findOwnedMapping(instituteId, mappingId);
        if (StatusEnum.ACTIVE.name().equals(mapping.getStatus())) {
            return toMaskedDto(mapping);
        }
        if (!StatusEnum.INACTIVE.name().equals(mapping.getStatus())) {
            throw new VacademyException("Payment gateway mapping not found: " + mappingId);
        }
        mapping.setStatus(StatusEnum.ACTIVE.name());
        // updatedAt is refreshed automatically via @UpdateTimestamp
        return toMaskedDto(institutePaymentGatewayMappingRepository.save(mapping));
    }

    /**
     * Live invite links that check out through this gateway, for the deactivate
     * confirmation: deactivating it stops payment on every paid link counted here.
     */
    public PaymentGatewayUsageDTO usageFor(String instituteId, String mappingId) {
        InstitutePaymentGatewayMapping mapping = findOwnedMapping(instituteId, mappingId);
        String vendor = mapping.getVendor() == null ? "" : mapping.getVendor().trim().toUpperCase();
        List<String> live = List.of(StatusEnum.ACTIVE.name());
        long active = enrollInviteRepository.countByInstituteIdAndVendorAndStatusIn(instituteId, vendor, live);
        long paid = invitationPaymentOptionRepository.countPaidInvitesByInstituteIdAndVendor(
                instituteId, vendor, live, live, PaymentOptionType.FREE.name());
        return PaymentGatewayUsageDTO.builder()
                .vendor(mapping.getVendor())
                .activeInvites(active)
                .paidActiveInvites(paid)
                .build();
    }

    // ── Audit log support ─────────────────────────────────────────────────────

    /**
     * Masked pre-change state of one mapping, for the admin activity log's
     * before/after diff ({@code @Auditable(captureBefore = ...)}). Secrets are masked
     * exactly as in the admin list. Returns null instead of throwing when the row is
     * missing or belongs to another institute: the audited call then fails on its own
     * and no audit row is written.
     */
    public PaymentGatewayMappingDTO auditSnapshot(String instituteId, String mappingId) {
        if (instituteId == null || mappingId == null) {
            return null;
        }
        return institutePaymentGatewayMappingRepository.findById(mappingId)
                .filter(mapping -> instituteId.equals(mapping.getInstituteId()))
                .map(this::toMaskedDto)
                .orElse(null);
    }

    /**
     * Masked state of the institute's existing (ACTIVE or INACTIVE) mapping for a vendor,
     * for the create endpoint's audit row: present means the create re-activated a
     * deactivated row instead of adding a new one. Null when there is none; never throws.
     */
    public PaymentGatewayMappingDTO auditSnapshotByVendor(String instituteId, String vendor) {
        if (instituteId == null || vendor == null || vendor.isBlank()) {
            return null;
        }
        return institutePaymentGatewayMappingRepository
                .findByInstituteIdAndVendorAndStatusIn(instituteId, vendor.trim().toUpperCase(),
                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()))
                .map(this::toMaskedDto)
                .orElse(null);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private InstitutePaymentGatewayMapping findOwnedMapping(String instituteId, String mappingId) {
        InstitutePaymentGatewayMapping mapping = institutePaymentGatewayMappingRepository.findById(mappingId)
                .orElseThrow(() -> new VacademyException("Payment gateway mapping not found: " + mappingId));

        if (!instituteId.equals(mapping.getInstituteId())) {
            throw new VacademyException("Mapping does not belong to institute " + instituteId);
        }
        return mapping;
    }

    /**
     * Stored credentials overlaid with the incoming ones. A secret sent back still masked
     * (the admin did not retype it) keeps the stored value.
     */
    private Map<String, Object> mergeCredentials(InstitutePaymentGatewayMapping mapping,
            Map<String, Object> incomingOrNull) {
        Map<String, Object> incoming = incomingOrNull == null ? Collections.emptyMap() : incomingOrNull;
        Map<String, Object> merged = new LinkedHashMap<>(parseJsonOrEmpty(mapping.getPaymentGatewaySpecificData()));
        for (Map.Entry<String, Object> entry : incoming.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (SECRET_FIELDS.contains(key) && isMasked(value)) {
                continue;
            }
            merged.put(key, value);
        }
        return merged;
    }

    private PaymentGatewayMappingDTO toMaskedDto(InstitutePaymentGatewayMapping mapping) {
        Map<String, Object> raw = parseJsonOrEmpty(mapping.getPaymentGatewaySpecificData());
        Map<String, Object> masked = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            if (SECRET_FIELDS.contains(entry.getKey())) {
                masked.put(entry.getKey(), maskSecret(entry.getValue()));
            } else {
                masked.put(entry.getKey(), entry.getValue());
            }
        }
        return PaymentGatewayMappingDTO.builder()
                .id(mapping.getId())
                .vendor(mapping.getVendor())
                .instituteId(mapping.getInstituteId())
                .status(mapping.getStatus())
                .createdAt(mapping.getCreatedAt() == null ? null : mapping.getCreatedAt().toString())
                .updatedAt(mapping.getUpdatedAt() == null ? null : mapping.getUpdatedAt().toString())
                .paymentGatewaySpecificData(masked)
                .build();
    }

    private static String maskSecret(Object value) {
        if (value == null) return null;
        String s = value.toString();
        if (s.isEmpty()) return s;
        if (s.length() <= 4) return MASK_PREFIX;
        return MASK_PREFIX + s.substring(s.length() - 4);
    }

    private static boolean isMasked(Object value) {
        return value != null && value.toString().startsWith(MASK_PREFIX);
    }

    private Map<String, Object> parseJsonOrEmpty(String json) {
        if (json == null || json.isBlank()) return new LinkedHashMap<>();
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = objectMapper.readValue(json, Map.class);
            return parsed == null ? new LinkedHashMap<>() : parsed;
        } catch (Exception e) {
            throw new VacademyException("Stored payment gateway config is not valid JSON");
        }
    }

    private String toJson(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(data);
        } catch (Exception e) {
            throw new VacademyException("Failed to serialize payment gateway config");
        }
    }

    private static String resolveStatus(String requested, String fallback) {
        if (requested == null || requested.isBlank()) return fallback;
        try {
            return StatusEnum.valueOf(requested.trim().toUpperCase()).name();
        } catch (IllegalArgumentException ex) {
            throw new VacademyException("Invalid status: " + requested);
        }
    }
}
