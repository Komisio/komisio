# Purchase registration

P1 S5. Store-owned goods enter through `purchase_receipts`: reference `P-n`,
purchase price in öre, a required evidence reference (receipt number or a
note of the private seller and date), an optional supplier note, and the
margin-scheme eligibility attested by the registering staff member at the
purchase, which is the moment the law requires it. Provider is `manual`;
POS-sourced purchases (Zettle) will use the same table with a provider
reference in P2. Immutable; staff register through `registerPurchase` in the
intake command with request-id replay; readonly can read. The purchases page
has the form and the 20 latest purchases. Acceptance (S4) takes a purchase
as its third origin with ownership `store`, no seller, no agreement and no
seller consent, and copies the attested eligibility. Never enters through the
consignment paths.
