import Foundation

// Version, settings and the state shared between the HTTP queue and the main thread.

enum Helper {
    // build.sh reads this line to fill CFBundleShortVersionString; keep the format.
    static let version = "0.1.0"
    static let port: UInt16 = 47811
    static let env = ProcessInfo.processInfo.environment
    /// VACADEMY_SCAN_HELPER_DEV=1: requests without an Origin header (curl) are allowed and
    /// unknown origins are refused without showing the prompt (set VACADEMY_SCAN_HELPER_PROMPT=1 to prompt).
    static let devMode = env["VACADEMY_SCAN_HELPER_DEV"] == "1"
    static let devPrompt = env["VACADEMY_SCAN_HELPER_PROMPT"] == "1"
    /// VACADEMY_SCAN_HELPER_NO_UI=1: no menu-bar item and no prompts (for runs without a GUI session).
    static let noUI = env["VACADEMY_SCAN_HELPER_NO_UI"] == "1"
    static let workDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("VacademyScanHelper", isDirectory: true)
}

private let logFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private let logLock = NSLock()

func log(_ message: String) {
    logLock.lock(); defer { logLock.unlock() }
    let line = "\(logFormatter.string(from: Date())) \(message)\n"
    FileHandle.standardError.write(Data(line.utf8))
}

/// A value guarded by a lock.
final class Locked<Value> {
    private var value: Value
    private let lock = NSLock()
    init(_ value: Value) { self.value = value }
    func read<T>(_ body: (Value) throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }
        return try body(value)
    }
    @discardableResult
    func write<T>(_ body: (inout Value) throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }
        return try body(&value)
    }
}

struct APIError: Error {
    let status: Int
    let code: String
    let message: String
    init(_ status: Int, _ code: String, _ message: String) {
        self.status = status; self.code = code; self.message = message
    }
}

struct JobError {
    let code: String     // PAPER_JAM | NO_PAPER | DEVICE_GONE | SCANNER_BUSY | UNKNOWN
    let message: String
    var json: [String: Any] { ["code": code, "message": message] }
}

struct ScannerSnapshot {
    var id: String
    var name: String
    var transport: String          // usb | network
    var available: Bool
    var busyReason: String?        // OTHER_APP | SCANNING | nil
    var feederPresent: Bool
    var feederDuplex: Bool
    var paperLoaded: Bool?
    var flatbedPresent: Bool
    var detail: String             // human text for the menu

    var json: [String: Any] {
        [
            "id": id, "name": name, "transport": transport, "available": available,
            "busy_reason": busyReason ?? NSNull(),
            "feeder": ["present": feederPresent, "duplex": feederDuplex,
                       "paper_loaded": paperLoaded.map { $0 as Any } ?? NSNull()],
            "flatbed": ["present": flatbedPresent],
        ]
    }
}

struct ScanPage {
    let index: Int
    let width: Int
    let height: Int
    let bytes: Int
}

struct ScanJob {
    let id: String
    let scannerId: String
    let source: String             // feeder | flatbed
    let duplex: Bool
    var dpi: Int
    let color: Bool
    let dir: URL
    let createdAt = Date()
    var state = "starting"         // starting | scanning | done | failed | cancelled
    var pages: [ScanPage] = []
    var error: JobError?
    var lastActivity = Date()
    var cancelledAt: Date?

    var isActive: Bool { state == "starting" || state == "scanning" }
    var pagesDir: URL { dir.appendingPathComponent("pages", isDirectory: true) }
    var rawDir: URL { dir.appendingPathComponent("raw", isDirectory: true) }

    func pageURL(_ index: Int) -> URL { pagesDir.appendingPathComponent("\(index).jpg") }
    func thumbURL(_ index: Int) -> URL { pagesDir.appendingPathComponent("\(index)-thumb.jpg") }

    var json: [String: Any] {
        [
            "job_id": id, "state": state, "source": source, "duplex": duplex,
            "pages": pages.map { p -> [String: Any] in
                ["index": p.index, "width": p.width, "height": p.height, "bytes": p.bytes,
                 "image_url": "/v1/scan/\(id)/pages/\(p.index).jpg",
                 "thumb_url": "/v1/scan/\(id)/pages/\(p.index)/thumb.jpg"]
            },
            "error": error.map { $0.json as Any } ?? NSNull(),
        ]
    }
}

struct PrinterInfo {
    let id: String
    let name: String
    let duplex: Bool
    let color: Bool
    let isDefault: Bool
    let enabled: Bool
    var json: [String: Any] {
        ["id": id, "name": name, "duplex": duplex, "color": color, "default": isDefault]
    }
}

struct PrintJob {
    let id: String
    let printerId: String
    let cupsJobId: String
    let file: URL
    var state: String              // queued | printing | done | failed
    var error: JobError?
    let createdAt = Date()
}

struct SharedState {
    var scanners: [ScannerSnapshot] = []
    var jobs: [String: ScanJob] = [:]
    var printers: [PrinterInfo] = []
    var printersUpdatedAt: Date?
    var prints: [String: PrintJob] = [:]
    var listenError: String?
}

let shared = Locked(SharedState())

func newId() -> String { UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "") }

/// Runs a command-line tool with the C locale and returns (exit status, stdout, stderr).
func runTool(_ path: String, _ args: [String], timeout: TimeInterval = 10) -> (Int32, String, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["LC_ALL"] = "C"; env["LANG"] = "C"
    p.environment = env
    let out = Pipe(), err = Pipe()
    p.standardOutput = out; p.standardError = err
    p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return (-1, "", "\(error)") }
    let timer = DispatchWorkItem { if p.isRunning { p.terminate() } }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
    var errData = Data()
    let group = DispatchGroup()
    group.enter()
    DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
    let outData = out.fileHandleForReading.readDataToEndOfFile()
    group.wait()
    p.waitUntilExit()
    timer.cancel()
    return (p.terminationStatus, String(decoding: outData, as: UTF8.self), String(decoding: errData, as: UTF8.self))
}
