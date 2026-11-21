package vacademy.io.admin_core_service.features.onboarding.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingInstanceSummaryDTO;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingFlow;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingInstance;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStep;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingInstanceStatus;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingFlowRepository;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingInstanceRepository;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingStepRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Starts and looks up onboarding_instance runs. Manual starts always name one explicit
 * flow_id; auto-starts (via the workflow engine's START_ONBOARDING_FLOW node) also always
 * name one explicit flow_id in the node's config -- no attribute-based flow matching in v1.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OnboardingInstanceService {

    private final OnboardingInstanceRepository onboardingInstanceRepository;
    private final OnboardingStepRepository onboardingStepRepository;
    private final OnboardingFlowRepository onboardingFlowRepository;
    private final OnboardingStepInstanceService stepInstanceService;
    private final OnboardingTriggerContextBuilder triggerContextBuilder;
    private final AuthService authService;

    @Autowired
    @Lazy
    private WorkflowTriggerService workflowTriggerService;

    @Transactional
    public OnboardingInstance startInstance(String flowId, String subjectUserId, String instituteId,
                                             String startedBy, String startedByUserId,
                                             String sourceEventName, String sourceEventId) {
        OnboardingInstance instance = OnboardingInstance.builder()
                .flowId(flowId)
                .instituteId(instituteId)
                .subjectUserId(subjectUserId)
                .status(OnboardingInstanceStatus.IN_PROGRESS.name())
                .startedBy(startedBy)
                .startedByUserId(startedByUserId)
                .sourceEventName(sourceEventName)
                .sourceEventId(sourceEventId)
                .startedAt(new Date())
                .build();
        instance = onboardingInstanceRepository.save(instance);
        final OnboardingInstance savedInstance = instance;

        try {
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.ONBOARDING_FLOW_STARTED.name(),
                    flowId,
                    instituteId,
                    triggerContextBuilder.forFlowChange(instance, "STARTED"));
        } catch (Exception e) {
            log.warn("Failed to fire ONBOARDING_FLOW_STARTED for flow {}: {}", flowId, e.getMessage());
        }

        Optional<OnboardingStep> firstStep =
                onboardingStepRepository.findFirstByFlowIdAndStatusOrderByStepOrderAsc(flowId, "ACTIVE");
        firstStep.ifPresent(step -> stepInstanceService.enterStep(savedInstance, step));

        return savedInstance;
    }

    public OnboardingInstance getInstance(String instanceId) {
        return onboardingInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new ResourceNotFoundException("Onboarding instance not found: " + instanceId));
    }

    /**
     * Every instance visible from this profile's side-view -- matches instances originally
     * started for this person AND instances where they were later resolved as the real student
     * (a parent filled the lead form; this person is the child that got created/linked).
     */
    public List<OnboardingInstance> listBySubject(String subjectUserId, String instituteId) {
        return onboardingInstanceRepository.findVisibleToUser(subjectUserId, instituteId);
    }

    /**
     * Instance counts per status for the dashboard cards (one grouped query, no enrichment),
     * plus ALL. Same institute / flow filter as {@link #searchInstances}.
     */
    public Map<String, Long> statusCounts(String instituteId, String flowId) {
        Map<String, Long> out = new java.util.LinkedHashMap<>();
        long all = 0;
        for (Object[] row : onboardingInstanceRepository.countByStatus(
                instituteId, StringUtils.hasText(flowId) ? flowId : null)) {
            long n = row[1] == null ? 0 : ((Number) row[1]).longValue();
            if (row[0] != null) out.put(String.valueOf(row[0]), n);
            all += n;
        }
        out.put("ALL", all);
        return out;
    }

    /**
     * Powers the onboarding management dashboard: every instance for the institute (optionally
     * narrowed to one flow/status), enriched with the subject/flow/current-step names the raw
     * row can't carry itself. Names are batch-resolved for the current page only, not the whole
     * table, so this stays cheap regardless of how many onboarding instances an institute has.
     */
    public Page<OnboardingInstanceSummaryDTO> searchInstances(String instituteId, String flowId, String status,
                                                               int pageNo, int pageSize) {
        Pageable pageable = PageRequest.of(pageNo, pageSize);
        Page<OnboardingInstance> page = onboardingInstanceRepository.searchInstances(
                instituteId, StringUtils.hasText(flowId) ? flowId : null,
                StringUtils.hasText(status) ? status : null, pageable);
        List<OnboardingInstance> instances = page.getContent();
        if (instances.isEmpty()) return new PageImpl<>(List.of(), pageable, page.getTotalElements());

        Map<String, String> flowNames = onboardingFlowRepository
                .findAllById(instances.stream().map(OnboardingInstance::getFlowId).distinct().toList())
                .stream().collect(Collectors.toMap(OnboardingFlow::getId, OnboardingFlow::getName));

        List<String> stepIds = instances.stream().map(OnboardingInstance::getCurrentStepId)
                .filter(StringUtils::hasText).distinct().toList();
        Map<String, String> stepNames = stepIds.isEmpty() ? Map.of() : onboardingStepRepository.findAllById(stepIds)
                .stream().collect(Collectors.toMap(OnboardingStep::getId, OnboardingStep::getStepName));

        List<String> subjectIds = instances.stream()
                .flatMap(i -> Stream.of(i.getSubjectUserId(), i.getResolvedSubjectUserId()))
                .filter(StringUtils::hasText).distinct().toList();
        Map<String, UserDTO> usersById = authService.getUsersFromAuthServiceByUserIds(subjectIds)
                .stream().collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));

        List<OnboardingInstanceSummaryDTO> content = instances.stream().map(instance -> {
            UserDTO subject = usersById.get(instance.getSubjectUserId());
            UserDTO resolvedSubject = StringUtils.hasText(instance.getResolvedSubjectUserId())
                    ? usersById.get(instance.getResolvedSubjectUserId()) : null;
            return OnboardingInstanceSummaryDTO.builder()
                    .id(instance.getId())
                    .flowId(instance.getFlowId())
                    .flowName(flowNames.get(instance.getFlowId()))
                    .subjectUserId(instance.getSubjectUserId())
                    .subjectName(subject != null ? subject.getFullName() : null)
                    .subjectEmail(subject != null ? subject.getEmail() : null)
                    .resolvedSubjectName(resolvedSubject != null ? resolvedSubject.getFullName() : null)
                    .currentStepId(instance.getCurrentStepId())
                    .currentStepName(instance.getCurrentStepId() != null
                            ? stepNames.get(instance.getCurrentStepId()) : null)
                    .status(instance.getStatus())
                    .startedBy(instance.getStartedBy())
                    .startedAt(instance.getStartedAt())
                    .completedAt(instance.getCompletedAt())
                    .build();
        }).toList();

        return new PageImpl<>(content, pageable, page.getTotalElements());
    }
}
