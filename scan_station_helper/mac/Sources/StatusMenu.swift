import AppKit

// Menu-bar item: version, scanners and printers with their state, "Forget allowed websites", Quit.

final class StatusMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let menu = NSMenu()

    override init() {
        super.init()
        if let button = item.button {
            let image = NSImage(systemSymbolName: "scanner", accessibilityDescription: "Vacademy Scan Helper")
                ?? NSImage(systemSymbolName: "doc.viewfinder", accessibilityDescription: "Vacademy Scan Helper")
            image?.isTemplate = true
            button.image = image
            if image == nil { button.title = "VS" }
            button.toolTip = "Vacademy Scan Helper"
        }
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        rebuild()
    }

    func menuNeedsUpdate(_ menu: NSMenu) { rebuild() }

    func refresh() { if menu.highlightedItem == nil { rebuild() } }

    private func rebuild() {
        menu.removeAllItems()
        let (scanners, printers, listenError) = shared.read { ($0.scanners, $0.printers, $0.listenError) }
        menu.addItem(info("Vacademy Scan Helper \(Helper.version)" + (Helper.devMode ? " (dev)" : "")))
        menu.addItem(info(listenError.map { "Not running: \($0)" } ?? "Listening on 127.0.0.1:\(Helper.port)"))
        menu.addItem(.separator())
        menu.addItem(header("Scanners"))
        if scanners.isEmpty { menu.addItem(info("No scanner found. Turn it on or connect it.")) }
        for s in scanners {
            let parts = [s.feederPresent ? (s.feederDuplex ? "feeder (both sides)" : "feeder") : nil,
                         s.flatbedPresent ? "glass" : nil].compactMap { $0 }
            menu.addItem(info("\(s.name) · \(s.transport == "usb" ? "USB" : "network")"
                              + (parts.isEmpty ? "" : " · " + parts.joined(separator: ", "))))
            menu.addItem(info("    \(s.detail)"))
        }
        menu.addItem(.separator())
        menu.addItem(header("Printers"))
        if printers.isEmpty { menu.addItem(info("No printer found.")) }
        for p in printers {
            let traits = [p.duplex ? "two-sided" : "one-sided", p.color ? "colour" : "black and white",
                          p.isDefault ? "default" : nil, p.enabled ? nil : "paused"].compactMap { $0 }
            menu.addItem(info("\(p.name) · \(traits.joined(separator: ", "))"))
        }
        menu.addItem(.separator())
        let forget = NSMenuItem(title: "Forget Allowed Websites", action: #selector(forgetOrigins), keyEquivalent: "")
        forget.target = self
        forget.isEnabled = !OriginPolicy.saved().isEmpty
        menu.addItem(forget)
        let quit = NSMenuItem(title: "Quit Vacademy Scan Helper", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
    }

    private func info(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }

    private func header(_ title: String) -> NSMenuItem {
        if #available(macOS 14.0, *) { return NSMenuItem.sectionHeader(title: title) }
        return info(title.uppercased())
    }

    @objc private func forgetOrigins() { OriginPolicy.forgetAll(); log("allowed websites forgotten") }
    @objc private func quit() { NSApp.terminate(nil) }
}
