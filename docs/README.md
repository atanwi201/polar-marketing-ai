# Docs index

Start with [../CLAUDE.md](../CLAUDE.md). Then:

- [architecture.md](architecture.md), [data-model.md](data-model.md)
- [routes-and-auth.md](routes-and-auth.md), [ai-providers.md](ai-providers.md)
- [design-system.md](design-system.md) (UI source of truth), [conventions.md](conventions.md)
- [deploy-runbook.md](deploy-runbook.md) (incl. shipping to production), [incidents.md](incidents.md)
- [privacy/](privacy/) compliance material


## Security, privacy and operations

- **Production env:** set `NODE_ENV=production`, an admin password or `ADMIN_TOKEN`, and the `LEGAL_NAME`, `LEGAL_NIF`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` (and optionally `LEGAL_PHONE`) variables. Outside production `/privacy` and `/legal` show a red draft warning while any are missing; in production the pages show visible `[PENDIENTE]` markers instead and no personal contact address is exposed.
- **Booking email:** use a sending domain verified in Resend (`BOOKING_FROM_EMAIL`; the sandbox sender only reaches the account owner). Confirmations go only to strictly validated addresses, at most 3 per recipient per day (plus 12 bookings/hour per IP and 60 mails/hour per business), never for pending or declined businesses.
- **Third-party resources:** Polar's own public pages use a system font stack and load no Google Fonts or CDN scripts. Generated client sites may still use jsDelivr (Bootstrap) until self-hosted; the privacy page says so.
- **Reverse proxy:** make nginx overwrite (not append) `X-Real-IP $remote_addr`; per-IP limits depend on it.
- **Compliance docs** in `docs/privacy/`: `ropa.md`, `dpa-template.md`, `subprocessors.md`, `retention.md`, `breach-runbook.md` (72h AEPD). Placeholders are marked PENDING.
- **Known open items:** automatic retention purge, loyalty data in client erasure, secrets encrypted at rest, consent evidence for loyalty marketing.
