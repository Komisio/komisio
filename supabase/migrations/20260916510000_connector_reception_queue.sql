-- Two more tools for a connected assistant (2026-09-16, Opus). Both already
-- read through SQL functions only; they were excluded with the rest of the
-- reception and pricing tools and were never re-examined after the functions
-- arrived. Nothing new is exposed: each row names a function that already
-- checks the caller's role and store, under a scope the store grants by hand.
--
-- reception_queue is the list of receptions waiting for work. Without it an
-- assistant with reception:read can see a reception the person names but
-- cannot find out which ones are waiting, which is most of the value.
insert into public.connector_functions(function_name,scope,kind)
 values('reception_queue','reception:read','')
 on conflict do nothing;
-- item_detail already sits under items:read. A price proposal reads the item
-- it proposes a price for, so a grant that may propose a price must reach it
-- under that scope too; otherwise the tool refuses on its first read and the
-- store has to grant items:read for a proposal it already allowed.
insert into public.connector_functions(function_name,scope,kind)
 values('item_detail','lifecycle:propose','')
 on conflict do nothing;
