-- More than one account per integration, and one of them is the default.
--
-- 0056 allowed exactly one row per provider per workspace. That is wrong the
-- first time an agency has two Slack workspaces, or a Page for the agency and a
-- Page for a client, and it is wrong in a way that loses data rather than
-- refusing: connecting the second one would have overwritten the first, and the
-- messages already synced from it would have been left pointing at a connection
-- that no longer existed.
--
-- WHY A DEFAULT RATHER THAN AN ORDER. Reading is unambiguous, because every
-- message records which account it arrived on. Sending is not: "post this to
-- Slack" has to pick one, and picking the most recently connected would mean a
-- reply going somewhere new because somebody added an account this morning. So
-- one row per provider is marked default, that is the one an unqualified send
-- uses, and it only changes when a person changes it.
alter table public.workspace_integrations add column if not exists is_default boolean not null default false;

/* The old constraint had provider alone as the key. Dropped by name AND by the
   name Postgres generates, because 0056 may have been applied before this file
   existed and the constraint could carry either. */
alter table public.workspace_integrations drop constraint if exists workspace_integrations_workspace_id_provider_key;

/* The account IS the identity now. Re-connecting the same Slack workspace
   updates its row (a fresh token, a renamed workspace); connecting a different
   one adds a row beside it.

   external_id is never null by the time it reaches here: the callback falls
   back to the provider name for the one provider that issues no id, which makes
   that provider single-account and says so by construction rather than by a
   comment somebody has to find. */
create unique index if not exists workspace_integrations_account_uniq
  on public.workspace_integrations (workspace_id, provider, external_id);

/* Exactly one default per provider, enforced here rather than in application
   code. Two defaults is a coin toss over where a client's reply goes, and that
   is not a bug anybody would spot until it had already happened. */
create unique index if not exists workspace_integrations_one_default
  on public.workspace_integrations (workspace_id, provider)
  where is_default;

-- Everything connected before this file existed is the default for its
-- provider, because it was the only one.
update public.workspace_integrations set is_default = true
  where not is_default
    and id in (
      select distinct on (workspace_id, provider) id
      from public.workspace_integrations
      order by workspace_id, provider, connected_at asc
    );

-- ── What the browser may do with the new column ─────────────────────────
grant select (is_default) on public.workspace_integrations to authenticated;

/* Update is granted on is_default ALONE. A member can choose which account
   sends, and cannot touch a token, a label or an id with the same permission:
   the column grant makes the other columns unreachable rather than merely
   discouraged. */
grant update (is_default) on public.workspace_integrations to authenticated;

drop policy if exists "set default integration" on public.workspace_integrations;
create policy "set default integration" on public.workspace_integrations for update to authenticated
  using (workspace_id = my_workspace())
  with check (workspace_id = my_workspace());

comment on column public.workspace_integrations.is_default is
  'Which account an unqualified send uses. Exactly one per provider per workspace, enforced by a partial unique index.';
