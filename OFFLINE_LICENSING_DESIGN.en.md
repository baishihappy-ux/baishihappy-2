# Offline Licensing System Design

## Product Boundary

- The client has no maoyi server dependency and requires no online licensing server.
- The client calls the configured translation service directly.
- For client-only sales, the supplier retains the issuer and creates licenses for the customer.
- A full-suite sale delivers only the client installer, license issuer, and encrypted issuing key. Source code is not included.
- The full suite is delivered as one archive whose issuer and client form one matched offline system.

## Independent Keys Per Suite

Every full suite must have an independent Ed25519 signing key pair:

- The issuer holds the encrypted signing private key.
- The client embeds the matching verification public key.
- The issuer signs `license.dat` with the private key.
- The client can verify licenses but cannot issue them.
- Licenses from different suites are not interchangeable.

Every license payload includes `issuerId`, `productId`, and `keyId`. The client verifies the signature and all three identifiers.

## Suite ID Pool and Key Generation

The developer environment maintains 10,000 unique 9-digit numeric suite IDs. The suite ID registry is stored under `.package-secrets` and must not enter Git.

Every full-suite packaging attempt consumes exactly one unused suite ID. Whether packaging later succeeds, fails, is interrupted, or is voided, that suite ID must never be recycled or used again.

The suite ID is not the key itself. It participates in and locks the key-generation flow for that suite:

- Take one unused suite ID from the registry.
- Immediately mark that suite ID as `consumed`.
- Use this unique suite ID to generate an independent signing key pair for the suite being packaged.
- Permanently bind the generated `suiteId`, `keyId`, public-key fingerprint, encrypted-private-key fingerprint, creation time, and output directory.
- If packaging fails, the suite ID and generated record remain failed or voided and must not return to the available pool.

Mandatory checks:

- All 10,000 suite IDs in the registry must be unique.
- A consumed suite ID must never generate another key.
- Different suite IDs must never have the same public-key fingerprint.
- Different suite IDs must never have the same encrypted-private-key fingerprint.
- Existing output directories must never be overwritten.

## Device Binding

1. The client generates a device encryption key pair on first launch.
2. Windows DPAPI protects the device private key.
3. The machine request code contains a hardware digest, device public key, and product identifier.
4. The issuer encrypts the license payload to the device public key.
5. The client decrypts it with the device private key and verifies the hardware digest.
6. Copying `license.dat` to another computer does not activate that computer.

## Issuer Inputs and Outputs

Issuer inputs:

- Machine request code
- Username
- Secret, with the UI label fixed to "Enter secret" and no model or provider name
- Authorized days

Issuer outputs:

- `license.dat`
- License code
- Username
- Effective time
- Expiration time
- License ID

The license code is the text form of the `license.dat` file content and is intended for customer copy-paste activation. The issuer UI must include a "Copy license code" action.

After the client receives the license code, it automatically writes `license.dat` under the current application data directory. The license code and `license.dat` are two usage forms of the same encrypted license payload.

Neither the issuer nor the client generates a customer login password. The client sets the username once and enters through the license code.

Client local-login rules:

- The username can be set only once and cannot be changed afterward.
- When setting the username, show: "Username can only be set once and cannot be changed."
- If the username is not set, copying machine-code information shows: "Please set the username first."
- After the username is set, copying includes the machine request code and username.
- No customer login password or customer password hash is stored.
- A valid persisted license is verified automatically on later launches.

## License Payload

The payload includes at least:

- License format version
- License ID
- `issuerId`, `productId`, and `keyId`
- Machine hardware digest and device public-key digest
- Username
- Encrypted service secret
- Issue, effective, and expiration timestamps
- Authorized days
- Enabled features

The current license text uses the `MYLIC2` prefix. For every license, the issuer generates an ephemeral X25519 key, combines it with the device X25519 public key carried by the machine request code, derives an AES-256-GCM key through HKDF-SHA256, and signs the complete encrypted envelope with the suite Ed25519 private key.

The license-code text must not be readable JSON plaintext. When a customer opens the license code or `license.dat` with a text editor, they must only see encrypted license text, not the secret, machine code, username, expiration date, or feature list.

## Issuer Startup Protection

- On first launch, the issuer must require creating the issuer startup password.
- During first password setup, show: "This password protects the license issuer. Please remember it. If the password is lost, the issuer cannot be opened."
- `scrypt` derives the startup-password key without storing plaintext. Fixed parameters are `N=131072`, `r=8`, `p=1`, and a random 32-byte salt.
- AES-256-GCM encrypts the signing key and suite configuration; Windows DPAPI protects the complete outer envelope.
- The private key is decrypted only after a successful password check.
- Private-key and derived-key memory is cleared when the issuer exits.

Consecutive failure lockout ladder:

| Lockout round | Consecutive failures | Duration | UI message |
|---|---:|---:|---|
| Round 1 | 3 | 10 minutes | Countdown |
| Round 2 | 3 more | 1 hour | Countdown and "Contact supplier" |
| Round 3 | 3 more | 6 hours | Countdown and "Contact supplier" |
| Round 4 | 3 more | 24 hours | Countdown and "Contact supplier" |
| Round 5 and later | Every 3 | 48 hours | Countdown and "Contact supplier" |

- DPAPI protects the persistent lockout state.
- Restarting the application or computer does not reset it.
- Password input and login controls are disabled during lockout.
- Failed attempts show how many attempts remain.
- Clock rollback is detected and keeps the issuer locked.
- Successful login resets the failure count and lockout level.

## Offline Licensing Limits

- A full-suite buyer owns offline issuance rights for that suite.
- Without a server, issuance quantity cannot be enforced reliably for a full-suite buyer.
- Losing the private key prevents future issuance for that suite. A leaked key requires a new client public key and suite version.
- A service secret used by a serverless client cannot be made absolutely extraction-proof. It must still be DPAPI-protected, hidden from renderer pages, and excluded from logs.

## Upgrading a Delivered Suite

- An upgrade for an existing customer is not a new-suite generation and does not consume a new suite ID.
- A `003` customer upgrade must reuse suite `183105912`'s original `suiteId`, `keyId`, and complete key pair.
- Never regenerate keys from the same numeric ID; a new key pair cannot validate the existing `license.dat`.
- Replace program files only, preserving the storage pointer, authorization, device identity, profiles, and all three platform login states.
- The first encrypted-cache release does not migrate plaintext translations. It removes only `TranslationCache` and `df.translation.renderCache.*`, then writes a one-time cleanup marker.
- Deliveries to new customers still consume a new suite ID permanently and generate an independent key pair.
- When suite `003` moves from legacy `DFLIC1` to `MYLIC2`, its original suite key must issue one replacement license code. The suite ID and keys stay unchanged, but the legacy license text is not accepted by the new format.
