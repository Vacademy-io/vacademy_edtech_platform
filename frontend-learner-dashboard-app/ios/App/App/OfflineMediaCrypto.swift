import Foundation
import CommonCrypto

/// Errors surfaced by `OfflineMediaCrypto`.
enum OfflineMediaCryptoError: Error {
    case invalidKey
    case invalidNonce
    case cryptoFailure
}

/// Streaming AES-256-CTR decryption matching the WebCrypto `AES-CTR` semantics used by the
/// JS downloader (src/lib/offline/download/*):
///
/// - `nonce` is a random 16-byte value used as the *initial* counter block (WebCrypto's
///   `counter` param, `length: 128`).
/// - The counter block increments by 1 for every 16-byte block of keystream, treating the
///   16 bytes as a single big-endian 128-bit integer (with 128-bit wraparound, which will
///   never realistically occur for our file sizes).
/// - keystream_i = AES-ECB-encrypt(key, nonce_as_uint128 + i), for block index i = floor(fileOffset / 16).
/// - plaintext = ciphertext XOR keystream, with the first (fileOffset mod 16) bytes of the
///   first keystream block discarded when fileOffset is not itself block-aligned.
///
/// This performs AES *encryption* of the counter block (not decryption) — that is correct for
/// CTR mode, where the same keystream is used for both encrypt and decrypt.
enum OfflineMediaCrypto {

    /// Adds `blockIndex` to the 16-byte `nonce`, treating it as a big-endian 128-bit integer.
    static func addCounter(nonce: [UInt8], blockIndex: UInt64) -> [UInt8] {
        var counter = nonce
        var carry: UInt64 = blockIndex
        var i = 15
        while i >= 0 {
            if carry == 0 { break }
            let sum = UInt64(counter[i]) + (carry & 0xFF)
            counter[i] = UInt8(sum & 0xFF)
            carry = (carry >> 8) + (sum >> 8)
            i -= 1
        }
        return counter
    }

    /// Encrypts a single 16-byte block with AES-ECB/NoPadding. Used purely to derive the CTR
    /// keystream for a given counter value — never used to encrypt/decrypt more than one block,
    /// so ECB's lack of chaining is irrelevant here.
    private static func aesEcbEncryptBlock(key: [UInt8], block: [UInt8]) throws -> [UInt8] {
        var outBuf = [UInt8](repeating: 0, count: block.count + kCCBlockSizeAES128)
        var outLen: Int = 0
        let status = outBuf.withUnsafeMutableBytes { outPtr -> CCCryptorStatus in
            block.withUnsafeBytes { inPtr -> CCCryptorStatus in
                key.withUnsafeBytes { keyPtr -> CCCryptorStatus in
                    CCCrypt(
                        CCOperation(kCCEncrypt),
                        CCAlgorithm(kCCAlgorithmAES),
                        CCOptions(kCCOptionECBMode),
                        keyPtr.baseAddress, key.count,
                        nil,
                        inPtr.baseAddress, block.count,
                        // outPtr.count, not outBuf.count: reading outBuf here overlaps the
                        // exclusive mutable access withUnsafeMutableBytes holds on it, which
                        // Swift 6 rejects outright. Same value, no overlapping access.
                        outPtr.baseAddress, outPtr.count,
                        &outLen
                    )
                }
            }
        }
        guard status == kCCSuccess else { throw OfflineMediaCryptoError.cryptoFailure }
        return Array(outBuf.prefix(outLen))
    }

    /// Decrypts `ciphertext`, which is the byte range `[fileOffset, fileOffset + ciphertext.count)`
    /// of the original encrypted-at-rest file, given the file's 32-byte AES-256 key and 16-byte nonce.
    static func decrypt(ciphertext: [UInt8], key: [UInt8], nonce: [UInt8], fileOffset: UInt64) throws -> [UInt8] {
        guard key.count == 32 else { throw OfflineMediaCryptoError.invalidKey }
        guard nonce.count == 16 else { throw OfflineMediaCryptoError.invalidNonce }
        guard !ciphertext.isEmpty else { return [] }

        let blockIndex = fileOffset / 16
        let subOffset = Int(fileOffset % 16)

        var plaintext = [UInt8]()
        plaintext.reserveCapacity(ciphertext.count)

        var remaining = ArraySlice(ciphertext)
        var currentBlock = blockIndex
        var isFirstBlock = true

        while !remaining.isEmpty {
            let counterBlock = addCounter(nonce: nonce, blockIndex: currentBlock)
            let keystream = try aesEcbEncryptBlock(key: key, block: counterBlock)

            let skip = isFirstBlock ? subOffset : 0
            let takeCount = min(16 - skip, remaining.count)

            let ksSlice = keystream[skip..<(skip + takeCount)]
            let ctSlice = remaining.prefix(takeCount)

            for (c, k) in zip(ctSlice, ksSlice) {
                plaintext.append(c ^ k)
            }

            remaining = remaining.dropFirst(takeCount)
            currentBlock += 1
            isFirstBlock = false
        }

        return plaintext
    }
}
