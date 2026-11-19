package vacademy.io.admin_core_service.features.workflow.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.workflow.entity.NodeTemplate;
import vacademy.io.admin_core_service.features.workflow.entity.Workflow;
import vacademy.io.admin_core_service.features.workflow.repository.NodeTemplateRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowExecutionRepository;
import vacademy.io.admin_core_service.features.workflow.repository.WorkflowRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Who may read, edit and run an institute's automations: staff of the institute that owns the
 * automation (clientId header = that institute, a staff role there), or a platform super admin
 * on the SUPER_ADMIN_USER_IDS allow-list.
 */
@Component
@RequiredArgsConstructor
public class WorkflowAccessGuard {

    private final InstituteAccessValidator instituteAccessValidator;
    private final WorkflowRepository workflowRepository;
    private final WorkflowExecutionRepository workflowExecutionRepository;
    private final NodeTemplateRepository nodeTemplateRepository;

    /** Staff of {@code instituteId}, or a super admin. */
    public void requireStaff(CustomUserDetails user, String instituteId) {
        try {
            instituteAccessValidator.requireInstituteStaff(user, instituteId);
        } catch (VacademyException | ForbiddenException refused) {
            if (isSuperAdmin(user)) {
                return;
            }
            throw refused;
        }
    }

    /**
     * {@link #requireStaff} for the institute-wide list reads, behind
     * security.institute-guards.enforce: off (default) they stay open as before and a caller the
     * check would refuse is logged as INSTITUTE_GUARD_WOULD_REFUSE; on, the check applies. Some
     * callers do not send a clientId equal to the institute they list (the legacy in-app agent
     * sends none; the bulk-enrol preview takes the institute from the token), so this is
     * measured before it is enforced.
     */
    public void requireStaffForList(String route, CustomUserDetails user, String instituteId) {
        instituteAccessValidator.guard(route, user, () -> instituteId, this::requireStaff, () -> { });
    }

    /** Staff of the institute that owns the workflow (or a super admin); returns the workflow. */
    public Workflow requireStaffForWorkflow(CustomUserDetails user, String workflowId) {
        Workflow workflow = workflowRepository.findById(workflowId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Workflow not found: " + workflowId));
        requireStaff(user, workflow.getInstituteId());
        return workflow;
    }

    /** Staff of the institute whose workflow produced the execution (or a super admin). */
    public void requireStaffForExecution(CustomUserDetails user, String executionId) {
        String instituteId = workflowExecutionRepository.findInstituteIdByExecutionId(executionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Execution not found: " + executionId));
        requireStaff(user, instituteId);
    }

    /** Staff of the institute that owns the node template (or a super admin). */
    public void requireStaffForNodeTemplate(CustomUserDetails user, String nodeTemplateId) {
        NodeTemplate template = nodeTemplateRepository.findById(nodeTemplateId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Node template not found: " + nodeTemplateId));
        requireStaff(user, template.getInstituteId());
    }

    /** Platform super admins only (reads that span every institute). */
    public void requireSuperAdmin(CustomUserDetails user) {
        SuperAdminAuthUtil.requireSuperAdmin(user);
    }

    private static boolean isSuperAdmin(CustomUserDetails user) {
        if (user == null) {
            return false;
        }
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            return true;
        } catch (VacademyException notAllowListed) {
            return false;
        }
    }
}
