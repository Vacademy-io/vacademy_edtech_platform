import Foundation

// Routes for the local bridge (see CONTRACT.md): origin/CORS checks first, then the endpoints.

final class API {
    let scanners: ScannerManager       // main thread only
    let origins = OriginPolicy()
    private let work = DispatchQueue(label: "io.vacademy.scanhelper.work", attributes: .concurrent)

    init(scanners: ScannerManager) { self.scanners = scanners }

    func handle(_ req: HTTPRequest, _ respond: @escaping (HTTPResponse) -> Void) {
        // DNS-rebinding guard: only our own loopback host names.
        let host = (req.headers["host"] ?? "").lowercased()
        guard ["127.0.0.1:\(Helper.port)", "localhost:\(Helper.port)"].contains(host) else {
            respond(.error(421, "BAD_HOST", "Use http://127.0.0.1:\(Helper.port)."))
            return
        }
        var cors: [(String, String)] = [("Vary", "Origin")]
        switch origins.decide(req.headers["origin"]) {
        case .allowed(let origin):
            cors.append(("Access-Control-Allow-Origin", origin))
        case .noOriginDevAllowed:
            break
        case .denied(let why):
            log("\(req.method) \(req.path) refused: \(why)")
            var r = HTTPResponse.error(403, "ORIGIN_NOT_ALLOWED", "This website is not allowed to use the scanner helper.")
            r.headers += cors
            // Let the page read this refusal (so it can say "click Allow") but never pass a preflight.
            if req.method != "OPTIONS", let o = req.headers["origin"].flatMap(OriginPolicy.normalize) {
                r.headers.append(("Access-Control-Allow-Origin", o))
            }
            respond(r)
            return
        }
        let finish: (HTTPResponse) -> Void = { r in
            var r = r
            r.headers += cors
            respond(r)
        }
        if req.method == "OPTIONS" {
            var r = HTTPResponse.empty(204)
            r.headers = [
                ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"),
                ("Access-Control-Allow-Headers", "Content-Type"),
                ("Access-Control-Allow-Private-Network", "true"),
                ("Access-Control-Max-Age", "600"),
            ]
            finish(r)
            return
        }
        route(req, finish)
    }

    private func route(_ req: HTTPRequest, _ respond: @escaping (HTTPResponse) -> Void) {
        let parts = req.path.split(separator: "/").map(String.init)
        let m = req.method
        func onMain(_ body: @escaping () -> HTTPResponse) { DispatchQueue.main.async { respond(body()) } }
        func onWork(_ body: @escaping () -> HTTPResponse) { work.async { respond(body()) } }
        let methodNotAllowed = HTTPResponse.error(405, "METHOD_NOT_ALLOWED", "Method not allowed here.")

        guard parts.first == "v1", parts.count >= 2 else {
            respond(.error(404, "NOT_FOUND", "Unknown path.")); return
        }
        switch (parts[1], parts.count) {
        case ("status", 2):
            guard m == "GET" else { respond(methodNotAllowed); return }
            DispatchQueue.main.async { self.scanners.refreshPaperIfCheap() }
            onWork { .json(200, Self.statusJSON()) }

        case ("scan", 2):
            guard m == "POST" else { respond(methodNotAllowed); return }
            let r: ScanRequest
            switch Self.parseScan(req.body) {
            case .failure(let e): respond(.error(e)); return
            case .success(let v): r = v
            }
            onMain {
                switch self.scanners.startScan(r) {
                case .success(let id): return .json(202, ["job_id": id])
                case .failure(let e): return .error(e)
                }
            }

        case ("scan", 3):
            let id = parts[2]
            if m == "GET" {
                guard let job = shared.read({ $0.jobs[id] }) else { respond(Self.noJob); return }
                respond(.json(200, job.json))
            } else if m == "DELETE" {
                onMain {
                    guard let job = shared.read({ $0.jobs[id] }) else { return Self.noJob }
                    if job.isActive { _ = self.scanners.cancel(jobId: id) }
                    shared.write { $0.jobs[id] = nil }
                    PageConverter.queue.async { try? FileManager.default.removeItem(at: job.dir) }
                    log("job \(id): deleted")
                    return .empty(204)
                }
            } else { respond(methodNotAllowed) }

        case ("scan", 4) where parts[3] == "cancel":
            guard m == "POST" else { respond(methodNotAllowed); return }
            let id = parts[2]
            onMain {
                switch self.scanners.cancel(jobId: id) {
                case .success: return .json(200, shared.read { $0.jobs[id]?.json } ?? [:])
                case .failure(let e): return .error(e)
                }
            }

        case ("scan", 5) where parts[3] == "pages" && parts[4].hasSuffix(".jpg"):
            guard m == "GET" else { respond(methodNotAllowed); return }
            serveImage(jobId: parts[2], index: String(parts[4].dropLast(4)), thumb: false, respond)

        case ("scan", 6) where parts[3] == "pages" && parts[5] == "thumb.jpg":
            guard m == "GET" else { respond(methodNotAllowed); return }
            serveImage(jobId: parts[2], index: parts[4], thumb: true, respond)

        case ("print", 2):
            guard m == "POST" else { respond(methodNotAllowed); return }
            let q = req.query, body = req.body
            onWork {
                switch Printers.submit(pdf: body, printerId: q["printer_id"], sides: q["sides"], copies: q["copies"]) {
                case .success(let id): return .json(202, ["print_id": id])
                case .failure(let e): return .error(e)
                }
            }

        case ("print", 3):
            guard m == "GET" else { respond(methodNotAllowed); return }
            let id = parts[2]
            onWork {
                guard let job = Printers.status(id) else { return .error(404, "NOT_FOUND", "No such print job.") }
                return .json(200, ["print_id": job.id, "state": job.state, "error": job.error.map { $0.json as Any } ?? NSNull()])
            }

        default:
            respond(.error(404, "NOT_FOUND", "Unknown path."))
        }
    }

    private static let noJob = HTTPResponse.error(404, "NOT_FOUND", "No such scan job.")

    private func serveImage(jobId: String, index: String, thumb: Bool, _ respond: @escaping (HTTPResponse) -> Void) {
        guard let i = Int(index), let job = shared.read({ $0.jobs[jobId] }) else { respond(Self.noJob); return }
        guard job.pages.contains(where: { $0.index == i }) else {
            respond(.error(404, "NOT_FOUND", "No such page.")); return
        }
        let url = thumb ? job.thumbURL(i) : job.pageURL(i)
        work.async {
            guard let data = try? Data(contentsOf: url) else { respond(.error(404, "NOT_FOUND", "Page file missing.")); return }
            respond(HTTPResponse(status: 200, headers: [("Content-Type", "image/jpeg")], body: data))
        }
    }

    static func parseScan(_ body: Data) -> Result<ScanRequest, APIError> {
        let bad = { (msg: String) in Result<ScanRequest, APIError>.failure(APIError(400, "BAD_REQUEST", msg)) }
        let obj: [String: Any]
        if body.isEmpty { obj = [:] } else {
            guard let o = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return bad("Body must be a JSON object.") }
            obj = o
        }
        let source = obj["source"] as? String ?? "feeder"
        guard source == "feeder" || source == "flatbed" else { return bad("source must be feeder or flatbed.") }
        let dpi = (obj["dpi"] as? NSNumber)?.intValue ?? 300
        guard (75...1200).contains(dpi) else { return bad("dpi must be between 75 and 1200.") }
        return .success(ScanRequest(scannerId: obj["scanner_id"] as? String, source: source,
                                    duplex: obj["duplex"] as? Bool ?? false, dpi: dpi,
                                    color: obj["color"] as? Bool ?? true))
    }

    static func statusJSON() -> [String: Any] {
        let printers = Printers.list()
        return shared.read { s in
            let scanning = s.jobs.values.contains { $0.isActive }
            // Print state is refreshed when the dashboard polls GET /v1/print/{id}; ignore stale ones.
            let printing = s.prints.values.contains {
                ($0.state == "queued" || $0.state == "printing") && Date().timeIntervalSince($0.createdAt) < 600
            }
            return [
                "helper": ["version": Helper.version, "platform": "mac"],
                "state": scanning ? "scanning" : (printing ? "printing" : "idle"),
                "scanners": s.scanners.map { $0.json },
                "printers": printers.map { $0.json },
            ]
        }
    }
}
