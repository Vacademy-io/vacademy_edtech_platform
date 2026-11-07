package vacademy.io.admin_core_service.features.hr_salary.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_salary.dto.AssignSalaryDTO;
import vacademy.io.admin_core_service.features.hr_salary.entity.EmployeeSalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryComponent;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryTemplate;
import vacademy.io.admin_core_service.features.hr_salary.entity.SalaryTemplateComponent;
import vacademy.io.admin_core_service.features.hr_salary.enums.CalculationType;
import vacademy.io.admin_core_service.features.hr_salary.enums.ComponentType;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryComponentRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.EmployeeSalaryStructureRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryComponentRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryRevisionRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryTemplateComponentRepository;
import vacademy.io.admin_core_service.features.hr_salary.repository.SalaryTemplateRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for the component-calculation path of
 * {@link SalaryStructureService#assignSalary}: dependency-ordered resolution
 * (fixed / %-of-CTC / %-of-basic / SpEL formula) and the CTC tie-out that adds
 * a balancing Special Allowance or rejects an over-CTC template.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("SalaryStructureService — component calculation and CTC tie-out")
class SalaryStructureServiceTest {

    private static final String INSTITUTE_ID = "inst-1";
    private static final String EMPLOYEE_ID = "emp-1";
    private static final String TEMPLATE_ID = "tpl-1";
    private static final BigDecimal CTC = new BigDecimal("600000");

    @Mock private EmployeeProfileRepository employeeProfileRepository;
    @Mock private EmployeeSalaryStructureRepository salaryStructureRepository;
    @Mock private EmployeeSalaryComponentRepository salaryComponentRepository;
    @Mock private SalaryComponentRepository masterComponentRepository;
    @Mock private SalaryTemplateRepository salaryTemplateRepository;
    @Mock private SalaryTemplateComponentRepository salaryTemplateComponentRepository;
    @Mock private SalaryRevisionRepository salaryRevisionRepository;
    @Mock private HrAccessGuard hrAccessGuard;

    @InjectMocks private SalaryStructureService service;

    private SalaryComponent specialAllowanceMaster;

    @BeforeEach
    void stubHappyPath() {
        EmployeeProfile employee = new EmployeeProfile();
        employee.setInstituteId(INSTITUTE_ID);
        lenient().when(employeeProfileRepository.findById(EMPLOYEE_ID)).thenReturn(Optional.of(employee));

        SalaryTemplate template = new SalaryTemplate();
        template.setInstituteId(INSTITUTE_ID);
        lenient().when(salaryTemplateRepository.findById(TEMPLATE_ID)).thenReturn(Optional.of(template));

        lenient().when(salaryStructureRepository
                        .findFirstByEmployee_IdAndStatusOrderByEffectiveFromDesc(EMPLOYEE_ID, "ACTIVE"))
                .thenReturn(Optional.empty());
        lenient().when(salaryStructureRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(salaryComponentRepository.saveAll(any())).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(salaryRevisionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        specialAllowanceMaster = component("comp-special", "SPECIAL_ALLOWANCE", ComponentType.EARNING);
        lenient().when(masterComponentRepository.findByInstituteIdAndCode(INSTITUTE_ID, "SPECIAL_ALLOWANCE"))
                .thenReturn(Optional.of(specialAllowanceMaster));
    }

    // ---- fixtures -------------------------------------------------------

    private static SalaryComponent component(String id, String code, ComponentType type) {
        SalaryComponent c = new SalaryComponent();
        c.setId(id);
        c.setInstituteId(INSTITUTE_ID);
        c.setCode(code);
        c.setName(code);
        c.setType(type.name());
        return c;
    }

    private static SalaryTemplateComponent pctOfCtc(SalaryComponent c, String pct) {
        SalaryTemplateComponent tc = new SalaryTemplateComponent();
        tc.setComponent(c);
        tc.setCalculationType(CalculationType.PERCENTAGE_OF_CTC.name());
        tc.setPercentageValue(new BigDecimal(pct));
        return tc;
    }

    private static SalaryTemplateComponent pctOfBasic(SalaryComponent c, String pct) {
        SalaryTemplateComponent tc = new SalaryTemplateComponent();
        tc.setComponent(c);
        tc.setCalculationType(CalculationType.PERCENTAGE_OF_BASIC.name());
        tc.setPercentageValue(new BigDecimal(pct));
        return tc;
    }

    private static SalaryTemplateComponent fixed(SalaryComponent c, String monthly) {
        SalaryTemplateComponent tc = new SalaryTemplateComponent();
        tc.setComponent(c);
        tc.setCalculationType(CalculationType.FIXED_AMOUNT.name());
        tc.setFixedValue(new BigDecimal(monthly));
        return tc;
    }

    private static SalaryTemplateComponent formula(SalaryComponent c, String expr) {
        SalaryTemplateComponent tc = new SalaryTemplateComponent();
        tc.setComponent(c);
        tc.setCalculationType(CalculationType.FORMULA.name());
        tc.setFormula(expr);
        return tc;
    }

    private static AssignSalaryDTO dto() {
        return AssignSalaryDTO.builder()
                .employeeId(EMPLOYEE_ID)
                .templateId(TEMPLATE_ID)
                .ctcAnnual(CTC)
                .effectiveFrom(LocalDate.of(2026, 4, 1))
                .build();
    }

    private List<EmployeeSalaryComponent> assignAndCapture() {
        service.assignSalary(dto(), INSTITUTE_ID, "approver-1");
        @SuppressWarnings({"unchecked", "rawtypes"})
        ArgumentCaptor<List<EmployeeSalaryComponent>> captor =
                (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
        verify(salaryComponentRepository).saveAll(captor.capture());
        return captor.getValue();
    }

    private static EmployeeSalaryComponent byCode(List<EmployeeSalaryComponent> components, String code) {
        return components.stream()
                .filter(c -> code.equals(c.getComponent().getCode()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("component " + code + " not found"));
    }

    private static void assertAmount(String what, String expected, BigDecimal actual) {
        assertNotNull(actual, what + " must not be null");
        assertEquals(0, new BigDecimal(expected).compareTo(actual),
                what + ": expected " + expected + " but was " + actual);
    }

    // ---- tests ----------------------------------------------------------

    @Test
    @DisplayName("CTC 6,00,000 with BASIC 40% of CTC and HRA 50% of BASIC resolves BASIC 20,000/mo and HRA 10,000/mo")
    void resolvesPercentageChain() {
        when(salaryTemplateComponentRepository.findByTemplateIdOrderByDisplayOrderAsc(TEMPLATE_ID))
                .thenReturn(List.of(
                        pctOfCtc(component("comp-basic", "BASIC", ComponentType.EARNING), "40"),
                        pctOfBasic(component("comp-hra", "HRA", ComponentType.EARNING), "50"),
                        fixed(component("comp-pf-er", "PF_ER", ComponentType.EMPLOYER_CONTRIBUTION), "1800")));

        List<EmployeeSalaryComponent> components = assignAndCapture();

        assertAmount("BASIC monthly (40% of 50,000 CTC-monthly)", "20000",
                byCode(components, "BASIC").getMonthlyAmount());
        assertAmount("HRA monthly (50% of BASIC)", "10000",
                byCode(components, "HRA").getMonthlyAmount());
        assertAmount("PF employer monthly (fixed)", "1800",
                byCode(components, "PF_ER").getMonthlyAmount());
    }

    @Test
    @DisplayName("CTC tie-out adds a Special Allowance so EARNING + EMPLOYER_CONTRIBUTION annuals sum exactly to CTC")
    void ctcTieOutAddsBalancingSpecialAllowance() {
        when(salaryTemplateComponentRepository.findByTemplateIdOrderByDisplayOrderAsc(TEMPLATE_ID))
                .thenReturn(List.of(
                        pctOfCtc(component("comp-basic", "BASIC", ComponentType.EARNING), "40"),
                        pctOfBasic(component("comp-hra", "HRA", ComponentType.EARNING), "50"),
                        fixed(component("comp-pf-er", "PF_ER", ComponentType.EMPLOYER_CONTRIBUTION), "1800")));

        List<EmployeeSalaryComponent> components = assignAndCapture();

        // Residual = 6,00,000 - (2,40,000 + 1,20,000 + 21,600) = 2,18,400/yr.
        EmployeeSalaryComponent special = byCode(components, "SPECIAL_ALLOWANCE");
        assertAmount("Special Allowance annual", "218400", special.getAnnualAmount());
        assertAmount("Special Allowance monthly", "18200", special.getMonthlyAmount());

        BigDecimal ctcSideAnnualTotal = components.stream()
                .filter(c -> ComponentType.EARNING.name().equals(c.getComponent().getType())
                        || ComponentType.EMPLOYER_CONTRIBUTION.name().equals(c.getComponent().getType()))
                .map(EmployeeSalaryComponent::getAnnualAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertAmount("EARNING + EMPLOYER_CONTRIBUTION annual total ties out to CTC", "600000",
                ctcSideAnnualTotal);
    }

    @Test
    @DisplayName("template whose components exceed CTC is rejected as a configuration error")
    void overCtcTemplateThrows() {
        when(salaryTemplateComponentRepository.findByTemplateIdOrderByDisplayOrderAsc(TEMPLATE_ID))
                .thenReturn(List.of(
                        pctOfCtc(component("comp-basic", "BASIC", ComponentType.EARNING), "120")));

        VacademyException ex = assertThrows(VacademyException.class,
                () -> service.assignSalary(dto(), INSTITUTE_ID, "approver-1"));

        assertTrue(ex.getMessage().contains("exceed CTC"),
                "expected an over-CTC template error but got: " + ex.getMessage());
    }

    @Test
    @DisplayName("FORMULA component '#BASIC * 0.1' resolves to 10% of the monthly basic")
    void formulaComponentResolvesAgainstBasic() {
        when(salaryTemplateComponentRepository.findByTemplateIdOrderByDisplayOrderAsc(TEMPLATE_ID))
                .thenReturn(List.of(
                        pctOfCtc(component("comp-basic", "BASIC", ComponentType.EARNING), "40"),
                        formula(component("comp-bonus", "STAT_BONUS", ComponentType.EARNING), "#BASIC * 0.1")));

        List<EmployeeSalaryComponent> components = assignAndCapture();

        assertAmount("STAT_BONUS monthly (10% of 20,000 basic)", "2000",
                byCode(components, "STAT_BONUS").getMonthlyAmount());
    }
}
