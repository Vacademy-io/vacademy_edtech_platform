import AppKit
import Foundation

// Vacademy Scan Helper: menu-bar app bridging the Scan Station dashboard page to the local
// scanner (ImageCaptureCore) and printer (CUPS) over http://127.0.0.1:47811. See CONTRACT.md.

final class AppDelegate: NSObject, NSApplicationDelegate {
    let scanners = ScannerManager()
    var server: HTTPServer?
    var menu: StatusMenu?
    var sweepTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) { startAll() }

    func applicationWillTerminate(_ notification: Notification) { scanners.stop() }

    func startAll() {
        // Leftovers from an earlier run are not tracked any more; start clean.
        try? FileManager.default.removeItem(at: Helper.workDir)
        try? FileManager.default.createDirectory(at: Helper.workDir, withIntermediateDirectories: true)

        if !Helper.noUI { menu = StatusMenu() }
        scanners.onChange = { [weak self] in self?.menu?.refresh() }
        scanners.start()
        Printers.refresh()

        let api = API(scanners: scanners)
        let server = HTTPServer(handler: api.handle)
        do {
            try server.start { [weak self] reason in
                DispatchQueue.main.async { self?.listenFailed(reason) }
            }
            self.server = server
        } catch {
            listenFailed("\(error)")
        }

        let t = Timer(timeInterval: 600, repeats: true) { _ in Self.sweepOldJobs() }
        RunLoop.main.add(t, forMode: .common)
        sweepTimer = t
        log("Vacademy Scan Helper \(Helper.version) started\(Helper.devMode ? " (dev mode)" : "")")
    }

    private func listenFailed(_ reason: String) {
        shared.write { $0.listenError = "port \(Helper.port) unavailable (\(reason))" }
        menu?.refresh()
        log("cannot listen on 127.0.0.1:\(Helper.port): \(reason). Is another copy running?")
        if Helper.noUI || Helper.devMode { exit(1) }
    }

    /// Jobs older than 6 h are removed with their files.
    static func sweepOldJobs() {
        let cutoff = Date().addingTimeInterval(-6 * 3600)
        let old: [ScanJob] = shared.write { s in
            let gone = s.jobs.values.filter { $0.createdAt < cutoff && !$0.isActive }
            for j in gone { s.jobs[j.id] = nil }
            s.prints = s.prints.filter { $0.value.createdAt >= cutoff }
            return Array(gone)
        }
        for j in old { try? FileManager.default.removeItem(at: j.dir) }
        if !old.isEmpty { log("swept \(old.count) old job(s)") }
    }
}

let args = CommandLine.arguments
if args.count > 1 && args[1] == "--convert-test" {
    exit(PageConverter.selfTest(Array(args.dropFirst(2))))
}
if args.count > 1 && args[1] == "--version" {
    print(Helper.version); exit(0)
}

let delegate = AppDelegate()

// Ctrl-C / kill: close scanner sessions so Image Capture can use the scanner straight away.
signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler {
        log("signal \(sig): closing scanner sessions and exiting")
        delegate.scanners.stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
    }
    src.resume()
    signalSources.append(src)
}

if Helper.noUI {
    delegate.startAll()
    RunLoop.main.run()
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    app.run()
}
