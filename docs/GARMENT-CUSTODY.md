# Garment custody

P1 S3. A reception session binds a store and a seller but proves nothing
physical. `garment_receipts` records, once per session, that staff have the
garment in the store: reference `G-n` from a per-store-independent sequence,
optional note, custody source (`staff_receipt` today; other sources follow
the store policy), actor and time. It is immutable; corrections are new
facts in later slices. Readonly members can read it; staff record it through
`receiveGarment` in the intake command with request-id replay; one receipt
per session is enforced in SQL. The reception page shows the custody state
and a label page prints the reference with the existing label print styles.
The reception queue exposes `custody` per row and points an approved,
unreceived garment to `record_custody`. Acceptance (S4) requires this receipt
for the reception origin. Not custody: bag receipts (their own table), and
not implied: acceptance, sale eligibility or seller consent.
