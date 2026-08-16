// src/lib/csp.ts
//
// Helpers for working with Astro's CSP runtime API
// (`Astro.csp.insertScriptHash()` / `insertStyleHash()`).
//
// Astro 7 emits `<meta http-equiv="content-security-policy">` automatically
// and hashes the bundled scripts it generates (e.g. client islands, the
// mobile-menu handler in BaseLayout). User-authored inline scripts are
// *not* auto-hashed — they must be opted in via `insertScriptHash` with
// the SHA-256 of the exact source string that will be rendered into HTML.
//
// The CSP spec is strict: if a `script-src` source list contains any hash
// or nonce, `'unsafe-inline'` is ignored. So the only correct way to permit
// a user-defined inline script is to add its hash.

import { createHash } from "node:crypto";

// Astro types the hash parameters as a template literal (`sha256-${string}`
// and friends) rather than plain `string`, so these helpers have to return
// that narrower type or every call site fails to typecheck.

/** SHA-256 base64 of the script content, formatted as the CSP hash source. */
export function sha256ScriptHash(content: string): `sha256-${string}` {
    const digest = createHash("sha256").update(content).digest("base64");
    return `sha256-${digest}`;
}

/** SHA-256 base64 of the style content, formatted as the CSP hash source. */
export function sha256StyleHash(content: string): `sha256-${string}` {
    const digest = createHash("sha256").update(content).digest("base64");
    return `sha256-${digest}`;
}
