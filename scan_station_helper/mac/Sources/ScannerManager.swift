import Foundation
import ImageCaptureCore

// Finds scanners with ImageCaptureCore, keeps a session open on each (so status is fast and the
// feeder's paper sensor is current), and runs scan jobs. Everything here runs on the MAIN thread;
// results are published into `shared` for the HTTP queue.

struct ScanRequest {
    var scannerId: String?
    var source: String
    var duplex: Bool
    var dpi: Int
    var color: Bool
}

final class ScannerManager: NSObject, ICDeviceBrowserDelegate, ICScannerDeviceDelegate {
    private final class Entry {
        let device: ICScannerDevice
        let id: String
        var sessionOpen = false
        var opening = false
        var ready = false
        var otherApp = false
        var lastProblem: String?
        var retryTimer: Timer?
        var lastPaperRefresh = Date.distantPast
        var activeJobId: String?
        var pending: (jobId: String, unit: ICScannerFunctionalUnitType)?   // waiting for the unit select
        var removed = false
        var lastPaper: Bool?
        var jobError: JobError?        // error reported mid-scan; used if the completion carries none
        init(device: ICScannerDevice, id: String) { self.device = device; self.id = id }
    }

    private let browser = ICDeviceBrowser()
    private var entries: [String: Entry] = [:]
    private var watchdog: Timer?
    var onChange: (() -> Void)?

    static let idleTimeout: TimeInterval = 180     // no page and no completion for this long → fail
    static let cancelGrace: TimeInterval = 15

    func start() {
        browser.delegate = self
        let mask = ICDeviceTypeMask.scanner.rawValue | ICDeviceLocationTypeMask.local.rawValue
            | ICDeviceLocationTypeMask.shared.rawValue | ICDeviceLocationTypeMask.bonjour.rawValue
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(rawValue: mask)!
        browser.start()
        let t = Timer(timeInterval: 5, repeats: true) { [weak self] _ in self?.checkJobs() }
        RunLoop.main.add(t, forMode: .common)
        watchdog = t
        log("scanner browser started")
    }

    func stop() {
        browser.stop()
        for e in entries.values where e.sessionOpen {
            if e.activeJobId != nil { e.device.cancelScan() }
            e.device.requestCloseSession()
        }
    }

    // MARK: identity helpers

    private func entry(for device: ICDevice) -> Entry? {
        entries.values.first { $0.device === device }
    }

    private static func stableId(_ d: ICDevice) -> String {
        if let p = d.persistentIDString, !p.isEmpty { return p }
        if let u = d.uuidString, !u.isEmpty { return u }
        return "\(d.name ?? "scanner")|\(d.transportType ?? "")"
    }

    private static func transport(_ d: ICDevice) -> String {
        d.transportType == ICDeviceTransport.transportTypeUSB.rawValue ? "usb" : "network"
    }

    private static func isOtherAppError(_ error: Error) -> Bool {
        let code = (error as NSError).code
        return [-47, 4294967249, -9925, -9926, -9914, -21347].contains(code)
    }

    // MARK: publishing

    func publish() {
        var snaps: [ScannerSnapshot] = []
        for e in entries.values.sorted(by: { $0.id < $1.id }) where !e.removed {
            let d = e.device
            let types = Set(d.availableFunctionalUnitTypes.map { $0.uintValue })
            let hasFeeder = types.contains(ICScannerFunctionalUnitType.documentFeeder.rawValue)
            let hasFlatbed = types.contains(ICScannerFunctionalUnitType.flatbed.rawValue)
            let feeder = e.sessionOpen ? (d.selectedFunctionalUnit as ICScannerFunctionalUnit?) as? ICScannerFunctionalUnitDocumentFeeder : nil
            let scanning = e.activeJobId != nil
            let busy: String? = scanning ? "SCANNING" : (e.otherApp ? "OTHER_APP" : nil)
            let available = e.sessionOpen && e.ready && !scanning
            var detail: String
            if scanning { detail = "scanning" }
            else if e.otherApp { detail = "busy: another app is using it (close Image Capture)" }
            else if available { detail = feeder.map { $0.documentLoaded ? "ready, paper in feeder" : "ready, feeder empty" } ?? "ready" }
            else if let p = e.lastProblem { detail = "not ready: \(p)" }
            else { detail = "connecting…" }
            snaps.append(ScannerSnapshot(
                id: e.id, name: d.name ?? "Scanner", transport: Self.transport(d),
                available: available, busyReason: busy,
                feederPresent: hasFeeder, feederDuplex: feeder?.supportsDuplexScanning ?? false,
                paperLoaded: feeder.map { $0.documentLoaded },
                flatbedPresent: hasFlatbed, detail: detail))
        }
        shared.write { $0.scanners = snaps }
        onChange?()
    }

    // MARK: sessions

    private func openSession(_ e: Entry) {
        guard !e.removed, !e.sessionOpen, !e.opening else { return }
        e.retryTimer?.invalidate(); e.retryTimer = nil
        e.opening = true
        e.device.requestOpenSession()
    }

    private func scheduleRetry(_ e: Entry, after seconds: TimeInterval) {
        e.retryTimer?.invalidate()
        let t = Timer(timeInterval: seconds, repeats: false) { [weak self, weak e] _ in
            guard let self = self, let e = e else { return }
            self.openSession(e)
        }
        RunLoop.main.add(t, forMode: .common)
        e.retryTimer = t
    }

    private func selectDefaultUnit(_ e: Entry) {
        let types = e.device.availableFunctionalUnitTypes.map { $0.uintValue }
        let want: ICScannerFunctionalUnitType =
            types.contains(ICScannerFunctionalUnitType.documentFeeder.rawValue) ? .documentFeeder : .flatbed
        if (e.device.selectedFunctionalUnit as ICScannerFunctionalUnit?)?.type == want { publish(); return }
        e.device.requestSelect(want)
    }

    /// Called on each status request: re-selects the feeder (cheap) so `documentLoaded` is fresh.
    func refreshPaperIfCheap() {
        for e in entries.values where e.sessionOpen && e.ready && e.activeJobId == nil && e.pending == nil {
            guard Date().timeIntervalSince(e.lastPaperRefresh) > 3,
                  e.device.availableFunctionalUnitTypes.contains(NSNumber(value: ICScannerFunctionalUnitType.documentFeeder.rawValue))
            else { continue }
            e.lastPaperRefresh = Date()
            e.device.requestSelect(.documentFeeder)
        }
    }

    // MARK: ICDeviceBrowserDelegate

    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let scanner = device as? ICScannerDevice else { return }
        var id = Self.stableId(scanner)
        if let existing = entries[id], existing.device !== scanner { id += "#\(entries.count)" }
        let e = Entry(device: scanner, id: id)
        entries[id] = e
        scanner.delegate = self
        log("scanner found: \(scanner.name ?? "?") [\(scanner.transportType ?? "?")] id=\(id)")
        openSession(e)
        publish()
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        removeDevice(device)
    }

    private func removeDevice(_ device: ICDevice) {
        guard let e = entry(for: device) else { return }
        log("scanner gone: \(device.name ?? "?")")
        e.removed = true
        e.retryTimer?.invalidate()
        if let job = e.activeJobId { finish(e, jobId: job, error: JobError(code: "DEVICE_GONE", message: "The scanner was disconnected.")) }
        entries[e.id] = nil
        publish()
    }

    // MARK: ICDeviceDelegate

    func didRemove(_ device: ICDevice) { removeDevice(device) }

    func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
        guard let e = entry(for: device) else { return }
        e.opening = false
        if let error = error {
            let wasOtherApp = e.otherApp
            e.sessionOpen = false
            e.otherApp = Self.isOtherAppError(error)
            e.lastProblem = e.otherApp ? "another app is using it" : "could not connect (\((error as NSError).code))"
            if !wasOtherApp || !e.otherApp { log("open session \(device.name ?? "?") failed: \(error) → \(e.otherApp ? "OTHER_APP" : "retry")") }
            scheduleRetry(e, after: 5)
        } else {
            log("session open: \(device.name ?? "?")")
            e.sessionOpen = true
            e.otherApp = false
            e.lastProblem = nil
            if !e.device.availableFunctionalUnitTypes.isEmpty { e.ready = true; selectDefaultUnit(e) }
        }
        publish()
    }

    func deviceDidBecomeReady(_ device: ICDevice) {
        guard let e = entry(for: device) else { return }
        e.ready = true
        selectDefaultUnit(e)
        publish()
    }

    func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
        guard let e = entry(for: device) else { return }
        log("session closed: \(device.name ?? "?") \(error.map { "\($0)" } ?? "")")
        e.sessionOpen = false; e.ready = false; e.opening = false
        if let job = e.activeJobId {
            finish(e, jobId: job, error: JobError(code: "DEVICE_GONE", message: "The scanner closed the connection."))
        }
        scheduleRetry(e, after: 3)
        publish()
    }

    func device(_ device: ICDevice, didEncounterError error: Error?) {
        guard let e = entry(for: device), let error = error else { return }
        log("device error \(device.name ?? "?"): \(error)")
        // Keep the job open until the scanner reports completion (or the watchdog fires), so a new
        // scan cannot start while the device is still busy; remember the error for the final state.
        if e.activeJobId != nil { e.jobError = Self.mapScanError(error) }
    }

    func device(_ device: ICDevice, didReceiveStatusInformation status: [ICDeviceStatus: Any]) {
        if !status.isEmpty { log("device status \(device.name ?? "?"): \(status)") }
    }

    // MARK: ICScannerDeviceDelegate

    func scannerDeviceDidBecomeAvailable(_ scanner: ICScannerDevice) {
        guard let e = entry(for: scanner) else { return }
        log("scanner available again: \(scanner.name ?? "?")")
        openSession(e)
    }

    func scannerDevice(_ scanner: ICScannerDevice, didSelect functionalUnit: ICScannerFunctionalUnit, error: Error?) {
        guard let e = entry(for: scanner) else { return }
        if let p = e.pending {
            if let error = error {
                e.pending = nil
                finish(e, jobId: p.jobId, error: JobError(code: "UNKNOWN", message: "Could not select the \(p.unit == .documentFeeder ? "feeder" : "glass"): \(error.localizedDescription)"))
            } else if functionalUnit.type == p.unit {
                e.pending = nil
                beginScan(e, jobId: p.jobId, unit: functionalUnit)
            } else {
                scanner.requestSelect(p.unit)
            }
        } else if let error = error {
            log("select unit \(functionalUnit.type.rawValue) on \(scanner.name ?? "?") failed: \(error)")
        } else if let f = functionalUnit as? ICScannerFunctionalUnitDocumentFeeder, f.documentLoaded != e.lastPaper {
            e.lastPaper = f.documentLoaded
            log("feeder on \(scanner.name ?? "?"): \(f.documentLoaded ? "paper loaded" : "empty")")
        }
        publish()
    }

    func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
        guard let e = entry(for: scanner), let jobId = e.activeJobId else {
            try? FileManager.default.removeItem(at: url); return
        }
        let job: ScanJob? = shared.write {
            $0.jobs[jobId]?.lastActivity = Date()
            if $0.jobs[jobId]?.state == "starting" { $0.jobs[jobId]?.state = "scanning" }
            return $0.jobs[jobId]
        }
        guard let j = job else { try? FileManager.default.removeItem(at: url); return }
        log("job \(jobId): file from scanner \(url.lastPathComponent)")
        PageConverter.queue.async { Self.convert(url, job: j) }
    }

    func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: Error?) {
        guard let e = entry(for: scanner), let jobId = e.activeJobId else { return }
        log("job \(jobId): scanner finished \(error.map { "with \($0)" } ?? "OK")")
        finish(e, jobId: jobId, error: error.map { Self.mapScanError($0) } ?? e.jobError)
    }

    // MARK: jobs

    func startScan(_ r: ScanRequest) -> Result<String, APIError> {
        let live = entries.values.filter { !$0.removed }
        let e: Entry
        if let id = r.scannerId, !id.isEmpty {
            guard let found = live.first(where: { $0.id == id }) else {
                return .failure(APIError(404, "SCANNER_NOT_FOUND", "No scanner with that id is connected."))
            }
            e = found
        } else if live.count == 1 {
            e = live[0]
        } else {
            return .failure(APIError(live.isEmpty ? 404 : 400, live.isEmpty ? "SCANNER_NOT_FOUND" : "BAD_REQUEST",
                                     live.isEmpty ? "No scanner is connected." : "Say which scanner (scanner_id)."))
        }
        if entries.values.contains(where: { $0.activeJobId != nil }) || shared.read({ $0.jobs.values.contains { $0.isActive } }) {
            return .failure(APIError(409, "SCANNER_BUSY", "A scan is already running."))
        }
        if e.otherApp {
            return .failure(APIError(409, "SCANNER_BUSY", "Another app (for example Image Capture) is using the scanner. Close it and try again."))
        }
        guard e.sessionOpen, e.ready else {
            return .failure(APIError(409, "SCANNER_BUSY", "The scanner is still connecting. Try again in a few seconds."))
        }
        let types = e.device.availableFunctionalUnitTypes.map { $0.uintValue }
        let unit: ICScannerFunctionalUnitType = r.source == "flatbed" ? .flatbed : .documentFeeder
        guard types.contains(unit.rawValue) else {
            return .failure(APIError(422, "UNSUPPORTED", r.source == "flatbed" ? "This scanner has no glass." : "This scanner has no document feeder."))
        }
        if unit == .documentFeeder, let f = (e.device.selectedFunctionalUnit as ICScannerFunctionalUnit?) as? ICScannerFunctionalUnitDocumentFeeder {
            if r.duplex && !f.supportsDuplexScanning {
                return .failure(APIError(422, "UNSUPPORTED", "This feeder scans one side only."))
            }
            if !f.documentLoaded {
                return .failure(APIError(422, "NO_PAPER", "There is no paper in the feeder."))
            }
        }
        let id = newId()
        let dir = Helper.workDir.appendingPathComponent("jobs/\(id)", isDirectory: true)
        let job = ScanJob(id: id, scannerId: e.id, source: r.source, duplex: r.duplex && unit == .documentFeeder,
                          dpi: r.dpi, color: r.color, dir: dir)
        do {
            try FileManager.default.createDirectory(at: job.rawDir, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: job.pagesDir, withIntermediateDirectories: true)
        } catch {
            return .failure(APIError(500, "UNKNOWN", "Could not create a temporary folder: \(error.localizedDescription)"))
        }
        shared.write { $0.jobs[id] = job }
        e.activeJobId = id
        e.jobError = nil
        e.pending = (id, unit)
        log("job \(id): start \(r.source) duplex=\(job.duplex) dpi=\(r.dpi) color=\(r.color) on \(e.device.name ?? "?")")
        e.device.requestSelect(unit)       // didSelect → beginScan (also refreshes the paper sensor)
        publish()
        return .success(id)
    }

    private func beginScan(_ e: Entry, jobId: String, unit fu: ICScannerFunctionalUnit) {
        guard let job = shared.read({ $0.jobs[jobId] }), job.state == "starting" else {
            e.activeJobId = nil; publish(); return
        }
        if let f = fu as? ICScannerFunctionalUnitDocumentFeeder {
            if !f.documentLoaded {
                finish(e, jobId: jobId, error: JobError(code: "NO_PAPER", message: "There is no paper in the feeder."))
                return
            }
            if f.supportedDocumentTypes.contains(Int(ICScannerDocumentType.typeA4.rawValue)) { f.documentType = .typeA4 }
            f.duplexScanningEnabled = job.duplex && f.supportsDuplexScanning
        }
        if let fb = fu as? ICScannerFunctionalUnitFlatbed {
            fb.measurementUnit = .inches
            let size = fb.physicalSize
            fb.scanArea = NSRect(x: 0, y: 0, width: size.width, height: size.height)
        }
        fu.pixelDataType = job.color ? .RGB : .gray
        if fu.supportedBitDepths.contains(8) { fu.bitDepth = .depth8Bits }
        let resolutions = Array(fu.supportedResolutions)
        if let best = resolutions.min(by: { abs($0 - job.dpi) < abs($1 - job.dpi) }) { fu.resolution = best }
        let realDpi = Int(fu.resolution)
        shared.write { $0.jobs[jobId]?.dpi = realDpi > 0 ? realDpi : job.dpi; $0.jobs[jobId]?.state = "scanning"; $0.jobs[jobId]?.lastActivity = Date() }

        let d = e.device
        d.transferMode = .fileBased
        d.downloadsDirectory = job.rawDir
        d.documentName = "page"
        d.documentUTI = "public.tiff"
        log("job \(jobId): requestScan unit=\(fu.type.rawValue) dpi=\(realDpi) duplex=\((fu as? ICScannerFunctionalUnitDocumentFeeder)?.duplexScanningEnabled ?? false)")
        d.requestScan()
        publish()
    }

    /// Ends the device side of a job. Pages still being converted are kept; the final state is set
    /// on the conversion queue so it lands after the last page.
    private func finish(_ e: Entry, jobId: String, error: JobError?) {
        if e.activeJobId == jobId { e.activeJobId = nil }
        if e.pending?.jobId == jobId { e.pending = nil }
        PageConverter.queue.async {
            shared.write { s in
                guard var j = s.jobs[jobId], j.isActive else { return }
                if let err = error {
                    // A feeder that ran out after delivering pages is a normal end, not a failure.
                    if err.code == "NO_PAPER" && !j.pages.isEmpty && j.source == "feeder" { j.state = "done" }
                    else { j.state = "failed"; j.error = err }
                } else {
                    j.state = "done"
                }
                s.jobs[jobId] = j
            }
            DispatchQueue.main.async { self.publish() }
        }
        publish()
    }

    func cancel(jobId: String) -> Result<Void, APIError> {
        let state: String? = shared.write { s in
            guard var j = s.jobs[jobId] else { return nil }
            if j.isActive { j.state = "cancelled"; j.cancelledAt = Date(); s.jobs[jobId] = j }
            return j.state
        }
        guard state != nil else { return .failure(APIError(404, "NOT_FOUND", "No such scan job.")) }
        if let e = entries.values.first(where: { $0.activeJobId == jobId }) {
            if e.pending?.jobId == jobId { e.pending = nil; e.activeJobId = nil }
            else { e.device.cancelScan() }   // activeJobId clears on didComplete, or after the grace period
            log("job \(jobId): cancel requested")
        }
        publish()
        return .success(())
    }

    /// Watchdog: frees a scanner whose cancel never completed and fails jobs that went silent.
    private func checkJobs() {
        for e in entries.values {
            guard let jobId = e.activeJobId else { continue }
            guard let j = shared.read({ $0.jobs[jobId] }) else { e.activeJobId = nil; continue }
            if j.state == "cancelled", let at = j.cancelledAt, Date().timeIntervalSince(at) > Self.cancelGrace {
                e.activeJobId = nil; publish()
            } else if j.isActive, Date().timeIntervalSince(j.lastActivity) > Self.idleTimeout {
                log("job \(jobId): no progress for \(Int(Self.idleTimeout)) s, giving up")
                e.device.cancelScan()
                finish(e, jobId: jobId, error: JobError(code: "UNKNOWN", message: "The scanner stopped responding."))
            }
        }
    }

    static func mapScanError(_ error: Error) -> JobError {
        let ns = error as NSError
        let text = ([ns.localizedDescription, ns.localizedFailureReason ?? ""]
                    + ns.userInfo.values.map { "\($0)" }).joined(separator: " ").lowercased()
        switch ns.code {
        case -9924: return JobError(code: "UNKNOWN", message: "The scan was cancelled.")
        case -47, 4294967249, -9925, -9926, -9914:
            return JobError(code: "SCANNER_BUSY", message: "Another app is using the scanner.")
        case -9901, -9902, -21350, -21349, -21348:
            return JobError(code: "DEVICE_GONE", message: "The scanner was disconnected.")
        default: break
        }
        if text.contains("jam") { return JobError(code: "PAPER_JAM", message: "Paper jam. Clear the feeder, then scan this pile again.") }
        if text.contains("no paper") || text.contains("no document") || text.contains("empty") || text.contains("out of paper") {
            return JobError(code: "NO_PAPER", message: "There is no paper in the feeder.")
        }
        if text.contains("busy") || text.contains("in use") {
            return JobError(code: "SCANNER_BUSY", message: "The scanner is busy.")
        }
        return JobError(code: "UNKNOWN", message: "The scanner reported an error: \(ns.localizedDescription) (\(ns.code))")
    }

    /// Conversion queue. Appends pages in order; stops if the job was cancelled or deleted.
    private static func convert(_ url: URL, job: ScanJob) {
        defer { try? FileManager.default.removeItem(at: url) }
        let ok = PageConverter.convertAll(source: url, fallbackDpi: job.dpi, next: {
            shared.read { s -> (Int, URL, URL)? in
                guard let j = s.jobs[job.id], j.state != "cancelled" else { return nil }
                let i = j.pages.count
                return (i, j.pageURL(i), j.thumbURL(i))
            }
        }, done: { index, out in
            shared.write { s in
                guard s.jobs[job.id] != nil else { return }
                s.jobs[job.id]?.pages.append(ScanPage(index: index, width: out.width, height: out.height, bytes: out.bytes))
                s.jobs[job.id]?.lastActivity = Date()
            }
            log("job \(job.id): page \(index) \(out.width)x\(out.height) \(out.bytes) bytes")
        })
        if !ok {
            log("job \(job.id): could not read \(url.lastPathComponent)")
            shared.write { s in
                guard var j = s.jobs[job.id], j.isActive else { return }
                j.state = "failed"
                j.error = JobError(code: "UNKNOWN", message: "A page from the scanner could not be read.")
                s.jobs[job.id] = j
            }
        }
    }
}
