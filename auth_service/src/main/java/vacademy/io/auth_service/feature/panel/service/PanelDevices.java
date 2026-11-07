package vacademy.io.auth_service.feature.panel.service;

import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;

/** Device credentials and the one way a panel leaves its room. */
@Component
public class PanelDevices {

    private static final int MAX_ID_LENGTH = 36;

    private final PanelRepository repository;

    public PanelDevices(PanelRepository repository) {
        this.repository = repository;
    }

    /** @throws PanelApiException 401 DEVICE_REVOKED for unknown, wrong or revoked credentials */
    public DeviceRow require(String deviceId, String deviceSecret) {
        if (deviceId == null || deviceId.length() > MAX_ID_LENGTH || deviceSecret == null
                || PanelSecrets.hasControlChars(deviceId)) {
            throw PanelApiException.deviceRevoked();
        }
        DeviceRow device = repository.findDevice(deviceId).orElseThrow(PanelApiException::deviceRevoked);
        if ("REVOKED".equals(device.status()) || !PanelSecrets.matches(deviceSecret, device.secretHash())) {
            throw PanelApiException.deviceRevoked();
        }
        return device;
    }

    public DeviceRow requireActive(String deviceId, String deviceSecret) {
        DeviceRow device = require(deviceId, deviceSecret);
        if (!"ACTIVE".equals(device.status())) {
            throw PanelApiException.deviceNotActive();
        }
        return device;
    }

    /**
     * Call inside a transaction. The order matters against a concurrent approve: once the device is
     * REVOKED an approve cannot start, killing challenges waits for one already running, and only then
     * are sessions ended, so a session that approve just created is ended too.
     */
    public void revokeInTx(String deviceId, String by) {
        repository.revokeDevice(deviceId, by);
        repository.killOpenOfDevice(deviceId);
        repository.endActiveSessionOfDevice(deviceId, "UNBOUND", by);
    }
}
