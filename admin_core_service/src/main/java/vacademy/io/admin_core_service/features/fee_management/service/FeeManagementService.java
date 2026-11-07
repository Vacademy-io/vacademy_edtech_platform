package vacademy.io.admin_core_service.features.fee_management.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enroll_invite.dto.AssignCpoToPackageSessionDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.fee_management.dto.ComplexPaymentOptionDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.enums.CpoScheduleMode;
import vacademy.io.admin_core_service.features.fee_management.repository.AftInstallmentRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.AssignedFeeValueRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeTypeRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class FeeManagementService {

    @Autowired
    private ComplexPaymentOptionRepository cpoRepository;

    @Autowired
    private FeeTypeRepository feeTypeRepository;

    @Autowired
    private AssignedFeeValueRepository assignedFeeValueRepository;

    @Autowired
    private AftInstallmentRepository aftInstallmentRepository;

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository bridgeRepository;

    @Autowired
    private PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private PaymentOptionService paymentOptionService;

    /**
     * Roles that are considered trusted and can create CPOs without approval.
     * Non-admin callers will have their CPOs set to PENDING_APPROVAL.
     */
    private static final List<String> TRUSTED_ROLES = List.of("ADMIN");

    /**
     * Determines if the given user has a trusted role (i.e., can bypass approval).
     */
    private boolean isTrustedAdmin(CustomUserDetails userDetails) {
        if (userDetails == null)
            return false;
        if (userDetails.isRootUser())
            return true;
        return userDetails.getAuthorities().stream()
                .anyMatch(a -> TRUSTED_ROLES.contains(a.getAuthority().toUpperCase()));
    }

    /**
     * API #1: Create a full CPO with nested fee types, assigned values, and
     * installments.
     */
    @Transactional
    public ComplexPaymentOptionDTO createCpo(ComplexPaymentOptionDTO request, CustomUserDetails userDetails) {
        // Determine CPO status based on caller's role
        // ADMIN / root → ACTIVE immediately
        // Non-ADMIN → PENDING_APPROVAL (requires approval before enrollment use)
        String cpoStatus = isTrustedAdmin(userDetails) ? "ACTIVE" : "PENDING_APPROVAL";

        boolean flexible = CpoScheduleMode.isFlexible(request.getScheduleMode());
        if (request.getScheduleMode() != null && !flexible
                && !CpoScheduleMode.FIXED.name().equalsIgnoreCase(request.getScheduleMode())) {
            throw new VacademyException("schedule_mode must be FIXED or FLEXIBLE");
        }
        if (flexible && hasTemplateInstallments(request)) {
            throw new VacademyException("A flexible fee plan has no fixed installments; "
                    + "the schedule is chosen for each learner at enrollment");
        }
        if (flexible && !hasSplitFee(request)) {
            // Every enrollment on such a plan would fail: there is nothing to schedule.
            throw new VacademyException("A flexible fee plan needs at least one fee that is split into installments");
        }

        ComplexPaymentOption cpo = new ComplexPaymentOption();
        cpo.setName(request.getName());
        cpo.setInstituteId(request.getInstituteId());
        cpo.setDefaultPaymentOptionId(request.getDefaultPaymentOptionId());
        cpo.setStatus(cpoStatus);
        cpo.setCreatedBy(userDetails != null ? userDetails.getUserId() : null);
        cpo.setScheduleMode(flexible ? CpoScheduleMode.FLEXIBLE.name() : CpoScheduleMode.FIXED.name());
        if (flexible && request.getFlexibleDefaults() != null) {
            CpoFlexibleDefaults.write(cpo, request.getFlexibleDefaults());
        }
        ComplexPaymentOption savedCpo = cpoRepository.save(cpo);

        if (request.getFeeTypes() != null) {
            for (ComplexPaymentOptionDTO.FeeTypeDTO ftDTO : request.getFeeTypes()) {
                // 2. Save each FeeType with cpoId
                FeeType feeType = new FeeType();
                feeType.setName(ftDTO.getName());
                feeType.setCode(ftDTO.getCode());
                feeType.setDescription(ftDTO.getDescription());
                feeType.setStatus(ftDTO.getStatus() != null ? ftDTO.getStatus() : "ACTIVE");
                feeType.setCpoId(savedCpo.getId());
                FeeType savedFeeType = feeTypeRepository.save(feeType);

                if (ftDTO.getAssignedFeeValue() != null) {
                    ComplexPaymentOptionDTO.AssignedFeeValueDTO afvDTO = ftDTO.getAssignedFeeValue();
                    // 3. Save AssignedFeeValue with feeTypeId
                    AssignedFeeValue afv = new AssignedFeeValue();
                    afv.setAmount(afvDTO.getAmount());
                    afv.setOriginalAmount(afvDTO.getOriginalAmount());
                    afv.setDiscountType(afvDTO.getDiscountType());
                    afv.setDiscountValue(afvDTO.getDiscountValue());
                    afv.setNoOfInstallments(afvDTO.getNoOfInstallments() != null ? afvDTO.getNoOfInstallments() : 1);
                    // On a flexible plan a fee is split over the learner's schedule unless the
                    // caller marks it as paid upfront (has_installment = false).
                    afv.setHasInstallment(afvDTO.getHasInstallment() != null ? afvDTO.getHasInstallment() : flexible);
                    afv.setIsRefundable(afvDTO.getIsRefundable() != null ? afvDTO.getIsRefundable() : false);
                    afv.setHasPenalty(afvDTO.getHasPenalty() != null ? afvDTO.getHasPenalty() : false);
                    afv.setPenaltyPercentage(afvDTO.getPenaltyPercentage());
                    afv.setStatus(afvDTO.getStatus() != null ? afvDTO.getStatus() : "ACTIVE");
                    afv.setFeeTypeId(savedFeeType.getId());
                    AssignedFeeValue savedAfv = assignedFeeValueRepository.save(afv);

                    if (afvDTO.getInstallments() != null) {
                        for (ComplexPaymentOptionDTO.AftInstallmentDTO instDTO : afvDTO.getInstallments()) {
                            // 4. Save each installment with assignedFeeValueId
                            AftInstallment inst = new AftInstallment();
                            inst.setInstallmentNumber(instDTO.getInstallmentNumber());
                            inst.setAmount(instDTO.getAmount());
                            inst.setDueDate(instDTO.getDueDate());
                            inst.setStartDate(instDTO.getStartDate());
                            inst.setEndDate(instDTO.getEndDate());
                            inst.setStatus(instDTO.getStatus() != null ? instDTO.getStatus() : "PENDING");
                            inst.setAssignedFeeValueId(savedAfv.getId());
                            aftInstallmentRepository.save(inst);
                        }
                    }
                }
            }
        }

        // Mirror this CPO into the unified PaymentOption table (type='CPO') so the
        // strategy pattern, multi-package summing, and learner-side flows can treat
        // it like any other payment option. Also creates a synthetic PaymentPlan
        // whose actualPrice = sum of installments (full contract value).
        paymentOptionService.findOrCreateMirrorForCpo(savedCpo);
        // Apply the admin-approval flag from the request onto the mirror (mirror is
        // created with require_approval=false by default). When true, learners who
        // enroll via this CPO go to PENDING_FOR_APPROVAL until an admin approves.
        paymentOptionService.updateMirrorRequireApproval(
                savedCpo.getId(), Boolean.TRUE.equals(request.getRequireApproval()));

        ComplexPaymentOptionDTO result = getFullCpo(savedCpo.getId());

        // Step 5: Link CPO to requested (enrollInviteId, packageSessionId) pairs
        if (request.getPackageSessionLinks() != null && !request.getPackageSessionLinks().isEmpty()) {
            for (ComplexPaymentOptionDTO.PackageSessionLinkDTO link : request.getPackageSessionLinks()) {
                if (link.getPackageSessionId() == null || link.getPackageSessionId().isBlank()) {
                    continue; // skip entries with no packageSessionId
                }

                // Resolve enrollInviteId: use provided value, or auto-find the DEFAULT invite
                String resolvedEnrollInviteId = link.getEnrollInviteId();
                if (!StringUtils.hasText(resolvedEnrollInviteId)) {
                    resolvedEnrollInviteId = enrollInviteRepository
                            .findLatestForPackageSessionWithFilters(
                                    link.getPackageSessionId(),
                                    List.of("ACTIVE"),
                                    List.of(EnrollInviteTag.DEFAULT.name()),
                                    List.of("ACTIVE"))
                            .map(EnrollInvite::getId)
                            .orElseThrow(() -> new VacademyException(
                                    "No default EnrollInvite found for package session: "
                                            + link.getPackageSessionId()
                                            + ". Please create a default invite first, or pass enrollInviteId explicitly."));
                }

                AssignCpoToPackageSessionDTO dto = new AssignCpoToPackageSessionDTO(
                        savedCpo.getId(), link.getPackageSessionId());
                packageSessionEnrollInviteToPaymentOptionService
                        .assignCpoToPackageSession(resolvedEnrollInviteId, dto);
            }
        }

        return result;
    }

    /** On a flexible plan a fee is split unless it is explicitly marked has_installment = false. */
    private static boolean hasSplitFee(ComplexPaymentOptionDTO request) {
        if (request.getFeeTypes() == null) return false;
        return request.getFeeTypes().stream()
                .map(ComplexPaymentOptionDTO.FeeTypeDTO::getAssignedFeeValue)
                .anyMatch(afv -> afv != null && !Boolean.FALSE.equals(afv.getHasInstallment()));
    }

    private static boolean hasTemplateInstallments(ComplexPaymentOptionDTO request) {
        if (request.getFeeTypes() == null) return false;
        return request.getFeeTypes().stream()
                .map(ComplexPaymentOptionDTO.FeeTypeDTO::getAssignedFeeValue)
                .anyMatch(afv -> afv != null && afv.getInstallments() != null && !afv.getInstallments().isEmpty());
    }

    /**
     * API #2: List all CPOs for an institute (lightweight - no nested children).
     */
    public Page<ComplexPaymentOptionDTO> listCposByInstitute(String instituteId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<ComplexPaymentOption> cposPage = cpoRepository.findByInstituteIdAndStatusNotAndSourcePaymentPlanIdIsNull(instituteId, "DELETED", pageable);

        if (!cposPage.hasContent()) {
            return cposPage.map(cpo -> ComplexPaymentOptionDTO.builder().id(cpo.getId()).build());
        }

        List<String> cpoIds = cposPage.getContent().stream().map(ComplexPaymentOption::getId).collect(Collectors.toList());

        // 1. Fetch all fee types for these CPOs
        List<FeeType> allFeeTypes = feeTypeRepository.findByCpoIdInAndStatusNot(cpoIds, "DELETED");
        Map<String, List<FeeType>> feeTypesByCpoId = allFeeTypes.stream()
                .collect(Collectors.groupingBy(FeeType::getCpoId));

        // 2. Fetch all assigned fee values for these fee types
        List<String> feeTypeIds = allFeeTypes.stream().map(FeeType::getId).collect(Collectors.toList());
        List<AssignedFeeValue> allAssignedValues = feeTypeIds.isEmpty() ? new ArrayList<>() 
                : assignedFeeValueRepository.findByFeeTypeIdInAndStatusNot(feeTypeIds, "DELETED");
        Map<String, AssignedFeeValue> afvByFeeTypeId = new HashMap<>();
        for (AssignedFeeValue afv : allAssignedValues) {
            afvByFeeTypeId.putIfAbsent(afv.getFeeTypeId(), afv);
        }

        return cposPage.map(cpo -> {
            // Mapping Fee Types and Assigned Fee Values
            List<FeeType> cpoFeeTypes = feeTypesByCpoId.getOrDefault(cpo.getId(), new ArrayList<>());
            List<ComplexPaymentOptionDTO.FeeTypeDTO> feeTypeDTOs = cpoFeeTypes.stream().map(ft -> {
                AssignedFeeValue afv = afvByFeeTypeId.get(ft.getId());
                ComplexPaymentOptionDTO.AssignedFeeValueDTO afvDTO = null;

                if (afv != null) {
                    afvDTO = ComplexPaymentOptionDTO.AssignedFeeValueDTO.builder()
                            .id(afv.getId())
                            .amount(afv.getAmount())
                            .originalAmount(afv.getOriginalAmount())
                            .discountType(afv.getDiscountType())
                            .discountValue(afv.getDiscountValue())
                            .noOfInstallments(afv.getNoOfInstallments())
                            .hasInstallment(afv.getHasInstallment())
                            .isRefundable(afv.getIsRefundable())
                            .hasPenalty(afv.getHasPenalty())
                            .penaltyPercentage(afv.getPenaltyPercentage())
                            .status(afv.getStatus())
                            // Intentional: NO installments
                            .build();
                }

                return ComplexPaymentOptionDTO.FeeTypeDTO.builder()
                        .id(ft.getId())
                        .name(ft.getName())
                        .code(ft.getCode())
                        .description(ft.getDescription())
                        .status(ft.getStatus())
                        .assignedFeeValue(afvDTO)
                        .build();
            }).collect(Collectors.toList());

            // Mapping Links
            List<PackageSessionLearnerInvitationToPaymentOption> links = bridgeRepository.findByCpoId(cpo.getId());
            List<ComplexPaymentOptionDTO.PackageSessionLinkDTO> linkDTOs = links.stream()
                    .map(l -> ComplexPaymentOptionDTO.PackageSessionLinkDTO.builder()
                            .packageSessionId(l.getPackageSession() != null ? l.getPackageSession().getId() : null)
                            .enrollInviteId(l.getEnrollInvite() != null ? l.getEnrollInvite().getId() : null)
                            .build())
                    .collect(Collectors.toList());

            return ComplexPaymentOptionDTO.builder()
                    .id(cpo.getId())
                    .name(cpo.getName())
                    .instituteId(cpo.getInstituteId())
                    .defaultPaymentOptionId(cpo.getDefaultPaymentOptionId())
                    .status(cpo.getStatus())
                    .createdBy(cpo.getCreatedBy())
                    .approvedBy(cpo.getApprovedBy())
                    .scheduleMode(cpo.getScheduleMode())
                    .flexibleDefaults(CpoFlexibleDefaults.read(cpo))
                    .feeTypes(feeTypeDTOs)
                    .packageSessionLinks(linkDTOs)
                    .build();
        });
    }

    /**
     * API #3: Get full CPO with all nested children (fee types → assigned values →
     * installments).
     */
    public ComplexPaymentOptionDTO getFullCpo(String cpoId) {
        ComplexPaymentOption cpo = cpoRepository.findByIdAndStatusNot(cpoId, "DELETED")
                .orElseThrow(() -> new VacademyException("Complex Payment Option not found or deleted: " + cpoId));

        // Default "full" behavior (no pagination params passed)
        return getFullCpo(cpoId, 0, Integer.MAX_VALUE, 0, Integer.MAX_VALUE);
    }

    public ComplexPaymentOptionDTO getFullCpo(String cpoId, int feeTypePage, int feeTypeSize, int installmentPage,
            int installmentSize) {
        ComplexPaymentOption cpo = cpoRepository.findByIdAndStatusNot(cpoId, "DELETED")
                .orElseThrow(() -> new VacademyException("Complex Payment Option not found or deleted: " + cpoId));

        // Fetch fee types by cpoId
        Pageable feeTypePageable = PageRequest.of(feeTypePage, feeTypeSize);
        List<FeeType> feeTypes = feeTypeRepository
                .findByCpoIdAndStatusNot(cpo.getId(), "DELETED", feeTypePageable)
                .getContent();

        List<ComplexPaymentOptionDTO.FeeTypeDTO> feeTypeDTOs = new ArrayList<>();
        for (FeeType ft : feeTypes) {
            // Fetch assigned fee values by feeTypeId
            List<AssignedFeeValue> afvList = assignedFeeValueRepository.findByFeeTypeIdAndStatusNot(ft.getId(),
                    "DELETED");

            ComplexPaymentOptionDTO.AssignedFeeValueDTO afvDTO = null;
            if (!afvList.isEmpty()) {
                AssignedFeeValue afv = afvList.get(0); // One AFV per fee type
                // Fetch installments by assignedFeeValueId
                Pageable installmentPageable = PageRequest.of(installmentPage, installmentSize);
                List<AftInstallment> installments = aftInstallmentRepository
                        .findByAssignedFeeValueIdAndStatusNotOrderByInstallmentNumberAsc(afv.getId(), "DELETED",
                                installmentPageable)
                        .getContent();

                List<ComplexPaymentOptionDTO.AftInstallmentDTO> instDTOs = installments.stream()
                        .map(inst -> ComplexPaymentOptionDTO.AftInstallmentDTO.builder()
                                .id(inst.getId())
                                .installmentNumber(inst.getInstallmentNumber())
                                .amount(inst.getAmount())
                                .dueDate(inst.getDueDate())
                                .startDate(inst.getStartDate())
                                .endDate(inst.getEndDate())
                                .status(inst.getStatus())
                                .build())
                        .collect(Collectors.toList());

                afvDTO = ComplexPaymentOptionDTO.AssignedFeeValueDTO.builder()
                        .id(afv.getId())
                        .amount(afv.getAmount())
                        .originalAmount(afv.getOriginalAmount())
                        .discountType(afv.getDiscountType())
                        .discountValue(afv.getDiscountValue())
                        .noOfInstallments(afv.getNoOfInstallments())
                        .hasInstallment(afv.getHasInstallment())
                        .isRefundable(afv.getIsRefundable())
                        .hasPenalty(afv.getHasPenalty())
                        .penaltyPercentage(afv.getPenaltyPercentage())
                        .status(afv.getStatus())
                        .installments(instDTOs)
                        .build();
            }

            feeTypeDTOs.add(ComplexPaymentOptionDTO.FeeTypeDTO.builder()
                    .id(ft.getId())
                    .name(ft.getName())
                    .code(ft.getCode())
                    .description(ft.getDescription())
                    .status(ft.getStatus())
                    .assignedFeeValue(afvDTO)
                    .build());
        }

        List<PackageSessionLearnerInvitationToPaymentOption> links = bridgeRepository.findByCpoId(cpoId);
        List<ComplexPaymentOptionDTO.PackageSessionLinkDTO> linkDTOs = links.stream()
                .map(l -> ComplexPaymentOptionDTO.PackageSessionLinkDTO.builder()
                        .packageSessionId(l.getPackageSession() != null ? l.getPackageSession().getId() : null)
                        .enrollInviteId(l.getEnrollInvite() != null ? l.getEnrollInvite().getId() : null)
                        .build())
                .collect(Collectors.toList());

        return ComplexPaymentOptionDTO.builder()
                .id(cpo.getId())
                .name(cpo.getName())
                .instituteId(cpo.getInstituteId())
                .defaultPaymentOptionId(cpo.getDefaultPaymentOptionId())
                .status(cpo.getStatus())
                .createdBy(cpo.getCreatedBy())
                .approvedBy(cpo.getApprovedBy())
                .requireApproval(paymentOptionService.getMirrorRequireApproval(cpo.getId()))
                .scheduleMode(cpo.getScheduleMode())
                .flexibleDefaults(CpoFlexibleDefaults.read(cpo))
                .feeTypes(feeTypeDTOs)
                .packageSessionLinks(linkDTOs)
                .build();
    }

    /**
     * API #8 (new): Approve a PENDING_APPROVAL CPO.
     * Moves status from PENDING_APPROVAL → ACTIVE and records who approved it.
     */
    @Transactional
    public ComplexPaymentOptionDTO approveCpo(String cpoId, CustomUserDetails userDetails) {
        ComplexPaymentOption cpo = cpoRepository.findById(cpoId)
                .orElseThrow(() -> new VacademyException("Complex Payment Option not found: " + cpoId));

        if (!"PENDING_APPROVAL".equalsIgnoreCase(cpo.getStatus())) {
            throw new VacademyException(
                    "CPO is not pending approval. Current status: " + cpo.getStatus());
        }

        cpo.setStatus("ACTIVE");
        cpo.setApprovedBy(userDetails != null ? userDetails.getUserId() : null);
        cpoRepository.save(cpo);

        paymentOptionService.syncMirrorForCpo(cpo);

        return getFullCpo(cpoId);
    }

    @Transactional
    public ComplexPaymentOptionDTO updateCpo(String cpoId, ComplexPaymentOptionDTO request) {
        ComplexPaymentOption cpo = cpoRepository.findById(cpoId)
                .orElseThrow(() -> new VacademyException("Complex Payment Option not found: " + cpoId));

        if (request.getName() != null)
            cpo.setName(request.getName());
        if (request.getInstituteId() != null)
            cpo.setInstituteId(request.getInstituteId());
        if (request.getDefaultPaymentOptionId() != null)
            cpo.setDefaultPaymentOptionId(request.getDefaultPaymentOptionId());
        if (request.getStatus() != null)
            cpo.setStatus(request.getStatus());
        if (request.getFlexibleDefaults() != null) {
            if (!CpoScheduleMode.isFlexible(cpo.getScheduleMode())) {
                throw new VacademyException("Installment defaults only apply to flexible fee plans");
            }
            CpoFlexibleDefaults.write(cpo, request.getFlexibleDefaults());
        }

        cpoRepository.save(cpo);
        paymentOptionService.syncMirrorForCpo(cpo);
        // Only touch the approval flag when the caller explicitly sent it, so update
        // paths that omit it (e.g. fee-only edits) leave the existing value intact.
        if (request.getRequireApproval() != null) {
            paymentOptionService.updateMirrorRequireApproval(cpo.getId(), request.getRequireApproval());
        }
        return getFullCpo(cpoId);
    }

    /**
     * API #6: Soft delete CPO and all related records by status update.
     * Marks status as "DELETED" for:
     * - ComplexPaymentOption
     * - FeeType (linked via cpoId)
     * - AssignedFeeValue (linked via feeTypeId)
     * - AftInstallment (linked via assignedFeeValueId)
     * Only records currently in "ACTIVE" or "PENDING" status are updated.
     */
    @Transactional
    public ComplexPaymentOptionDTO softDeleteCpoById(String cpoId) {
        ComplexPaymentOption cpo = cpoRepository.findById(cpoId)
                .orElseThrow(() -> new VacademyException("Complex Payment Option not found: " + cpoId));

        if ("ACTIVE".equalsIgnoreCase(cpo.getStatus()) || "PENDING".equalsIgnoreCase(cpo.getStatus())) {
            cpo.setStatus("DELETED");
            cpoRepository.save(cpo);
        }

        List<FeeType> feeTypes = feeTypeRepository.findByCpoId(cpoId);
        for (FeeType feeType : feeTypes) {
            if ("ACTIVE".equalsIgnoreCase(feeType.getStatus()) || "PENDING".equalsIgnoreCase(feeType.getStatus())) {
                feeType.setStatus("DELETED");
                feeTypeRepository.save(feeType);
            }

            List<AssignedFeeValue> assignedFeeValues = assignedFeeValueRepository.findByFeeTypeId(feeType.getId());
            for (AssignedFeeValue afv : assignedFeeValues) {
                if ("ACTIVE".equalsIgnoreCase(afv.getStatus()) || "PENDING".equalsIgnoreCase(afv.getStatus())) {
                    afv.setStatus("DELETED");
                    assignedFeeValueRepository.save(afv);
                }

                List<AftInstallment> installments = aftInstallmentRepository
                        .findByAssignedFeeValueIdOrderByInstallmentNumberAsc(afv.getId());
                for (AftInstallment inst : installments) {
                    if ("ACTIVE".equalsIgnoreCase(inst.getStatus()) || "PENDING".equalsIgnoreCase(inst.getStatus())) {
                        inst.setStatus("DELETED");
                        aftInstallmentRepository.save(inst);
                    }
                }
            }
        }

        paymentOptionService.syncMirrorForCpo(cpo);

        return getFullCpo(cpoId);
    }

    /**
     * API #5: Update Fee Type & Commercials (Cascade Update)
     */
    @Transactional
    public ComplexPaymentOptionDTO.FeeTypeDTO updateFeeType(String feeTypeId,
            ComplexPaymentOptionDTO.FeeTypeDTO request) {
        // 1. Update FeeType
        FeeType feeType = feeTypeRepository.findById(feeTypeId)
                .orElseThrow(() -> new VacademyException("Fee Type not found: " + feeTypeId));

        if (request.getName() != null)
            feeType.setName(request.getName());
        if (request.getCode() != null)
            feeType.setCode(request.getCode());
        if (request.getDescription() != null)
            feeType.setDescription(request.getDescription());
        if (request.getStatus() != null)
            feeType.setStatus(request.getStatus());
        feeTypeRepository.save(feeType);

        // 2. Update AssignedFeeValue
        if (request.getAssignedFeeValue() != null) {
            ComplexPaymentOptionDTO.AssignedFeeValueDTO afvDTO = request.getAssignedFeeValue();

            // Check if exists, else create (though usually should exist for an update)
            List<AssignedFeeValue> existingAfvs = assignedFeeValueRepository.findByFeeTypeId(feeTypeId);
            AssignedFeeValue afv;

            if (existingAfvs.isEmpty()) {
                afv = new AssignedFeeValue();
                afv.setFeeTypeId(feeTypeId);
                afv.setStatus("ACTIVE");
            } else {
                afv = existingAfvs.get(0);
            }

            if (afvDTO.getAmount() != null)
                afv.setAmount(afvDTO.getAmount());
            if (afvDTO.getOriginalAmount() != null)
                afv.setOriginalAmount(afvDTO.getOriginalAmount());
            if (afvDTO.getDiscountType() != null)
                afv.setDiscountType(afvDTO.getDiscountType());
            if (afvDTO.getDiscountValue() != null)
                afv.setDiscountValue(afvDTO.getDiscountValue());
            if (afvDTO.getNoOfInstallments() != null)
                afv.setNoOfInstallments(afvDTO.getNoOfInstallments());
            if (afvDTO.getHasInstallment() != null)
                afv.setHasInstallment(afvDTO.getHasInstallment());
            if (afvDTO.getIsRefundable() != null)
                afv.setIsRefundable(afvDTO.getIsRefundable());
            if (afvDTO.getHasPenalty() != null)
                afv.setHasPenalty(afvDTO.getHasPenalty());
            if (afvDTO.getPenaltyPercentage() != null)
                afv.setPenaltyPercentage(afvDTO.getPenaltyPercentage());
            if (afvDTO.getStatus() != null)
                afv.setStatus(afvDTO.getStatus());

            AssignedFeeValue savedAfv = assignedFeeValueRepository.save(afv);

            // 3. Update Installments (Delete & Recreate)
            if (afvDTO.getInstallments() != null) {
                // Delete existing
                List<AftInstallment> existingInstallments = aftInstallmentRepository
                        .findByAssignedFeeValueIdOrderByInstallmentNumberAsc(savedAfv.getId());
                aftInstallmentRepository.deleteAll(existingInstallments);

                // Create new
                for (ComplexPaymentOptionDTO.AftInstallmentDTO instDTO : afvDTO.getInstallments()) {
                    AftInstallment inst = new AftInstallment();
                    inst.setInstallmentNumber(instDTO.getInstallmentNumber());
                    inst.setAmount(instDTO.getAmount());
                    inst.setDueDate(instDTO.getDueDate());
                    inst.setStartDate(instDTO.getStartDate());
                    inst.setEndDate(instDTO.getEndDate());
                    inst.setStatus(instDTO.getStatus() != null ? instDTO.getStatus() : "PENDING");
                    inst.setAssignedFeeValueId(savedAfv.getId());
                    aftInstallmentRepository.save(inst);
                }
            }
        }

        // Re-sync the mirror PaymentOption + synthetic plan because the fee structure
        // (and therefore the total contract value / validity) may have changed.
        cpoRepository.findById(feeType.getCpoId())
                .ifPresent(paymentOptionService::syncMirrorForCpo);

        return request;
    }

    /**
     * Get all CPO options available for a package session (class).
     * Returns full CPO details with total amount calculation.
     */
    public List<ComplexPaymentOptionDTO> getCpoOptionsForPackageSession(String packageSessionId) {
        // Step 1: Query bridge table for distinct CPO IDs
        List<String> cpoIds = bridgeRepository.findDistinctCpoIdsByPackageSessionId(packageSessionId);

        if (cpoIds.isEmpty()) {
            return new ArrayList<>();
        }

        // Step 2: Fetch full CPO details for each ID
        List<ComplexPaymentOptionDTO> cpoOptions = new ArrayList<>();
        for (String cpoId : cpoIds) {
            try {
                ComplexPaymentOptionDTO cpoDTO = getFullCpo(cpoId);

                // Step 3: Calculate total amount from all installments
                BigDecimal totalAmount = BigDecimal.ZERO;
                if (cpoDTO.getFeeTypes() != null) {
                    for (ComplexPaymentOptionDTO.FeeTypeDTO feeType : cpoDTO.getFeeTypes()) {
                        if (feeType.getAssignedFeeValue() != null &&
                                feeType.getAssignedFeeValue().getInstallments() != null) {
                            for (ComplexPaymentOptionDTO.AftInstallmentDTO installment : feeType.getAssignedFeeValue()
                                    .getInstallments()) {
                                if (installment.getAmount() != null) {
                                    totalAmount = totalAmount.add(installment.getAmount());
                                }
                            }
                        }
                    }
                }

                cpoOptions.add(cpoDTO);
            } catch (Exception e) {
                // Skip invalid CPOs and continue
                continue;
            }
        }

        return cpoOptions;
    }
}
