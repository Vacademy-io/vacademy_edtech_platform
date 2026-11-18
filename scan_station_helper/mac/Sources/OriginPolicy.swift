import AppKit
import Foundation

// Which web pages may call the helper. Built-in: https://*.vacademy.io and http://localhost|127.0.0.1:<port>.
// Anything else is asked once with a native alert; the answer is remembered in UserDefaults.

enum OriginDecision {
    case allowed(String)       // echo this origin in Access-Control-Allow-Origin
    case noOriginDevAllowed    // curl / tests in dev mode
    case denied(String)        // reason for the log
}

final class OriginPolicy {
    private static let defaultsKey = "originDecisions"   // [origin: Bool]
    private let pending = Locked(Set<String>())

    func decide(_ rawOrigin: String?) -> OriginDecision {
        guard let raw = rawOrigin, !raw.isEmpty else {
            return Helper.devMode ? .noOriginDevAllowed : .denied("no Origin header (only allowed in dev mode)")
        }
        guard let origin = Self.normalize(raw) else { return .denied("malformed origin \(raw)") }
        if Self.isBuiltIn(origin) { return .allowed(origin) }
        if let saved = Self.saved()[origin] {
            return saved ? .allowed(origin) : .denied("\(origin) was refused by the user")
        }
        if Helper.noUI || (Helper.devMode && !Helper.devPrompt) {
            return .denied("\(origin) is unknown; dev/no-UI mode refuses without prompting")
        }
        let first = pending.write { $0.insert(origin).inserted }
        if first { DispatchQueue.main.async { self.prompt(origin) } }
        return .denied("\(origin) is waiting for the user's answer")
    }

    /// "scheme://host[:port]" lower-cased, or nil when it is not an http(s) origin.
    static func normalize(_ raw: String) -> String? {
        guard let c = URLComponents(string: raw.trimmingCharacters(in: .whitespaces)),
              let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = c.host?.lowercased(), !host.isEmpty,
              c.path.isEmpty || c.path == "/", c.query == nil, c.user == nil
        else { return nil }
        return "\(scheme)://\(host)" + (c.port.map { ":\($0)" } ?? "")
    }

    static func isBuiltIn(_ origin: String) -> Bool {
        guard let c = URLComponents(string: origin), let host = c.host else { return false }
        if c.scheme == "https" && host.hasSuffix(".vacademy.io") { return true }
        if c.scheme == "http" && (host == "localhost" || host == "127.0.0.1") { return true }
        return false
    }

    static func saved() -> [String: Bool] {
        (UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Bool]) ?? [:]
    }

    static func remember(_ origin: String, allowed: Bool) {
        var d = saved()
        d[origin] = allowed
        UserDefaults.standard.set(d, forKey: defaultsKey)
    }

    static func forgetAll() { UserDefaults.standard.removeObject(forKey: defaultsKey) }

    /// Main thread. One alert at a time: a second origin's block waits behind runModal's nested loop.
    private func prompt(_ origin: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Allow \(origin) to use your scanner and printer?"
        alert.informativeText = "This website wants to scan and print through Vacademy Scan Helper on this Mac. "
            + "Only allow the website your institute uses for Vacademy."
        alert.addButton(withTitle: "Allow")
        alert.addButton(withTitle: "Don't Allow")
        let allowed = alert.runModal() == .alertFirstButtonReturn
        Self.remember(origin, allowed: allowed)
        _ = pending.write { $0.remove(origin) }
        log("origin \(origin) \(allowed ? "allowed" : "refused") by the user")
    }
}
