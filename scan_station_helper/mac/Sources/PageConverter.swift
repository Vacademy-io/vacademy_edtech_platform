import CoreGraphics
import Foundation
import ImageIO

// Turns each file the scanner writes (TIFF, possibly multi-page) into sRGB JPEG pages (q 0.85,
// JFIF/EXIF density = real dpi) plus ~360 px wide thumbnails. One serial queue keeps scan order.

enum PageConverter {
    static let queue = DispatchQueue(label: "io.vacademy.scanhelper.convert", qos: .userInitiated)

    struct Output { let width: Int; let height: Int; let bytes: Int }

    /// Converts every image in `source`. `next` gives the index for each page and returns nil to stop
    /// (job cancelled or deleted); `done` records each finished page. Returns false if the file was unreadable.
    static func convertAll(source: URL, fallbackDpi: Int,
                           next: () -> (index: Int, page: URL, thumb: URL)?,
                           done: (Int, Output) -> Void) -> Bool {
        guard let src = CGImageSourceCreateWithURL(source as CFURL, nil) else { return false }
        let count = CGImageSourceGetCount(src)
        guard count > 0 else { return false }
        for i in 0..<count {
            guard let target = next() else { return true }
            let ok: Bool = autoreleasepool {
                guard let out = convertOne(src, i, fallbackDpi: fallbackDpi, page: target.page, thumb: target.thumb)
                else { return false }
                done(target.index, out)
                return true
            }
            if !ok { return false }
        }
        return true
    }

    static func convertOne(_ src: CGImageSource, _ i: Int, fallbackDpi: Int, page: URL, thumb: URL) -> Output? {
        guard let raw = CGImageSourceCreateImageAtIndex(src, i, nil) else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [CFString: Any] ?? [:]
        // The resolution set on the scanner is the truth; file metadata (often 72) only if we have none.
        var dpi = fallbackDpi
        if dpi <= 0, let d = props[kCGImagePropertyDPIWidth] as? NSNumber, d.doubleValue >= 50 { dpi = Int(d.doubleValue.rounded()) }
        if dpi <= 0 { dpi = 300 }
        let image = toSRGB(raw)
        guard writeJPEG(image, to: page, quality: 0.85, dpi: dpi) else { return nil }

        // Thumbnail ~360 px wide: ImageIO's max size applies to the longer side.
        let longer = max(image.width, image.height)
        let maxSide = max(1, Int((360.0 * Double(longer) / Double(max(1, image.width))).rounded()))
        let thumbOpts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        if let pageSrc = CGImageSourceCreateWithURL(page as CFURL, nil),
           let t = CGImageSourceCreateThumbnailAtIndex(pageSrc, 0, thumbOpts as CFDictionary) {
            _ = writeJPEG(t, to: thumb, quality: 0.75, dpi: 72)
        }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: page.path)[.size] as? NSNumber)??.intValue ?? 0
        return Output(width: image.width, height: image.height, bytes: bytes)
    }

    /// Redraws RGB images that are not already sRGB into sRGB. Gray images stay gray.
    static func toSRGB(_ image: CGImage) -> CGImage {
        guard let cs = image.colorSpace, cs.model == .rgb else { return image }
        if let name = cs.name, name == CGColorSpace.sRGB { return image }
        guard let srgb = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: srgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return image }
        ctx.interpolationQuality = .none
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return ctx.makeImage() ?? image
    }

    static func writeJPEG(_ image: CGImage, to url: URL, quality: Double, dpi: Int) -> Bool {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else { return false }
        let props: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: quality,
            kCGImagePropertyOrientation: 1,
            kCGImagePropertyDPIWidth: dpi,
            kCGImagePropertyDPIHeight: dpi,
            kCGImagePropertyJFIFDictionary: [
                kCGImagePropertyJFIFXDensity: dpi,
                kCGImagePropertyJFIFYDensity: dpi,
                kCGImagePropertyJFIFDensityUnit: 1,      // dots per inch
            ] as [CFString: Any],
            kCGImagePropertyTIFFDictionary: [
                kCGImagePropertyTIFFXResolution: dpi,
                kCGImagePropertyTIFFYResolution: dpi,
                kCGImagePropertyTIFFResolutionUnit: 2,   // inches
            ] as [CFString: Any],
        ]
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return false }
        var bytes = data as Data
        setJFIFDensity(&bytes, dpi: dpi)
        return (try? bytes.write(to: url, options: .atomic)) != nil
    }

    /// ImageIO always writes the JFIF APP0 density unit as 0 ("aspect ratio only") and keeps the dpi in
    /// EXIF. Patch APP0 to units = 1 (dots per inch) and X/Y density = dpi so every reader sees the dpi.
    static func setJFIFDensity(_ d: inout Data, dpi: Int) {
        let b = d.startIndex
        guard d.count > 20, dpi > 0, dpi <= 0xFFFF,
              d[b] == 0xFF, d[b + 1] == 0xD8, d[b + 2] == 0xFF, d[b + 3] == 0xE0,
              d[(b + 6)..<(b + 11)] == Data("JFIF\0".utf8) else { return }
        d[b + 13] = 1
        d[b + 14] = UInt8(dpi >> 8); d[b + 15] = UInt8(dpi & 0xFF)
        d[b + 16] = UInt8(dpi >> 8); d[b + 17] = UInt8(dpi & 0xFF)
    }

    /// `VacademyScanHelper --convert-test <input image> <output dir> <dpi>`: runs the page conversion
    /// on a local file so the JPEG/density path can be checked without a scanner.
    static func selfTest(_ args: [String]) -> Int32 {
        guard args.count == 3, let dpi = Int(args[2]) else {
            print("usage: --convert-test <input image> <output dir> <dpi>"); return 2
        }
        let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        var n = 0
        let ok = convertAll(source: URL(fileURLWithPath: args[0]), fallbackDpi: dpi, next: {
            defer { n += 1 }
            return (n, outDir.appendingPathComponent("\(n).jpg"), outDir.appendingPathComponent("\(n)-thumb.jpg"))
        }, done: { i, o in print("page \(i): \(o.width)x\(o.height) \(o.bytes) bytes") })
        print(ok ? "ok" : "failed")
        return ok ? 0 : 1
    }
}
