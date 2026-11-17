package io.vacademy.student.app.liveclass;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.RequiresApi;

/**
 * Loudspeaker routing for the duration of a live class.
 *
 * WebView's WebRTC puts audio in communication mode, which on many phones means the EARPIECE —
 * a learner holding the phone at arm's length then hears nothing. While a class runs we route
 * communication audio to the built-in loudspeaker, unless a personal audio device (wired / USB /
 * Bluetooth headset, hearing aid) is connected, in which case we leave the choice to the system.
 * Re-evaluated whenever an audio device is plugged in or removed. stop() restores the previous
 * routing.
 *
 * NEEDS A REAL-DEVICE TEST: Chromium's own audio manager inside WebView also touches routing, and
 * vendors differ. Check speaker / wired headset / Bluetooth headset / plug-in mid-class, on one
 * API 31+ phone and one API 26-30 phone.
 *
 * Main thread only.
 */
final class LiveClassAudioRouter {

    private static final String TAG = "LiveClassAudio";

    private final AudioManager audioManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean started = false;
    /** API < 31: speakerphone state before the class, restored by stop(). */
    private boolean savedSpeakerphoneOn = false;
    private AudioDeviceCallback deviceCallback;

    LiveClassAudioRouter(Context context) {
        this.audioManager = (AudioManager) context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
    }

    void start() {
        if (started || audioManager == null) return;
        started = true;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            savedSpeakerphoneOn = audioManager.isSpeakerphoneOn();
        }
        apply();
        deviceCallback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                apply();
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                apply();
            }
        };
        // API 23 (= minSdk). Also fires once immediately with the current devices.
        audioManager.registerAudioDeviceCallback(deviceCallback, mainHandler);
    }

    void stop() {
        if (!started || audioManager == null) return;
        started = false;
        if (deviceCallback != null) {
            try {
                audioManager.unregisterAudioDeviceCallback(deviceCallback);
            } catch (Exception ignored) {}
            deviceCallback = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice();
        } else {
            setSpeakerphoneLegacy(savedSpeakerphoneOn);
        }
    }

    private void apply() {
        if (!started) return;
        try {
            boolean personal = hasPersonalAudioOutput();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                applyApi31(personal);
            } else {
                setSpeakerphoneLegacy(!personal);
            }
        } catch (Exception e) {
            Log.w(TAG, "audio routing failed", e);
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    private void applyApi31(boolean personalDeviceConnected) {
        if (personalDeviceConnected) {
            // Let the system pick the headset.
            audioManager.clearCommunicationDevice();
            return;
        }
        for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
            if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                boolean ok = audioManager.setCommunicationDevice(device);
                if (!ok) Log.w(TAG, "setCommunicationDevice(speaker) refused");
                return;
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void setSpeakerphoneLegacy(boolean on) {
        if (audioManager.isSpeakerphoneOn() != on) audioManager.setSpeakerphoneOn(on);
    }

    private boolean hasPersonalAudioOutput() {
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            switch (device.getType()) {
                case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                case AudioDeviceInfo.TYPE_USB_HEADSET: // int constant, API 26 — inlined, safe below
                case AudioDeviceInfo.TYPE_HEARING_AID: // API 28, inlined
                case AudioDeviceInfo.TYPE_BLE_HEADSET: // API 31, inlined
                case AudioDeviceInfo.TYPE_BLE_SPEAKER: // API 31, inlined
                    return true;
                default:
                    break;
            }
        }
        return false;
    }
}
