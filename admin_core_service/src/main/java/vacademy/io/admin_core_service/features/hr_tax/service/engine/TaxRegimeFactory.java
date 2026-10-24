package vacademy.io.admin_core_service.features.hr_tax.service.engine;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class TaxRegimeFactory {

    private final Map<String, TaxRegimeEngine> engineMap;

    @Autowired
    public TaxRegimeFactory(List<TaxRegimeEngine> engines) {
        this.engineMap = new HashMap<>();
        for (TaxRegimeEngine engine : engines) {
            this.engineMap.put(engine.getCountryCode(), engine);
        }
    }

    /**
     * Get the tax regime engine for the given country code.
     *
     * @param countryCode the country code (e.g. "IND", "USA")
     * @return the appropriate TaxRegimeEngine implementation
     * @throws VacademyException if no engine is found for the country code
     */
    public TaxRegimeEngine getEngine(String countryCode) {
        TaxRegimeEngine engine = engineMap.get(normalize(countryCode));
        if (engine == null) {
            throw new VacademyException("No tax engine found for country code: " + countryCode);
        }
        return engine;
    }

    /**
     * Institutes configure common aliases; engines register ISO alpha-3. Public
     * so anything else keying off a configured country code (payroll currency,
     * statutory exports) resolves aliases the same way this factory does.
     */
    public static String normalize(String countryCode) {
        if (countryCode == null) return "";
        return switch (countryCode.trim().toUpperCase()) {
            case "IN", "INDIA" -> "IND";
            case "UAE", "AE" -> "ARE";
            case "KSA", "SA", "SAUDI" -> "SAU";
            default -> countryCode.trim().toUpperCase();
        };
    }
}
