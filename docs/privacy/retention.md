# Retention schedule

Status: proposals. Values marked **[PENDING ATD]** must be confirmed. As of this audit the code does NOT yet purge automatically; implementing purge jobs and erasure for loyalty/bookings/mail logs is an open engineering item.

| Data | Proposed retention | Basis | Mechanism today |
|---|---|---|---|
| Business account and contact | Contract term, then blocked for limitation periods | Contract, legal | Client delete (does not yet remove loyalty data or site output) |
| Invoices / accounting | 6 years (Codigo de Comercio); tax 4 years | Legal obligation | Manual |
| Bookings (incl. mail log with recipient email) | 24 months after booking date **[PENDING ATD]** | Contract with business | None (open item) |
| Loyalty customers, transactions, wallet device tokens | 24 months after last activity **[PENDING ATD]** | Contract; consent for offers | None (open item) |
| Expense receipts (images, parsed text) | Per the business's accounting rules (usually 6 years) | Legal obligation of the business | None |
| Marketing consent evidence | Life of consent + 3 years | Accountability | Boolean/timestamp only |
| Technical/access logs | 90 days **[PENDING ATD]** | Legitimate interest | stdout |
| Backups (`scripts/backup.sh`) | **[PENDING ATD]** rotation, same erasure delay | Security | Snapshots |

Erasure requests: respond within one month; processor forwards end-customer requests to the controller business.
