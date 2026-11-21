package vacademy.io.admin_core_service.features.commerce.order.pincode;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * City and state of a pincode: the directory row when there is one, else the state from the
 * first digits and no city. There is no delivery-date or serviceability data in Phase 1.
 */
@Slf4j
@Service
public class CommercePincodeService {

    public static final String SOURCE_DIRECTORY = "DIRECTORY";
    public static final String SOURCE_PIN_PREFIX = "PIN_PREFIX";
    public static final String SOURCE_UNKNOWN = "UNKNOWN";

    /** {@code stateCode} is a GST state code or null; {@code source} says where it came from. */
    public record Pincode(String pincode, String city, String stateCode, String stateName, String source) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    /** Null for a malformed pincode. */
    @Transactional(readOnly = true)
    public Pincode lookup(String rawPincode) {
        String pincode = rawPincode == null ? null : rawPincode.replace(" ", "").trim();
        if (!PincodeStates.isValid(pincode)) {
            return null;
        }
        try {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = entityManager.createNativeQuery(
                            "SELECT city, state_code FROM commerce_pincode WHERE pincode = :pincode")
                    .setParameter("pincode", pincode)
                    .getResultList();
            if (!rows.isEmpty() && rows.get(0)[1] != null) {
                String state = rows.get(0)[1].toString().trim();
                String city = rows.get(0)[0] == null ? null : rows.get(0)[0].toString().trim();
                return new Pincode(pincode, city == null || city.isEmpty() ? null : city, state,
                        PincodeStates.stateName(state), SOURCE_DIRECTORY);
            }
        } catch (RuntimeException e) {
            log.warn("pincode directory read failed, falling back to the prefix: {}", e.getMessage());
        }
        String state = PincodeStates.stateCode(pincode);
        return new Pincode(pincode, null, state, PincodeStates.stateName(state),
                state == null ? SOURCE_UNKNOWN : SOURCE_PIN_PREFIX);
    }
}
