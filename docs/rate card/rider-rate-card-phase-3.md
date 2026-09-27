# Rider Rate Card Phase 3

## Commercial lifecycle

Phase 2 preview remains read only. Operations creates a persisted commercial offer from a fresh server calculation, then presents it. Rider app offer creation presents immediately because the response is the rider facing offer. The rider sees a filtered presentation of the stored snapshot and the exact terms title, version, and content. Acceptance checks the stored hash and terms, validates current rider, vehicle, hub, and rate card version references, then copies the stored snapshot and terms into a pending rental agreement. It never reprices the offer. A newer rate card therefore does not change a valid presented offer or its agreement.

The offer statuses are `CALCULATED → PRESENTED → ACCEPTED | REJECTED | CANCELLED | SUPERSEDED`; elapsed validity is exposed as `EXPIRED` and acceptance rejects it even without a cleanup job. Operations may supersede a calculated or presented offer by creating a replacement. The agreement statuses are `PENDING_ACTIVATION → ACTIVE | CANCELLED`, `ACTIVE → SUSPENDED | TERMINATION_PENDING | COMPLETED`, `SUSPENDED → ACTIVE | TERMINATION_PENDING`, and `TERMINATION_PENDING → TERMINATED`. Each change writes status history and an audit entry.

Offer acceptance and agreement creation share a serializable transaction. It locks the offer row, uses transaction advisory locks for the rider and vehicle, and relies on partial unique indexes to enforce at most one live agreement for either. Repeated acceptance of the same offer returns its existing agreement. A unique offer key provides request idempotency for offer creation. The offer and agreement numbers come from PostgreSQL sequences. The agreement starts `PENDING_ACTIVATION`; an active allocation for the same rider and vehicle is required for activation. Existing `Allocation` remains the handover source, and acceptance does not manufacture an allocation or any payment state.

Pricing snapshots use schema version 1 and preserve the complete Phase 2 result, including calculation time and historical vehicle, hub, grade, age, rule, charge, and deposit details. The SHA-256 pricing hash canonicalizes recursively sorted object keys and normalized Decimal/date values. It excludes volatile calculation ID/time, and includes the client, snapshot version, pricing content, terms hash, and terms version. The agreement copies both snapshot and hash. Database triggers protect the commercial fields on presented offers and all agreement pricing/terms fields. Relational identifiers, money, status, period, and dates remain searchable.

Terms are client scoped and versioned. An administrator creates a draft and activates it; a unique partial index permits one active terms record per client. The offer copies its title, content, version, and hash. Rider acceptance requires explicit consent and the matching version. Assisted acceptance requires a consent reference and reason and is limited to a client administrator.

## API

- `GET/POST /rider-commercial-terms`, `POST /rider-commercial-terms/:id/activate`: client administrator.
- `GET/POST /rider-commercial-offers`, `GET /rider-commercial-offers/:id`, `POST /rider-commercial-offers/:id/present`, `POST /rider-commercial-offers/:id/cancel`: client administrator or operations manager.
- `POST /rider-commercial-offers/:id/assist-accept`: client administrator.
- `GET/POST /rider-app/commercial-offers`, `GET /rider-app/commercial-offers/:id`, `POST /rider-app/commercial-offers/:id/accept`, `POST /rider-app/commercial-offers/:id/reject`: authenticated rider, resolved to the rider in its client.
- `GET /rider-rental-agreements`, `GET /rider-rental-agreements/:id`, and `POST /rider-rental-agreements/:id/{activate,suspend,termination-request,terminate,complete,cancel}`: client administrator or operations manager.
- `GET /rider-app/rental-agreements`, `GET /rider-app/rental-agreements/:id`: authenticated rider.

New clients must configure and activate contractual terms before offers can be created. Rate card offer validity defaults to 60 minutes and is configurable from 1 to 10080 minutes.

## Phase boundary

The agreement amendment model is a foundation for future accepted commercial changes; no amendment workflow, deposit collection, billing, ledger, mandate, or payment processing is added here. The accepted snapshot is the source for those later phases. Database integration and race tests need a running PostgreSQL service; unit tests cover the acceptance logic and the database constraints are included in the migration.
