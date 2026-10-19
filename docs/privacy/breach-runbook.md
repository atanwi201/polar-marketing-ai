# Personal data breach runbook (RGPD arts. 33-34)

Owner: **[PENDING ATD: name, phone, email]**. AEPD notification deadline: **72 hours from awareness**.

1. **Detect and contain (hour 0-2).** Record time of awareness. Rotate admin password/token, `*_API_KEY`, social tokens; revoke exposed portal/loyalty/booking tokens; isolate host if needed. Preserve logs and a copy of affected data files (do not alter).
2. **Assess (hour 2-24).** What data (categories, approx. number of people and records), which businesses, cause, whether encrypted/accessible, ongoing? Risk to individuals: none / risk / high risk.
3. **Controller businesses (as processor, without undue delay, target < 24h).** Email each affected business with the facts so they can meet their own 72h duty (DPA art. 28.3.f).
4. **Notify AEPD (if risk, within 72h).** Via the sede electronica of aepd.es (formulario de brechas). Content: nature, categories and numbers, contact, likely consequences, measures taken. If incomplete, send in phases and say so.
5. **Notify individuals (if high risk, without undue delay).** Plain language, what happened, likely consequences, measures, contact.
6. **Document always (art. 33.5).** Log in the breach register even when not notified: facts, effects, remedial action, decision reasoning.
7. **Review (within 2 weeks).** Root cause, fixes, update ROPA/risk assessment.

Template register fields: ID | awareness date-time | description | data/people | risk level | AEPD notified (date/ref) | individuals notified | measures | closed.
