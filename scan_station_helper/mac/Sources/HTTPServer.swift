import Foundation
import Network

// Minimal HTTP/1.1 server on 127.0.0.1 only: Content-Length bodies, keep-alive, no chunked uploads.

struct HTTPRequest {
    let method: String
    let path: String
    let query: [String: String]
    let headers: [String: String]   // lower-cased names
    let body: Data
}

struct HTTPResponse {
    var status: Int
    var headers: [(String, String)] = []
    var body = Data()

    static func json(_ status: Int, _ object: Any) -> HTTPResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object,
                                                options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, headers: [("Content-Type", "application/json; charset=utf-8")], body: data)
    }
    static func error(_ e: APIError) -> HTTPResponse {
        json(e.status, ["error": ["code": e.code, "message": e.message]])
    }
    static func error(_ status: Int, _ code: String, _ message: String) -> HTTPResponse {
        error(APIError(status, code, message))
    }
    static func empty(_ status: Int) -> HTTPResponse { HTTPResponse(status: status) }
}

private let reasons: [Int: String] = [
    200: "OK", 202: "Accepted", 204: "No Content", 400: "Bad Request", 403: "Forbidden",
    404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 411: "Length Required",
    413: "Payload Too Large", 421: "Misdirected Request", 422: "Unprocessable Entity",
    431: "Request Header Fields Too Large", 500: "Internal Server Error", 503: "Service Unavailable",
]

final class HTTPServer {
    typealias Handler = (HTTPRequest, @escaping (HTTPResponse) -> Void) -> Void
    static let maxHeaderBytes = 64 * 1024
    static let maxBodyBytes = 100 * 1024 * 1024

    let queue = DispatchQueue(label: "io.vacademy.scanhelper.http")
    private let handler: Handler
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: HTTPConnection] = [:]   // touched on `queue` only

    init(handler: @escaping Handler) { self.handler = handler }

    func start(onFailure: @escaping (String) -> Void) throws {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Helper.port)!)
        let l = try NWListener(using: params)
        l.stateUpdateHandler = { state in
            switch state {
            case .ready: log("HTTP listening on 127.0.0.1:\(Helper.port)")
            case .failed(let e): log("HTTP listener failed: \(e)"); onFailure("\(e)")
            default: break
            }
        }
        l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        l.start(queue: queue)
        listener = l
    }

    private func accept(_ conn: NWConnection) {
        let c = HTTPConnection(conn: conn, queue: queue, handler: handler)
        let key = ObjectIdentifier(c)
        connections[key] = c
        c.onClose = { [weak self] in self?.connections[key] = nil }
        c.start()
    }
}

final class HTTPConnection {
    private let conn: NWConnection
    private let queue: DispatchQueue
    private let handler: HTTPServer.Handler
    private var buffer = Data()
    private var busy = false          // a request is being handled; responses go out in order
    private var closed = false
    private var peerClosed = false
    private var idleTimer: DispatchWorkItem?
    var onClose: (() -> Void)?

    init(conn: NWConnection, queue: DispatchQueue, handler: @escaping HTTPServer.Handler) {
        self.conn = conn; self.queue = queue; self.handler = handler
    }

    func start() {
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.finish()
            default: break
            }
        }
        conn.start(queue: queue)
        armIdleTimer()
        receive()
    }

    private func armIdleTimer() {
        idleTimer?.cancel()
        let t = DispatchWorkItem { [weak self] in
            guard let self = self, !self.busy else { return }
            self.close()
        }
        idleTimer = t
        queue.asyncAfter(deadline: .now() + 30, execute: t)
    }

    private func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let d = data, !d.isEmpty { self.buffer.append(d); self.armIdleTimer() }
            if error != nil || isComplete {
                self.peerClosed = true
                if !self.busy { self.close() }
                return
            }
            self.processBuffer()
            if !self.closed { self.receive() }
        }
    }

    private func processBuffer() {
        guard !busy, !closed else { return }
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            if buffer.count > HTTPServer.maxHeaderBytes { sendAndClose(.error(431, "BAD_REQUEST", "Request headers are too large.")) }
            return
        }
        let headerText = String(decoding: buffer[buffer.startIndex..<headerEnd.lowerBound], as: UTF8.self)
        var lines = headerText.components(separatedBy: "\r\n")
        let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true)
        guard requestLine.count == 3, requestLine[2].hasPrefix("HTTP/1.") else {
            sendAndClose(.error(400, "BAD_REQUEST", "Malformed request line.")); return
        }
        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }
        if headers["transfer-encoding"] != nil {
            sendAndClose(.error(411, "BAD_REQUEST", "Chunked request bodies are not supported; send Content-Length."))
            return
        }
        let length = Int(headers["content-length"] ?? "0") ?? -1
        guard length >= 0 else { sendAndClose(.error(400, "BAD_REQUEST", "Bad Content-Length.")); return }
        guard length <= HTTPServer.maxBodyBytes else {
            sendAndClose(.error(413, "TOO_LARGE", "The request body is too large.")); return
        }
        let bodyStart = headerEnd.upperBound
        guard buffer.count - (bodyStart - buffer.startIndex) >= length else { return }   // wait for more
        let body = Data(buffer[bodyStart..<(bodyStart + length)])
        buffer = Data(buffer[(bodyStart + length)...])

        let target = String(requestLine[1])
        let comps = URLComponents(string: "http://127.0.0.1" + (target.hasPrefix("/") ? target : "/" + target))
        var query: [String: String] = [:]
        for item in comps?.queryItems ?? [] { query[item.name] = item.value ?? "" }
        let version = String(requestLine[2])
        let connHeader = headers["connection"]?.lowercased() ?? ""
        let keepAlive = version == "HTTP/1.1" ? !connHeader.contains("close") : connHeader.contains("keep-alive")
        let req = HTTPRequest(method: String(requestLine[0]).uppercased(), path: comps?.path ?? target,
                              query: query, headers: headers, body: body)
        busy = true
        handler(req) { [weak self] response in
            guard let self = self else { return }
            self.queue.async { self.send(response, keepAlive: keepAlive) }
        }
    }

    private func serialize(_ r: HTTPResponse, keepAlive: Bool) -> Data {
        var head = "HTTP/1.1 \(r.status) \(reasons[r.status] ?? "Status")\r\n"
        var hasType = false
        for (k, v) in r.headers {
            if k.lowercased() == "content-type" { hasType = true }
            head += "\(k): \(v)\r\n"
        }
        if !hasType && !r.body.isEmpty { head += "Content-Type: application/octet-stream\r\n" }
        head += "Content-Length: \(r.body.count)\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Connection: \(keepAlive ? "keep-alive" : "close")\r\n\r\n"
        var data = Data(head.utf8)
        data.append(r.body)
        return data
    }

    private func send(_ r: HTTPResponse, keepAlive: Bool) {
        guard !closed else { return }
        conn.send(content: serialize(r, keepAlive: keepAlive), completion: .contentProcessed { [weak self] _ in
            guard let self = self else { return }
            self.busy = false
            if keepAlive && !self.peerClosed { self.armIdleTimer(); self.processBuffer() } else { self.close() }
        })
    }

    private func sendAndClose(_ r: HTTPResponse) {
        busy = true
        send(r, keepAlive: false)
    }

    private func close() {
        guard !closed else { return }
        closed = true
        conn.cancel()
        finish()
    }

    private func finish() {
        closed = true
        idleTimer?.cancel()
        let cb = onClose
        onClose = nil
        cb?()
    }
}
