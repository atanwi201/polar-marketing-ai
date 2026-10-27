# Retention schedule

Status: proposals. Values marked **[PENDING ATD]** must be confirmed. Erasure exists in code (`eraseClient`, `eraseMember`, `purgeExpired`); nothing is scheduled automatically, and purge jobs still need a cron decision **[PENDING ATD]**. Bookings and mail logs have no purge yet.

| Data | Proposed retention | Basis | Mechanism today |
|---|---|---|---|
| Business account and contact | Contract term, then blocked for limitation periods | Contract, legal | Client delete (`eraseClient`): programmes, cards, members left with no card, consents, bookings, menu, expenses, media and site output |
| Invoices / accounting | 6 years (Codigo de Comercio); tax 4 years | Legal obligation | Manual |
| Bookings (incl. mail log with recipient email) | 24 months after booking date **[PENDING ATD]** | Contract with business | None (open item) |
| Loyalty cards, transactions, wallet device tokens | 24 months after last activity **[PENDING ATD]** | Contract; consent for offers | `purgeExpired({loyaltyInactiveDays})` (manual, dry-run by default); `eraseMember(phone)` on request |
| Expense receipts (images, parsed text) | Per the business's accounting rules (usually 6 years) | Legal obligation of the business | None |
| Marketing consent evidence | Life of consent + 3 years | Accountability | `loyalty.consents[]`: append-only, one row per grant or withdrawal; removed with the person |
| Card-recovery requests (`loyalty.recoveries[]`) | 15 minutes live, row pruned 24 h after expiry | Contract (recovering their own card) | `newRecovery` writes no code, only a hash of the device secret; `eraseMember`, shop deletion and the inactivity purge all remove the rows |
| Technical/access logs | 90 days **[PENDING ATD]** | Legitimate interest | stdout |
| Backups (`scripts/backup.sh`) | **[PENDING ATD]** rotation, same erasure delay | Security | Snapshots |

Erasure requests: respond within one month; processor forwards end-customer requests to the controller business.

**Erasing one person by phone** (every card they hold, at every shop, with its transactions, wallet
registrations and consents):

```
node --input-type=module -e 'const {eraseMember}=await import("./server/loyalty.mjs"); console.log(await eraseMember("+34612345678"))'
```

Run it from the repo root (`DATA_DIR` defaults to `./data`; set it if production lives elsewhere).
It prints the counts and appends one line to `data/erasure-audit.log` with the counts only — no
number, no name, no id — so the deletion is provable without keeping what was deleted. A valid
number nobody uses answers `{found:false}`; a malformed one is refused.
