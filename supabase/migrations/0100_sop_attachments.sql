-- Files on an SOP.
--
-- 19 Oct 2026 team meeting: SOPs can carry a Loom walkthrough (0089), and
-- "a feature where they can upload files" was promised next, so a template,
-- checklist or example sits with the procedure it belongs to.
--
-- A column on files rather than a new table: the bytes, the storage rules and
-- the read/write/delete policies (0067) are already right for a team file, and
-- an SOP attachment is a team file that also points at an SOP. Deleting the
-- SOP keeps the file on the team shelf instead of losing it.
alter table files add column if not exists sop_id uuid references sops (id) on delete set null;
create index if not exists files_sop_idx on files (sop_id) where sop_id is not null;
