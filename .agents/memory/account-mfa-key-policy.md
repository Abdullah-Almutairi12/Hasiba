---
name: Account MFA encryption key lifecycle
description: Use a dedicated externally provisioned encryption key for recoverable TOTP secrets, independently of session-cookie signing.
---
Provision the account MFA encryption root as a dedicated secret outside source code and the database. Do not silently reuse the session-cookie secret or invent a persistent development key.

**Why:** TOTP verification needs recoverable secret material; a database compromise must not disclose that material. Coupling it to session signing can make an ordinary cookie-key rotation lock every enrolled account out.

**How to apply:** Use authenticated encryption bound to account identity and envelope/key version, explicit key rotation and recovery procedures, and fail closed when the key is absent. Disposable isolated tests may use their own random test-only key; that does not prove the development or production key is provisioned. Never export key values, OTP seeds, recovery codes or reset links in test evidence.
