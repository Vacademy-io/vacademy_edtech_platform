import AuthenticationServices
import Capacitor
import WebKit

/// App's bridge view controller subclass. Two responsibilities beyond the Capacitor default:
///
/// 1. Registers the `offline-media://` URL scheme handler on the WKWebViewConfiguration
///    *before* the WKWebView is constructed (must happen here — WKWebViewConfiguration's
///    scheme handlers are immutable once the web view exists).
/// 2. Registers the `OfflineMediaPlugin` instance once the bridge is available. This plugin is
///    a local, in-repo plugin (no npm package), so it is not present in `capacitor.config.json`'s
///    auto-registration list and must be registered manually via `registerPluginInstance`.
///
/// Main.storyboard's root view controller's custom class has been changed from
/// `CAPBridgeViewController` (Capacitor module) to `MainViewController` (App module) to route
/// through this subclass.
class MainViewController: CAPBridgeViewController {

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.setURLSchemeHandler(OfflineMediaSchemeHandler(), forURLScheme: OfflineMediaPlugin.scheme)
        return configuration
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OfflineMediaPlugin())
        bridge?.registerPluginInstance(NativeAuthSessionPlugin())
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
