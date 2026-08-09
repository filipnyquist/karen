// src/lib/encryption.ts
//
// At-rest encryption for SSNs and any other PII.
//
// All cryptographic operations derive their keys from a single master
// (`ENCRYPTION_KEY`) via HKDF-SHA-256, with domain-separation `info` strings
// to ensure AES-GCM and HMAC never operate on the same bytes — same key,
// two algorithms is bad hygiene even when the math is sound.

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits
const HKDF_INFO_AES = "karen-ssn-aes-gcm-v1";
const HKDF_INFO_HMAC = "karen-ssn-hmac-v1";
const HKDF_SALT = new Uint8Array(0); // empty salt — fine, the info string carries the entropy

/**
 * Read the master key from the environment. Throws if it's missing or the
 * wrong length.
 */
function getMasterKey(): Uint8Array<ArrayBuffer> {
    const hex = process.env.ENCRYPTION_KEY;
    if (hex?.length !== 64) {
        throw new Error(
            "ENCRYPTION_KEY must be a 64-char hex string (32 bytes)",
        );
    }
    const buf = new ArrayBuffer(32);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

let cachedMaster: Uint8Array<ArrayBuffer> | null = null;
let cachedAesKey: CryptoKey | null = null;
let cachedHmacKey: CryptoKey | null = null;

function getMaster(): Uint8Array<ArrayBuffer> {
    if (!cachedMaster) cachedMaster = getMasterKey();
    return cachedMaster;
}

/**
 * Derive a domain-separated sub-key from the master via HKDF-SHA-256 and
 * import it for the requested algorithm.
 */
async function _deriveSubKey(info: string): Promise<CryptoKey> {
    const master = getMaster();
    const baseKey = await crypto.subtle.importKey(
        "raw",
        master,
        { name: "HKDF" },
        false,
        ["deriveBits"],
    );
    const okm = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: HKDF_SALT,
            info: new TextEncoder().encode(info),
        },
        baseKey,
        256, // 32 bytes
    );
    return crypto.subtle.importKey(
        "raw",
        okm,
        { name: ALGORITHM, length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

async function getAesKey(): Promise<CryptoKey> {
    if (!cachedAesKey) {
        const aesBits = await crypto.subtle.deriveBits(
            {
                name: "HKDF",
                hash: "SHA-256",
                salt: HKDF_SALT,
                info: new TextEncoder().encode(HKDF_INFO_AES),
            },
            await crypto.subtle.importKey(
                "raw",
                getMaster(),
                { name: "HKDF" },
                false,
                ["deriveBits"],
            ),
            256,
        );
        cachedAesKey = await crypto.subtle.importKey(
            "raw",
            aesBits,
            { name: ALGORITHM },
            false,
            ["encrypt", "decrypt"],
        );
    }
    return cachedAesKey;
}

async function getHmacKey(): Promise<CryptoKey> {
    if (!cachedHmacKey) {
        const hmacBits = await crypto.subtle.deriveBits(
            {
                name: "HKDF",
                hash: "SHA-256",
                salt: HKDF_SALT,
                info: new TextEncoder().encode(HKDF_INFO_HMAC),
            },
            await crypto.subtle.importKey(
                "raw",
                getMaster(),
                { name: "HKDF" },
                false,
                ["deriveBits"],
            ),
            256,
        );
        cachedHmacKey = await crypto.subtle.importKey(
            "raw",
            hmacBits,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
        );
    }
    return cachedHmacKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM. Returns an `iv:ciphertext`
 * hex string (the auth tag is concatenated to `ciphertext` per the WebCrypto
 * convention).
 */
export async function encrypt(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await getAesKey();
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        encoded,
    );
    const ctBytes = new Uint8Array(ciphertext);
    const parts = [
        Array.from(iv)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        Array.from(ctBytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
    ];
    return parts.join(":");
}

/**
 * Decrypt an `iv:ciphertext` blob produced by `encrypt`. Verifies the
 * GCM auth tag implicitly (subtle.decrypt throws on tag mismatch).
 */
export async function decrypt(encoded: string): Promise<string> {
    const [ivHex, ctHex] = encoded.split(":");
    if (!ivHex || !ctHex) throw new Error("Invalid encrypted format");

    const iv = hexToBytes(ivHex);
    const ct = hexToBytes(ctHex);
    const key = await getAesKey();

    const plaintext = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        ct,
    );
    return new TextDecoder().decode(plaintext);
}

/** Parse a hex-encoded string into a Uint8Array. Throws on malformed input. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
    if (hex.length % 2 !== 0) {
        throw new Error("Invalid hex: odd length");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        const byte = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) {
            throw new Error(`Invalid hex at position ${i * 2}`);
        }
        bytes[i] = byte;
    }
    return bytes;
}

/**
 * HMAC-SHA-256 of the input using the derived HMAC sub-key. Used for
 * deterministic SSN-hash uniqueness checks.
 */
export async function hashSsn(ssn: string): Promise<string> {
    const key = await getHmacKey();
    const encoded = new TextEncoder().encode(ssn);
    const sig = await crypto.subtle.sign("HMAC", key, encoded);
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
