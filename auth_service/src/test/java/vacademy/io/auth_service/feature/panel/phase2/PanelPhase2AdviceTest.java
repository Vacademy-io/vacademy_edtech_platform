package vacademy.io.auth_service.feature.panel.phase2;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** A controller under feature/panel/phase2 answers refusals in the phase 1 {code, message} shape. */
class PanelPhase2AdviceTest {

    @RestController
    static class SwitchedOffController {
        @GetMapping("/auth-service/v1/panel/admin/phase2-probe")
        public String probe() {
            PanelPhase2Properties.allOff().requireUsage();
            return "unreachable";
        }
    }

    @Test
    void aSwitchedOffEndpointAnswersFeatureOff() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new SwitchedOffController())
                .setControllerAdvice(new PanelPhase2ExceptionAdvice()).build();
        mvc.perform(get("/auth-service/v1/panel/admin/phase2-probe"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("FEATURE_OFF"))
                .andExpect(jsonPath("$.message").value("This feature is not available"));
    }
}
