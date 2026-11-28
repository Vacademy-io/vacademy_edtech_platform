import Foundation

// Printers through CUPS command-line tools: lpstat / lpoptions to list, lp to print.

enum Printers {
    private static let queue = DispatchQueue(label: "io.vacademy.scanhelper.printers")
    private static let maxAge: TimeInterval = 15
    private static var refreshing = false   // touched on `queue` only

    /// Cached list; refreshes in the background when stale, synchronously the very first time.
    static func list() -> [PrinterInfo] {
        let (printers, updated) = shared.read { ($0.printers, $0.printersUpdatedAt) }
        guard let at = updated else { queue.sync { refreshLocked() }; return shared.read { $0.printers } }
        if Date().timeIntervalSince(at) > maxAge {
            queue.async { if !refreshing { refreshing = true; refreshLocked(); refreshing = false } }
        }
        return printers
    }

    static func refresh() { queue.async { refreshLocked() } }

    private static func refreshLocked() {
        let found = discover()
        shared.write { $0.printers = found; $0.printersUpdatedAt = Date() }
    }

    static func discover() -> [PrinterInfo] {
        let (_, out, _) = runTool("/usr/bin/lpstat", ["-p", "-d"])
        var names: [(String, Bool)] = []
        var defaultName: String?
        for line in out.components(separatedBy: "\n") {
            if line.hasPrefix("printer ") {
                let parts = line.split(separator: " ")
                if parts.count >= 2 { names.append((String(parts[1]), !line.contains(" disabled"))) }
            } else if line.hasPrefix("system default destination:") {
                defaultName = line.dropFirst("system default destination:".count).trimmingCharacters(in: .whitespaces)
            }
        }
        return names.map { name, enabled in
            let opts = parseOptions(runTool("/usr/bin/lpoptions", ["-p", name]).1)
            let typeBits = Int(opts["printer-type"] ?? "") ?? 0
            var duplex = typeBits & 0x0008 != 0      // CUPS_PRINTER_DUPLEX
            var color = typeBits & 0x0004 != 0       // CUPS_PRINTER_COLOR
            for line in runTool("/usr/bin/lpoptions", ["-p", name, "-l"]).1.components(separatedBy: "\n") {
                guard let colon = line.firstIndex(of: ":") else { continue }
                let key = line[..<colon].split(separator: "/").first.map(String.init) ?? ""
                let choices = line[line.index(after: colon)...].split(separator: " ")
                    .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "*")) }
                if key == "Duplex" { duplex = choices.contains { $0 != "None" && $0.lowercased().contains("duplex") } }
                if key == "ColorModel" {
                    color = choices.contains { c in ["rgb", "color", "cmyk", "cmy"].contains { c.lowercased().contains($0) } }
                }
            }
            let display = opts["printer-info"].flatMap { $0.isEmpty ? nil : $0 } ?? name.replacingOccurrences(of: "_", with: " ")
            return PrinterInfo(id: name, name: display, duplex: duplex, color: color,
                               isDefault: name == defaultName, enabled: enabled)
        }
    }

    /// Parses `lpoptions -p NAME` output: key=value pairs, values may be quoted.
    static func parseOptions(_ s: String) -> [String: String] {
        var result: [String: String] = [:]
        var i = s.startIndex
        while i < s.endIndex {
            while i < s.endIndex, s[i].isWhitespace { i = s.index(after: i) }
            var key = ""
            while i < s.endIndex, s[i] != "=", !s[i].isWhitespace { key.append(s[i]); i = s.index(after: i) }
            var value = ""
            if i < s.endIndex, s[i] == "=" {
                i = s.index(after: i)
                var quote: Character?
                while i < s.endIndex {
                    let c = s[i]
                    if let q = quote {
                        if c == q { quote = nil } else if c == "\\" { i = s.index(after: i); if i < s.endIndex { value.append(s[i]) } }
                        else { value.append(c) }
                    } else if c == "'" || c == "\"" { quote = c }
                    else if c.isWhitespace { break }
                    else if c == "\\" { i = s.index(after: i); if i < s.endIndex { value.append(s[i]) } }
                    else { value.append(c) }
                    if i < s.endIndex { i = s.index(after: i) }
                }
            }
            if !key.isEmpty { result[key] = value }
        }
        return result
    }

    // MARK: printing

    static func submit(pdf: Data, printerId: String?, sides: String?, copies: String?) -> Result<String, APIError> {
        guard let printerId = printerId, !printerId.isEmpty else {
            return .failure(APIError(400, "BAD_REQUEST", "printer_id is required."))
        }
        guard let printer = list().first(where: { $0.id == printerId }) else {
            return .failure(APIError(404, "PRINTER_NOT_FOUND", "No printer with that id."))
        }
        let side = sides ?? "one-sided"
        guard ["one-sided", "two-sided-long-edge"].contains(side) else {
            return .failure(APIError(400, "BAD_REQUEST", "sides must be one-sided or two-sided-long-edge."))
        }
        if side != "one-sided" && !printer.duplex {
            return .failure(APIError(422, "UNSUPPORTED", "This printer cannot print on both sides."))
        }
        guard let n = Int(copies ?? "1"), (1...50).contains(n) else {
            return .failure(APIError(400, "BAD_REQUEST", "copies must be between 1 and 50."))
        }
        guard pdf.count > 4, pdf.prefix(5) == Data("%PDF-".utf8) else {
            return .failure(APIError(400, "BAD_REQUEST", "The body must be a PDF file."))
        }
        let id = newId()
        let dir = Helper.workDir.appendingPathComponent("print", isDirectory: true)
        let file = dir.appendingPathComponent("\(id).pdf")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try pdf.write(to: file)
        } catch {
            return .failure(APIError(500, "UNKNOWN", "Could not save the PDF: \(error.localizedDescription)"))
        }
        let (status, out, err) = runTool("/usr/bin/lp", ["-d", printerId, "-o", "sides=\(side)", "-n", String(n),
                                                          "-t", "Vacademy Scan Station", file.path])
        // "request id is Brother_DCP_T830DW-12 (1 file(s))"
        let cupsId = out.components(separatedBy: "request id is ").dropFirst().first?
            .split(separator: " ").first.map(String.init)
        guard status == 0, let jobId = cupsId else {
            try? FileManager.default.removeItem(at: file)
            return .failure(APIError(500, "PRINT_FAILED", "The printer did not accept the job: \((err + out).trimmingCharacters(in: .whitespacesAndNewlines))"))
        }
        shared.write { $0.prints[id] = PrintJob(id: id, printerId: printerId, cupsJobId: jobId, file: file, state: "queued") }
        log("print \(id): \(jobId) sides=\(side) copies=\(n)")
        return .success(id)
    }

    /// Reads the job's state from lpstat (blocking; call off the main thread).
    static func status(_ id: String) -> PrintJob? {
        guard var job = shared.read({ $0.prints[id] }) else { return nil }
        guard job.state == "queued" || job.state == "printing" else { return job }
        let active = runTool("/usr/bin/lpstat", ["-o", job.printerId]).1
        let isActive = active.components(separatedBy: "\n").contains { $0.split(separator: " ").first.map(String.init) == job.cupsJobId }
        if isActive {
            let p = runTool("/usr/bin/lpstat", ["-p", job.printerId]).1
            job.state = p.contains("now printing \(job.cupsJobId)") ? "printing" : "queued"
        } else {
            // Gone from the active list. CUPS keeps cancelled/aborted jobs in the completed list too, so
            // this cannot tell a finished job from an aborted one; report done.
            job.state = "done"
            try? FileManager.default.removeItem(at: job.file)
        }
        let updated = job
        shared.write { $0.prints[id] = updated }
        return job
    }
}
