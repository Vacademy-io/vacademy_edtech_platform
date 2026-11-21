import AVFoundation
import Capacitor
import UIKit

/// Native side of "live class inside the app" (JS contract: src/lib/live-class/native-live-class.ts).
///
/// The class itself is a BigBlueButton meeting shown in a cross-origin `<iframe>` inside the
/// app's WKWebView. This plugin only prepares the device around it:
///  - `prepare({camera})`  asks for microphone (+ camera) BEFORE the frame loads, so BBB's own
///                         getUserMedia calls find the permission already granted.
///  - `enterClass()`       keeps the screen on and puts the audio session in voice-chat mode on
///                         the loudspeaker, so audio and mic keep running in the background /
///                         on the lock screen (needs `audio` in UIBackgroundModes).
///  - `exitClass()`        undoes enterClass. Safe to call twice, or without enterClass.
///  - `enterPictureInPicture()` resolves `{entered: false}`: on iOS, PiP is started by the page's
///                         own `<video>` element (WKWebView allows it, see MainViewController).
///
/// The JS switches iOS from SFSafariViewController to in-app classes only when this plugin is
/// registered (`Capacitor.isPluginAvailable("VacademyLiveClass")`), so an app build without
/// this file keeps the old behaviour. Registered in `MainViewController.capacitorDidLoad`.
@objc(VacademyLiveClassPlugin)
public class VacademyLiveClassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VacademyLiveClassPlugin"
    public let jsName = "VacademyLiveClass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enterClass", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exitClass", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enterPictureInPicture", returnType: CAPPluginReturnPromise)
    ]

    /// Audio-session work is serialised here: `setActive` can block, so it stays off the main
    /// thread, and `inClass` / `savedSession` are only touched on this queue.
    private let audioQueue = DispatchQueue(label: "io.vacademy.liveclass.audio")
    private var inClass = false
    /// The session setup in place before enterClass, restored by exitClass so the rest of the app
    /// (recorded lessons, audio slides) is not left in voice-chat mode.
    private var savedSession: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?
    private var interruptionObserver: NSObjectProtocol?

    deinit {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - prepare

    @objc func prepare(_ call: CAPPluginCall) {
        let wantCamera = call.getBool("camera") ?? false
        requestAccess(for: .audio) { microphone in
            guard wantCamera else {
                // Not asked for: report what the camera is already allowed to do, without a prompt.
                let camera = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
                call.resolve(["microphone": Self.label(microphone), "camera": Self.label(camera)])
                return
            }
            // Sequential, not parallel: iOS shows one permission alert at a time.
            self.requestAccess(for: .video) { camera in
                call.resolve(["microphone": Self.label(microphone), "camera": Self.label(camera)])
            }
        }
    }

    private func requestAccess(for media: AVMediaType, completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: media) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: media, completionHandler: completion)
        default: // .denied, .restricted (and anything future): only Settings can change it
            completion(false)
        }
    }

    private static func label(_ granted: Bool) -> String {
        return granted ? "granted" : "denied"
    }

    // MARK: - enterClass / exitClass

    @objc func enterClass(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        audioQueue.async {
            let session = AVAudioSession.sharedInstance()
            if !self.inClass {
                self.savedSession = (session.category, session.mode, session.categoryOptions)
                self.inClass = true
                self.observeInterruptions()
            }
            self.activateClassAudio()
            // Never rejects: a failed audio setup must not stop the class from opening.
            call.resolve()
        }
    }

    @objc func exitClass(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
        }
        audioQueue.async {
            guard self.inClass else {
                call.resolve()
                return
            }
            self.inClass = false
            self.stopObservingInterruptions()
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                // Fails while WebKit still has audio I/O running; harmless, the category below
                // still goes back to what it was.
                CAPLog.print("[VacademyLiveClass] setActive(false) failed: \(error.localizedDescription)")
            }
            if let saved = self.savedSession {
                do {
                    try session.setCategory(saved.category, mode: saved.mode, options: saved.options)
                } catch {
                    CAPLog.print("[VacademyLiveClass] restoring audio category failed: \(error.localizedDescription)")
                }
            }
            self.savedSession = nil
            call.resolve()
        }
    }

    /// Voice chat on the loudspeaker (not the earpiece), Bluetooth headsets allowed. Runs on
    /// `audioQueue`.
    private func activateClassAudio() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .videoChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true)
        } catch {
            CAPLog.print("[VacademyLiveClass] audio session setup failed: \(error.localizedDescription)")
        }
    }

    // MARK: - interruptions (phone call, Siri, alarm)

    /// After an interruption ends iOS leaves the session inactive; reactivate it so the class
    /// audio comes back without the learner leaving and rejoining.
    private func observeInterruptions() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] note in
            guard let self = self,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            self.audioQueue.async {
                if self.inClass {
                    self.activateClassAudio()
                }
            }
        }
    }

    private func stopObservingInterruptions() {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
            interruptionObserver = nil
        }
    }

    // MARK: - picture in picture

    /// iOS cannot shrink the whole app into PiP. In-class PiP is the BBB plugin calling
    /// `requestPictureInPicture()` on its `<video>`, which WKWebView handles by itself.
    @objc func enterPictureInPicture(_ call: CAPPluginCall) {
        call.resolve(["entered": false])
    }
}
