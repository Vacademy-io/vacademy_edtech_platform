import AuthenticationServices
import Capacitor
import WebKit

/// App's bridge view controller subclass. Two responsibilities beyond the Capacitor default:
///
/// 1. Registers the `offline-media://` URL scheme handler on the WKWebViewConfiguration
///    *before* the WKWebView is constructed (must happen here — WKWebViewConfiguration's
///    scheme handlers are immutable once the web view exists).
/// 2. Registers the local, in-repo plugins (`OfflineMediaPlugin`, `NativeAuthSessionPlugin`,
///    `VacademyLiveClassPlugin`) once the bridge is available. They have no npm package, so they
///    are not in `capacitor.config.json`'s auto-registration list and must be registered manually
///    via `registerPluginInstance`.
///
/// Main.storyboard's root view controller's custom class has been changed from
/// `CAPBridgeViewController` (Capacitor module) to `MainViewController` (App module) to route
/// through this subclass.
class MainViewController: CAPBridgeViewController {

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.setURLSchemeHandler(OfflineMediaSchemeHandler(), forURLScheme: OfflineMediaPlugin.scheme)
        // Live classes: the BBB frame's picture-in-picture is the page's own <video> calling
        // requestPictureInPicture(). iOS defaults this to true; set it explicitly so it can't be lost.
        configuration.allowsPictureInPictureMediaPlayback = true
        return configuration
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OfflineMediaPlugin())
        bridge?.registerPluginInstance(NativeAuthSessionPlugin())
        // Its presence is what switches the JS from SFSafariViewController to in-app classes.
        bridge?.registerPluginInstance(VacademyLiveClassPlugin())
        // "Download" buttons: WKWebView ignores <a download>, so files are saved through this.
        bridge?.registerPluginInstance(VacademyFileSavePlugin())
    }
}

/// Google / GitHub sign-in through `ASWebAuthenticationSession`.
///
/// The OAuth flow ends with a redirect to the brand's learner host, which can only reach the app
/// through Universal Links — and those are not set up for the white-label apps. Instead the web
/// flow is started here; the learner host answers the final hop with a redirect to
/// `<bundle id>://login/oauth/learner?accessToken=…` (functions/login/oauth/learner.ts), the
/// session catches that scheme and closes, and the URL is handed to Capacitor exactly as if the
/// app had been opened with it, so the existing `appUrlOpen` handler in `__root.tsx` signs in.
/// Lives in this file because every brand target already compiles it.
@objc(NativeAuthSessionPlugin)
public class NativeAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "NativeAuthSessionPlugin"
    public let jsName = "NativeAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("url and callbackScheme are required")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: callbackURL, options: [:])
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed")
                }
            }
            session.presentationContextProvider = self
            // No shared Safari cookies: skips the "wants to use <auth host> to sign in" prompt,
            // which would name the platform's auth domain rather than the brand.
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Could not start the sign-in session")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }
}

/// Saves the files behind the app's "Download" buttons. WKWebView does nothing with an
/// `<a download>` click, so src/lib/download/save-file.ts hands the file here instead:
///  - `writeChunk({fileName, data, append})` — base64 bytes into a staging file in tmp/. Big files
///    come in several calls so no single bridge message is huge.
///  - `save({fileName, mimeType})` — opens the share sheet for the staged file, which carries
///    Save to Files, Print, Mail, WhatsApp and the rest. Resolves `{savedToDownloads: false, opened}`
///    once the sheet closes, so a batch of files shows one sheet after another.
/// Lives in this file because every brand target already compiles it.
@objc(VacademyFileSavePlugin)
public class VacademyFileSavePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VacademyFileSavePlugin"
    public let jsName = "VacademyFileSave"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    private static let staleAfter: TimeInterval = 24 * 60 * 60

    @objc func writeChunk(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName"), let base64 = call.getString("data"),
              let bytes = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            call.reject("fileName and base64 data are required")
            return
        }
        let append = call.getBool("append") ?? false
        do {
            if !append { VacademyFileSavePlugin.clearStaleFiles() }
            let url = try VacademyFileSavePlugin.stagingURL(fileName)
            if append, FileManager.default.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                defer { handle.closeFile() }
                if #available(iOS 13.4, *) {
                    try handle.seekToEnd()
                    try handle.write(contentsOf: bytes)
                } else {
                    handle.seekToEndOfFile()
                    handle.write(bytes)
                }
            } else {
                try bytes.write(to: url, options: .atomic)
            }
            call.resolve()
        } catch {
            call.reject("Could not write the file", nil, error)
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName"),
              let url = try? VacademyFileSavePlugin.stagingURL(fileName),
              FileManager.default.fileExists(atPath: url.path) else {
            call.reject("Nothing was written for this file")
            return
        }
        DispatchQueue.main.async {
            guard var presenter = self.bridge?.viewController else {
                call.reject("Nowhere to show the share sheet")
                return
            }
            while let next = presenter.presentedViewController, !next.isBeingDismissed { presenter = next }
            // The promise only settles when the sheet closes, so never present where it cannot show.
            guard presenter.viewIfLoaded?.window != nil, !presenter.isBeingDismissed else {
                call.reject("Nowhere to show the share sheet")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // iPad shows the sheet as a popover, which needs an anchor.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            var finished = false
            sheet.completionWithItemsHandler = { _, _, _, _ in
                guard !finished else { return }
                finished = true
                call.resolve(["savedToDownloads": false, "opened": true])
            }
            presenter.present(sheet, animated: true)
        }
    }

    private static func stagingURL(_ fileName: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vacademy-downloads", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(safeName(fileName))
    }

    /// Files from earlier downloads that the share sheet has long finished with.
    private static func clearStaleFiles() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vacademy-downloads", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-staleAfter)
        for file in files {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let modified = modified, modified < cutoff { try? FileManager.default.removeItem(at: file) }
        }
    }

    /// No path separators or reserved characters, never empty.
    private static func safeName(_ fileName: String) -> String {
        let reserved = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
        var name = fileName.components(separatedBy: reserved).joined(separator: "_")
            .trimmingCharacters(in: .whitespaces)
        if name.hasPrefix(".") { name = "_" + name }
        return name.isEmpty ? "download" : name
    }
}
