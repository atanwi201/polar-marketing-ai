# Record of processing activities (RGPD art. 30), template

Pre-filled from the code. **[PENDING ATD]** = fill in. Part A: Polar Marketing as controller. Part B: as processor for each business.

Controller/processor: **[PENDING ATD: LEGAL_NAME, LEGAL_NIF, LEGAL_ADDRESS, LEGAL_EMAIL]** · DPO: not appointed **[PENDING ATD: confirm]**

## A. Controller activities
| Activity | Purpose / basis | Subjects | Data | Recipients | Transfers | Retention | Security |
|---|---|---|---|---|---|---|---|
| Business sign-up and account (`/api/signup`) | Contract; consent for news | Business contacts | Name, email, phone, business data, photos, terms acceptance, marketing flag | Hosting, AI providers (business content) | See subprocessors.md | See retention.md | Access control, token links, rate limits |
| AI content and websites | Contract | Business contacts | Business profile, images | AI providers, CDN on generated sites | US, China (non-personal only) | Contract term | as above |
| Admin/session | Legitimate interest | Admin | Session cookie, IP in limiter memory | none | none | session | scrypt, HttpOnly |

## B. Processor activities (on behalf of each business)
| Activity | Subjects | Data | Sub-processors | Retention |
|---|---|---|---|---|
| Bookings (`/api/book`) | Booking customers | Name, email, phone, notes, date, status, mail log | Resend, hosting | See retention.md |
| Loyalty cards | Members | Name, email/phone, visits, rewards, marketing consent, wallet tokens | Google/Apple Wallet (user-initiated), hosting | See retention.md |
| Digital menu | None personal | Menu, allergens | AI translation | contract |
| Expense scanner | Suppliers, possibly card/loyalty digits on receipts | Receipt images, parsed text | Vision AI providers, hosting | See retention.md |

Review annually and on any new feature or provider. DPIA screening: loyalty profiling and AI use **[PENDING ATD: complete screening]**.
