# Chat Send Integrity Design

## Security Goal

Prevent the recipient, body, payment account, amount, or wallet address shown to the operator from differing from the content actually submitted to the platform. Archive tamper resistance is not the current priority. The priority is transactional send integrity and trusted confirmation.

## Normal Message Transaction

1. Store the expected English body and current `profileId + contactId` when translation completes.
2. Re-read the composer and current contact before the second Enter.
3. Re-read the complete body immediately before dispatching the platform send event.
4. All three bodies and recipient identities must match exactly or sending is blocked.
5. After sending, read the new outgoing bubble and compare it character by character with the expected body.
6. A mismatch stops further sending from that instance and displays an explicit alert.
7. The operator's Chinese input exists only briefly in the composer and translation memory. It is excluded from cache, enterprise assets, and runtime logs.
8. Translation content never uses the clipboard as an intermediary.

## Standalone Numeric Payment Account

- A message containing only digits and permitted spaces and meeting the sensitive-length rule bypasses translation.
- The fixed length is `6–34` digits after removing internal ASCII spaces. Leading/trailing spaces, line breaks, and other characters are rejected.
- The value is always a string. Conversion to JavaScript `Number` is forbidden to preserve leading zeroes and avoid large-integer precision loss.
- The first Enter locks the account, exact source, and recipient without sending.
- A trusted main-application area shows the recipient and complete account.
- The second Enter revalidates and sends.
- The outgoing bubble is verified again after sending.
- Automatic spacing, formatting, clipboard transfer, and AI rewriting are forbidden.

## Standalone USDT Wallet Address

- The address bypasses translation and preserves every character and letter case.
- A proven blockchain address library validates it; regular expressions alone are insufficient.
- Validation covers TRC20, ERC20, BEP20, Solana, and other supported formats.
- ERC20 and BEP20 addresses can look identical, so a human must confirm the network.
- The first Enter locks the address, network, and recipient.
- The trusted main-application area shows the network, complete address, validation result, and recipient.
- The second Enter revalidates and sends.
- Invalid addresses or ambiguous networks are blocked.
- The outgoing bubble is compared character by character after sending.
- TRC20 and Solana use audited Base58/Base58Check validation. EVM mixed-case checksums use Keccak-256.
- A `0x` address cannot distinguish ERC20 from BEP20 by shape, so the operator must select the network during the first confirmation.

## Confirmation State-Machine Parameters

- The first Enter is intercepted by the platform guard. It neither dispatches the platform send event nor calls translation.
- A native main-process confirmation dialog shows the platform, profile, contact, complete value, and network. Signal is hidden for the dialog and resynchronized afterward.
- Confirmation creates a random 32-byte token held only in main-process memory. It expires after `120 seconds` and is single-use.
- The second Enter revalidates `profileId + platform + conversation signature + exact text + network`; any change invalidates the token.
- A trusted confirmation strip appears in the main application's profile area, outside all platform page DOMs.
- After dispatch, the client observes for approximately `3 seconds` cumulatively and compares the newly created outgoing bubble character by character.

## Trusted Display Area

Sensitive payment information cannot rely only on WhatsApp, Telegram, or Signal page content. A trusted area outside the platform DOM displays:

- Platform and profile
- Contact
- Amount and currency, when present
- Payment account or wallet address
- Wallet network, when present
- Address validation result
- Confirmation countdown or second-Enter status

## Client Security Boundary

- Remote WhatsApp and Telegram pages cannot invoke main-application IPC. Signal script execution is available only to the local main renderer protected by ASAR integrity. Migrating all dynamic Signal scripts to fully typed commands remains a defense-in-depth follow-up.
- WebViews only allow official WhatsApp and Telegram origins.
- Packaged builds disable developer tools, remote debugging, diagnostics, and runtime logs.
- Enable ASAR integrity, Electron Fuses, and critical-file hash verification.
- Development uses only the project-controlled Signal build. Packaged clients use only bundled Signal. Official Signal fallback is forbidden.
- Administrator-level malware can still capture screens and keystrokes, read memory, or replace the complete application. A local client cannot absolutely eliminate that operating-system boundary.

## Verification Scope on 2026-07-12

- Build/type checks, address-validation tests, source gates for single-use credentials, and the post-send bubble verification path passed automated checks.
- The Electron client and issuer were actually opened with isolated data and captured in a window smoke test.
- The real WhatsApp, Telegram, and Signal flow of first-Enter confirmation, second-Enter dispatch, and outgoing-bubble verification has not yet received human UI acceptance and must not be described as accepted.
