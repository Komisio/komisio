-- Keep destination reads and retention checks indexed as history grows.
create index payout_bank_review_current on public.payout_bank_reviews(tenant_id,payout_id,seq desc);
create index payout_bank_review_evidence on public.payout_bank_reviews(tenant_id,bank_version);
