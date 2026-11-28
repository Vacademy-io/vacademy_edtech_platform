package vacademy.io.admin_core_service.features.hr_salary.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.expression.Expression;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_salary.dto.*;
import vacademy.io.admin_core_service.features.hr_salary.entity.*;
import vacademy.io.admin_core_service.features.hr_salary.enums.CalculationType;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentCategory;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentType;
import vacademy.io.admin_core_service.features.hr_salary.repository.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class SalaryStructureService {

    private static final String DEFAULT_CURRENCY = "INR";
    private static final String SPECIAL_ALLOWANCE_CODE = "SPECIAL_ALLOWANCE";
    /** Annual rounding tolerance (1 rupee) for the CTC tie-out. */
    private static final BigDecimal CTC_TOLERANCE = BigDecimal.ONE;

    private static final SpelExpressionParser SPEL_PARSER = new SpelExpressionParser();

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private EmployeeSalaryStructureRepository salaryStructureRepository;

    @Autowired
    private EmployeeSalaryComponentRepository salaryComponentRepository;

    @Autowired
    private SalaryComponentRepository masterComponentRepository;

    @Autowired
    private SalaryTemplateRepository salaryTemplateRepository;

    @Autowired
    private SalaryTemplateComponentRepository salaryTemplateComponentRepository;

    @Autowired
    private SalaryRevisionRepository salaryRevisionRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    /**
     * Assigns a salary structure to an employee based on a template and CTC.
     * Handles component resolution order: Basic first, then percentage-of-basic,
     * then gross-dependent components, then formulas — followed by a CTC tie-out.
     */
    @Transactional
    public String assignSalary(AssignSalaryDTO dto, String instituteId, String approverUserId) {
        // Validate inputs
        if (!StringUtils.hasText(dto.getEmployeeId())) {
            throw new VacademyException("Employee ID is required");
        }
        if (!StringUtils.hasText(dto.getTemplateId())) {
            throw new VacademyException("Template ID is required");
        }
        if (dto.getCtcAnnual() == null || dto.getCtcAnnual().compareTo(BigDecimal.ZERO) <= 0) {
            throw new VacademyException("CTC annual must be a positive value");
        }
        if (dto.getEffectiveFrom() == null) {
            throw new VacademyException("Effective from date is required");
        }

        // 1. Find EmployeeProfile — must belong to the validated institute (cross-tenant IDOR fix)
        EmployeeProfile employee = employeeProfileRepository.findById(dto.getEmployeeId())
                .orElseThrow(() -> new VacademyException("Employee not found with id: " + dto.getEmployeeId()));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        // 2. Find and supersede any active structure (effective-dated revision).
        // The old structure ends the day before the new one starts, so payroll's
        // effective-date selection has real, non-overlapping windows to pick from.
        BigDecimal oldCtc = null;
        EmployeeSalaryStructure oldStructure = null;

        Optional<EmployeeSalaryStructure> activeStructureOpt = salaryStructureRepository
                .findFirstByEmployee_IdAndStatusOrderByEffectiveFromDesc(dto.getEmployeeId(), "ACTIVE");

        if (activeStructureOpt.isPresent()) {
            oldStructure = activeStructureOpt.get();
            oldCtc = oldStructure.getCtcAnnual();

            if (!oldStructure.getEffectiveFrom().isBefore(dto.getEffectiveFrom())) {
                throw new VacademyException(
                        "New salary structure must start after the current structure's effective date ("
                        + oldStructure.getEffectiveFrom() + "). Backdating over an existing structure is not supported.");
            }

            oldStructure.setStatus("SUPERSEDED");
            oldStructure.setEffectiveTo(dto.getEffectiveFrom().minusDays(1));
            salaryStructureRepository.save(oldStructure);
        }

        // 3. Load template — must belong to the validated institute (cross-tenant IDOR fix)
        SalaryTemplate template = salaryTemplateRepository.findById(dto.getTemplateId())
                .orElseThrow(() -> new VacademyException("Salary template not found with id: " + dto.getTemplateId()));
        hrAccessGuard.requireInstituteMatch(template.getInstituteId(), instituteId, "Salary template");

        // 4. Create new EmployeeSalaryStructure
        BigDecimal ctcMonthly = dto.getCtcAnnual().divide(BigDecimal.valueOf(12), 2, RoundingMode.HALF_UP);

        EmployeeSalaryStructure newStructure = new EmployeeSalaryStructure();
        newStructure.setEmployee(employee);
        newStructure.setTemplate(template);
        newStructure.setEffectiveFrom(dto.getEffectiveFrom());
        newStructure.setCtcAnnual(dto.getCtcAnnual());
        newStructure.setCtcMonthly(ctcMonthly);
        newStructure.setStatus("ACTIVE");
        newStructure.setCurrency(normalizeCurrency(dto.getCurrency()));
        newStructure.setRevisionReason(dto.getRevisionReason());
        newStructure.setApprovedBy(approverUserId);
        newStructure.setApprovedAt(LocalDateTime.now());

        newStructure = salaryStructureRepository.save(newStructure);

        // 5. Load template components
        List<SalaryTemplateComponent> templateComponents = salaryTemplateComponentRepository
                .findByTemplateIdOrderByDisplayOrderAsc(dto.getTemplateId());

        if (templateComponents.isEmpty()) {
            throw new VacademyException("Template has no components defined");
        }

        // 6. Build override map: componentId -> monthlyAmount
        Map<String, BigDecimal> overrideMap = new HashMap<>();
        if (dto.getComponentOverrides() != null) {
            for (ComponentOverrideDTO override : dto.getComponentOverrides()) {
                if (StringUtils.hasText(override.getComponentId()) && override.getMonthlyAmount() != null) {
                    overrideMap.put(override.getComponentId(), override.getMonthlyAmount());
                }
            }
        }

        // 7. Calculate component amounts in dependency order (includes CTC tie-out)
        List<EmployeeSalaryComponent> calculatedComponents = calculateComponentAmounts(
                templateComponents, dto.getCtcAnnual(), ctcMonthly, overrideMap, newStructure, instituteId);

        // 8. Save all employee salary components
        salaryComponentRepository.saveAll(calculatedComponents);
        newStructure.setComponents(calculatedComponents);

        // 9. Calculate grossMonthly = sum of EARNING components
        BigDecimal grossMonthly = calculatedComponents.stream()
                .filter(c -> ComponentType.EARNING.name().equals(c.getComponent().getType()))
                .map(EmployeeSalaryComponent::getMonthlyAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        // 10. Calculate netMonthly = grossMonthly - sum of DEDUCTION components
        BigDecimal totalDeductions = calculatedComponents.stream()
                .filter(c -> ComponentType.DEDUCTION.name().equals(c.getComponent().getType()))
                .map(EmployeeSalaryComponent::getMonthlyAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal netMonthly = grossMonthly.subtract(totalDeductions);

        newStructure.setGrossMonthly(grossMonthly);
        newStructure.setNetMonthly(netMonthly);
        salaryStructureRepository.save(newStructure);

        // 11. Create SalaryRevision record
        SalaryRevision revision = new SalaryRevision();
        revision.setEmployee(employee);
        revision.setOldStructure(oldStructure);
        revision.setNewStructure(newStructure);
        revision.setOldCtc(oldCtc);
        revision.setNewCtc(dto.getCtcAnnual());
        revision.setEffectiveDate(dto.getEffectiveFrom());
        revision.setReason(dto.getRevisionReason());
        revision.setApprovedBy(approverUserId);

        // Calculate increment percentage if there was a previous CTC
        if (oldCtc != null && oldCtc.compareTo(BigDecimal.ZERO) > 0) {
            BigDecimal increment = dto.getCtcAnnual().subtract(oldCtc);
            BigDecimal incrementPct = increment
                    .multiply(BigDecimal.valueOf(100))
                    .divide(oldCtc, 2, RoundingMode.HALF_UP);
            revision.setIncrementPct(incrementPct);
        }

        salaryRevisionRepository.save(revision);

        return newStructure.getId();
    }

    /**
     * Calculates salary component amounts respecting dependency order:
     * Phase 1: FIXED_AMOUNT (no dependencies)
     * Phase 2: PERCENTAGE_OF_CTC (depends only on CTC)
     * Phase 3: PERCENTAGE_OF_BASIC (depends on Basic being resolved in Phase 1/2)
     * Phase 4: PERCENTAGE_OF_GROSS (depends on the phase 1-3 earnings base; see below)
     * Phase 5: FORMULA (SpEL, may reference any already-resolved component)
     *
     * After all phases a CTC tie-out runs: EARNING + EMPLOYER_CONTRIBUTION annual
     * amounts must equal the CTC. A shortfall is absorbed by a system-managed
     * "Special Allowance" balancing component; an overshoot (beyond a 1-rupee
     * rounding tolerance) is a template configuration error and throws.
     *
     * Overrides bypass calculation and use the provided monthly amount directly.
     */
    private List<EmployeeSalaryComponent> calculateComponentAmounts(
            List<SalaryTemplateComponent> templateComponents,
            BigDecimal ctcAnnual,
            BigDecimal ctcMonthly,
            Map<String, BigDecimal> overrideMap,
            EmployeeSalaryStructure structure,
            String instituteId) {

        // Separate components by calculation type for ordered processing
        List<SalaryTemplateComponent> fixedComponents = new ArrayList<>();
        List<SalaryTemplateComponent> pctOfCtcComponents = new ArrayList<>();
        List<SalaryTemplateComponent> pctOfBasicComponents = new ArrayList<>();
        List<SalaryTemplateComponent> pctOfGrossComponents = new ArrayList<>();
        List<SalaryTemplateComponent> formulaComponents = new ArrayList<>();

        for (SalaryTemplateComponent tc : templateComponents) {
            String calcType = tc.getCalculationType();
            if (CalculationType.FIXED_AMOUNT.name().equals(calcType)) {
                fixedComponents.add(tc);
            } else if (CalculationType.PERCENTAGE_OF_CTC.name().equals(calcType)) {
                pctOfCtcComponents.add(tc);
            } else if (CalculationType.PERCENTAGE_OF_BASIC.name().equals(calcType)) {
                pctOfBasicComponents.add(tc);
            } else if (CalculationType.PERCENTAGE_OF_GROSS.name().equals(calcType)) {
                pctOfGrossComponents.add(tc);
            } else if (CalculationType.FORMULA.name().equals(calcType)) {
                formulaComponents.add(tc);
            } else {
                // Default: treat unknown types as fixed
                fixedComponents.add(tc);
            }
        }

        // Result map: componentId -> EmployeeSalaryComponent
        Map<String, EmployeeSalaryComponent> resultMap = new LinkedHashMap<>();

        // PHASE 1: Process FIXED_AMOUNT components
        for (SalaryTemplateComponent tc : fixedComponents) {
            String componentId = tc.getComponent().getId();
            BigDecimal monthlyAmount;
            boolean isOverridden = false;

            if (overrideMap.containsKey(componentId)) {
                monthlyAmount = overrideMap.get(componentId);
                isOverridden = true;
            } else {
                monthlyAmount = tc.getFixedValue() != null ? tc.getFixedValue() : BigDecimal.ZERO;
            }

            resultMap.put(componentId, buildEmployeeSalaryComponent(
                    structure, tc, monthlyAmount, isOverridden));
        }

        // PHASE 2: Process PERCENTAGE_OF_CTC components
        for (SalaryTemplateComponent tc : pctOfCtcComponents) {
            String componentId = tc.getComponent().getId();
            BigDecimal monthlyAmount;
            boolean isOverridden = false;

            if (overrideMap.containsKey(componentId)) {
                monthlyAmount = overrideMap.get(componentId);
                isOverridden = true;
            } else {
                BigDecimal percentage = tc.getPercentageValue() != null ? tc.getPercentageValue() : BigDecimal.ZERO;
                monthlyAmount = ctcMonthly.multiply(percentage)
                        .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
                monthlyAmount = clampValue(monthlyAmount, tc.getMinValue(), tc.getMaxValue());
            }

            resultMap.put(componentId, buildEmployeeSalaryComponent(
                    structure, tc, monthlyAmount, isOverridden));
        }

        // PHASE 3: Process PERCENTAGE_OF_BASIC components
        // Find the Basic component: look for code "BASIC" among already-resolved components
        BigDecimal basicMonthly = resolveBasicAmount(resultMap, templateComponents);

        for (SalaryTemplateComponent tc : pctOfBasicComponents) {
            String componentId = tc.getComponent().getId();
            BigDecimal monthlyAmount;
            boolean isOverridden = false;

            if (overrideMap.containsKey(componentId)) {
                monthlyAmount = overrideMap.get(componentId);
                isOverridden = true;
            } else {
                BigDecimal percentage = tc.getPercentageValue() != null ? tc.getPercentageValue() : BigDecimal.ZERO;
                monthlyAmount = basicMonthly.multiply(percentage)
                        .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
                monthlyAmount = clampValue(monthlyAmount, tc.getMinValue(), tc.getMaxValue());
            }

            resultMap.put(componentId, buildEmployeeSalaryComponent(
                    structure, tc, monthlyAmount, isOverridden));
        }

        // PHASE 4: Process PERCENTAGE_OF_GROSS components
        // GROSS SEMANTICS: "gross" is defined as the sum of all EARNING components
        // resolved in phases 1-3 (FIXED_AMOUNT, PERCENTAGE_OF_CTC, PERCENTAGE_OF_BASIC),
        // i.e. all non-GROSS-based earnings. The base is computed ONCE here and every
        // PERCENTAGE_OF_GROSS component resolves against that same base. GROSS-based
        // components therefore do NOT compound on each other — this is deliberate and
        // makes the result deterministic regardless of template display order.
        BigDecimal earningsTotal = resultMap.values().stream()
                .filter(c -> ComponentType.EARNING.name().equals(c.getComponent().getType()))
                .map(EmployeeSalaryComponent::getMonthlyAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        for (SalaryTemplateComponent tc : pctOfGrossComponents) {
            String componentId = tc.getComponent().getId();
            BigDecimal monthlyAmount;
            boolean isOverridden = false;

            if (overrideMap.containsKey(componentId)) {
                monthlyAmount = overrideMap.get(componentId);
                isOverridden = true;
            } else {
                BigDecimal percentage = tc.getPercentageValue() != null ? tc.getPercentageValue() : BigDecimal.ZERO;
                monthlyAmount = earningsTotal.multiply(percentage)
                        .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
                monthlyAmount = clampValue(monthlyAmount, tc.getMinValue(), tc.getMaxValue());
            }

            resultMap.put(componentId, buildEmployeeSalaryComponent(
                    structure, tc, monthlyAmount, isOverridden));
        }

        // PHASE 5: Process FORMULA components via SpEL, in template display order.
        // The formula result is the MONTHLY amount. Available variables:
        //   #CTC (annual CTC), #CTC_MONTHLY, #BASIC (monthly basic, 0 if absent),
        //   #GROSS (monthly gross of phases 1-3), and #<COMPONENT_CODE> = monthly
        //   amount of every already-resolved component (uppercased, non-alphanumeric
        //   characters replaced with '_'). Formulas resolve in display order, so a
        //   formula may also reference earlier FORMULA components by code.
        for (SalaryTemplateComponent tc : formulaComponents) {
            String componentId = tc.getComponent().getId();
            BigDecimal monthlyAmount;
            boolean isOverridden = false;

            if (overrideMap.containsKey(componentId)) {
                monthlyAmount = overrideMap.get(componentId);
                isOverridden = true;
            } else {
                monthlyAmount = evaluateFormula(tc, ctcAnnual, ctcMonthly, basicMonthly, earningsTotal, resultMap);
                monthlyAmount = clampValue(monthlyAmount, tc.getMinValue(), tc.getMaxValue());
            }

            resultMap.put(componentId, buildEmployeeSalaryComponent(
                    structure, tc, monthlyAmount, isOverridden));
        }

        // CTC TIE-OUT: EARNING + EMPLOYER_CONTRIBUTION annual amounts must sum to the
        // CTC. Without this, a template of e.g. 40% + 20% silently pays 60% of CTC.
        applyCtcTieOut(resultMap, ctcAnnual, structure, instituteId);

        return new ArrayList<>(resultMap.values());
    }

    /**
     * Evaluates a FORMULA component with SpEL. Uses SimpleEvaluationContext (data
     * binding only — no reflection, type references or bean access) for safety.
     * The result is interpreted as the MONTHLY amount.
     */
    private BigDecimal evaluateFormula(
            SalaryTemplateComponent tc,
            BigDecimal ctcAnnual,
            BigDecimal ctcMonthly,
            BigDecimal basicMonthly,
            BigDecimal grossMonthly,
            Map<String, EmployeeSalaryComponent> resultMap) {

        String formula = tc.getFormula();
        String componentName = tc.getComponent().getName();

        if (!StringUtils.hasText(formula)) {
            throw new VacademyException(
                    "Component '" + componentName + "' uses FORMULA calculation but has no formula defined");
        }

        SimpleEvaluationContext context = SimpleEvaluationContext.forReadOnlyDataBinding().build();
        context.setVariable("CTC", ctcAnnual);
        context.setVariable("CTC_MONTHLY", ctcMonthly);
        context.setVariable("BASIC", basicMonthly != null ? basicMonthly : BigDecimal.ZERO);
        context.setVariable("GROSS", grossMonthly);

        // Every already-resolved component is exposed by its sanitized code
        for (EmployeeSalaryComponent resolved : resultMap.values()) {
            String code = resolved.getComponent().getCode();
            if (StringUtils.hasText(code)) {
                context.setVariable(sanitizeVariableName(code), resolved.getMonthlyAmount());
            }
        }

        try {
            Expression expression = SPEL_PARSER.parseExpression(formula);
            BigDecimal value = expression.getValue(context, BigDecimal.class);
            if (value == null) {
                throw new VacademyException(
                        "Formula for component '" + componentName + "' evaluated to null: " + formula);
            }
            return value.setScale(2, RoundingMode.HALF_UP);
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException(
                    "Invalid formula for component '" + componentName + "': " + formula
                    + " (" + e.getMessage() + ")");
        }
    }

    /** Uppercases a component code and replaces non-alphanumeric characters with '_'. */
    private String sanitizeVariableName(String code) {
        return code.toUpperCase().replaceAll("[^A-Z0-9]", "_");
    }

    /**
     * Ensures EARNING + EMPLOYER_CONTRIBUTION annual amounts tie out to the CTC.
     * A shortfall of at least 1 rupee annually is absorbed by a system-managed
     * "Special Allowance" balancing component (adjusted in place if the template
     * already contains one); an overshoot beyond the 1-rupee rounding tolerance
     * throws — such a template is misconfigured.
     */
    private void applyCtcTieOut(
            Map<String, EmployeeSalaryComponent> resultMap,
            BigDecimal ctcAnnual,
            EmployeeSalaryStructure structure,
            String instituteId) {

        BigDecimal totalAnnual = resultMap.values().stream()
                .filter(c -> ComponentType.EARNING.name().equals(c.getComponent().getType())
                        || ComponentType.EMPLOYER_CONTRIBUTION.name().equals(c.getComponent().getType()))
                .map(EmployeeSalaryComponent::getAnnualAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal residual = ctcAnnual.subtract(totalAnnual);

        if (residual.compareTo(CTC_TOLERANCE.negate()) < 0) {
            throw new VacademyException(
                    "Salary template components exceed CTC by " + residual.abs().setScale(2, RoundingMode.HALF_UP)
                    + " annually (components total " + totalAnnual.setScale(2, RoundingMode.HALF_UP)
                    + " against CTC " + ctcAnnual.setScale(2, RoundingMode.HALF_UP)
                    + "). Fix the template so components do not exceed CTC.");
        }

        if (residual.compareTo(CTC_TOLERANCE) < 0) {
            // Within rounding tolerance — nothing to balance
            return;
        }

        // Adjust an existing Special Allowance from the template, if present
        for (EmployeeSalaryComponent existing : resultMap.values()) {
            if (SPECIAL_ALLOWANCE_CODE.equalsIgnoreCase(existing.getComponent().getCode())) {
                BigDecimal newAnnual = existing.getAnnualAmount().add(residual);
                existing.setAnnualAmount(newAnnual);
                existing.setMonthlyAmount(newAnnual.divide(BigDecimal.valueOf(12), 2, RoundingMode.HALF_UP));
                return;
            }
        }

        // Otherwise add a balancing Special Allowance component
        SalaryComponent specialAllowance = getOrCreateSpecialAllowanceComponent(instituteId);

        EmployeeSalaryComponent balancing = new EmployeeSalaryComponent();
        balancing.setSalaryStructure(structure);
        balancing.setComponent(specialAllowance);
        balancing.setAnnualAmount(residual);
        balancing.setMonthlyAmount(residual.divide(BigDecimal.valueOf(12), 2, RoundingMode.HALF_UP));
        balancing.setCalculationType(CalculationType.FIXED_AMOUNT.name());
        balancing.setIsOverridden(false);

        resultMap.put(specialAllowance.getId(), balancing);
    }

    /** Get-or-create the institute's system-managed Special Allowance salary component. */
    private SalaryComponent getOrCreateSpecialAllowanceComponent(String instituteId) {
        return masterComponentRepository.findByInstituteIdAndCode(instituteId, SPECIAL_ALLOWANCE_CODE)
                .orElseGet(() -> {
                    SalaryComponent component = new SalaryComponent();
                    component.setInstituteId(instituteId);
                    component.setName("Special Allowance");
                    component.setCode(SPECIAL_ALLOWANCE_CODE);
                    component.setType(ComponentType.EARNING.name());
                    component.setCategory(ComponentCategory.FIXED.name());
                    component.setIsTaxable(true);
                    component.setIsStatutory(false);
                    component.setIsActive(true);
                    component.setDescription(
                            "System-managed balancing component: absorbs the CTC residual left after all template components are resolved.");
                    return masterComponentRepository.save(component);
                });
    }

    /**
     * Resolves the Basic salary amount from already-calculated components.
     * Searches by component code "BASIC" (case-insensitive).
     */
    private BigDecimal resolveBasicAmount(
            Map<String, EmployeeSalaryComponent> resultMap,
            List<SalaryTemplateComponent> templateComponents) {

        // First, try to find Basic in the already-resolved results
        for (Map.Entry<String, EmployeeSalaryComponent> entry : resultMap.entrySet()) {
            SalaryComponent comp = entry.getValue().getComponent();
            if ("BASIC".equalsIgnoreCase(comp.getCode())) {
                return entry.getValue().getMonthlyAmount();
            }
        }

        // If not found, it means Basic hasn't been resolved yet (shouldn't happen if template is set up correctly)
        // Look through template components to see if Basic exists at all
        for (SalaryTemplateComponent tc : templateComponents) {
            if ("BASIC".equalsIgnoreCase(tc.getComponent().getCode())) {
                throw new VacademyException(
                        "Basic component exists in the template but was not resolved before dependent components. " +
                        "Ensure the Basic component uses FIXED_AMOUNT or PERCENTAGE_OF_CTC calculation type.");
            }
        }

        // No Basic component in template at all -- return zero
        return BigDecimal.ZERO;
    }

    /**
     * Normalizes an optional ISO-4217 currency code: defaults to INR, trims,
     * uppercases and sanity-checks the 3-letter shape.
     */
    private String normalizeCurrency(String currency) {
        if (!StringUtils.hasText(currency)) {
            return DEFAULT_CURRENCY;
        }
        String normalized = currency.trim().toUpperCase();
        if (!normalized.matches("[A-Z]{3}")) {
            throw new VacademyException("Invalid currency code: " + currency + ". Expected a 3-letter code like INR or USD.");
        }
        return normalized;
    }

    /**
     * Clamps a value between min and max bounds (if specified).
     */
    private BigDecimal clampValue(BigDecimal value, BigDecimal minValue, BigDecimal maxValue) {
        if (minValue != null && value.compareTo(minValue) < 0) {
            return minValue;
        }
        if (maxValue != null && value.compareTo(maxValue) > 0) {
            return maxValue;
        }
        return value;
    }

    /**
     * Builds an EmployeeSalaryComponent entity from a template component and calculated monthly amount.
     */
    private EmployeeSalaryComponent buildEmployeeSalaryComponent(
            EmployeeSalaryStructure structure,
            SalaryTemplateComponent tc,
            BigDecimal monthlyAmount,
            boolean isOverridden) {

        EmployeeSalaryComponent esc = new EmployeeSalaryComponent();
        esc.setSalaryStructure(structure);
        esc.setComponent(tc.getComponent());
        esc.setMonthlyAmount(monthlyAmount);
        esc.setAnnualAmount(monthlyAmount.multiply(BigDecimal.valueOf(12)));
        esc.setCalculationType(tc.getCalculationType());
        esc.setPercentageValue(tc.getPercentageValue());
        esc.setIsOverridden(isOverridden);
        return esc;
    }

    /**
     * Gets a salary structure by ID with all its components.
     * The owning employee is only known after the load, so the self-or-HR-staff
     * check (institute membership + employee-in-institute + caller is HR staff
     * or IS that employee) happens here rather than in the controller.
     */
    @Transactional(readOnly = true)
    public EmployeeSalaryStructureDTO getStructure(String structureId, String instituteId, CustomUserDetails user) {
        EmployeeSalaryStructure structure = salaryStructureRepository.findById(structureId)
                .orElseThrow(() -> new VacademyException("Salary structure not found"));

        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, structure.getEmployee().getId());

        return toStructureDTO(structure);
    }

    /**
     * Gets the full salary history for an employee (all structures, ordered by effectiveFrom desc).
     */
    @Transactional(readOnly = true)
    public List<EmployeeSalaryStructureDTO> getEmployeeSalaryHistory(String employeeId) {
        List<EmployeeSalaryStructure> structures = salaryStructureRepository
                .findByEmployeeIdOrderByEffectiveFromDesc(employeeId);

        return structures.stream()
                .map(this::toStructureDTO)
                .collect(Collectors.toList());
    }

    /**
     * Gets salary revision history for an employee.
     */
    @Transactional(readOnly = true)
    public List<SalaryRevisionDTO> getRevisionHistory(String employeeId) {
        List<SalaryRevision> revisions = salaryRevisionRepository
                .findByEmployeeIdOrderByEffectiveDateDesc(employeeId);

        return revisions.stream()
                .map(this::toRevisionDTO)
                .collect(Collectors.toList());
    }

    private EmployeeSalaryStructureDTO toStructureDTO(EmployeeSalaryStructure structure) {
        EmployeeSalaryStructureDTO dto = EmployeeSalaryStructureDTO.builder()
                .id(structure.getId())
                .employeeId(structure.getEmployee().getId())
                .employeeCode(structure.getEmployee().getEmployeeCode())
                .effectiveFrom(structure.getEffectiveFrom())
                .effectiveTo(structure.getEffectiveTo())
                .ctcAnnual(structure.getCtcAnnual())
                .ctcMonthly(structure.getCtcMonthly())
                .grossMonthly(structure.getGrossMonthly())
                .netMonthly(structure.getNetMonthly())
                .currency(structure.getCurrency() != null ? structure.getCurrency() : DEFAULT_CURRENCY)
                .status(structure.getStatus())
                .revisionReason(structure.getRevisionReason())
                .build();

        if (structure.getTemplate() != null) {
            dto.setTemplateId(structure.getTemplate().getId());
            dto.setTemplateName(structure.getTemplate().getName());
        }

        // Load components
        List<EmployeeSalaryComponent> components = salaryComponentRepository
                .findBySalaryStructureId(structure.getId());

        dto.setComponents(components.stream()
                .map(this::toComponentDTO)
                .collect(Collectors.toList()));

        return dto;
    }

    private EmployeeSalaryComponentDTO toComponentDTO(EmployeeSalaryComponent esc) {
        SalaryComponent comp = esc.getComponent();
        return EmployeeSalaryComponentDTO.builder()
                .id(esc.getId())
                .componentId(comp.getId())
                .componentName(comp.getName())
                .componentCode(comp.getCode())
                .componentType(comp.getType())
                .monthlyAmount(esc.getMonthlyAmount())
                .annualAmount(esc.getAnnualAmount())
                .calculationType(esc.getCalculationType())
                .percentageValue(esc.getPercentageValue())
                .isOverridden(esc.getIsOverridden())
                .build();
    }

    private SalaryRevisionDTO toRevisionDTO(SalaryRevision revision) {
        return SalaryRevisionDTO.builder()
                .id(revision.getId())
                .employeeId(revision.getEmployee().getId())
                .employeeCode(revision.getEmployee().getEmployeeCode())
                .oldCtc(revision.getOldCtc())
                .newCtc(revision.getNewCtc())
                .incrementPct(revision.getIncrementPct())
                .reason(revision.getReason())
                .effectiveDate(revision.getEffectiveDate())
                .oldStructureId(revision.getOldStructure() != null ? revision.getOldStructure().getId() : null)
                .newStructureId(revision.getNewStructure().getId())
                .build();
    }
}
