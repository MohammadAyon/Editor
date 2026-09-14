# Supabase Deployment Checklist

Use this checklist to deploy the Cover Generator safely. Run the SQL in a staging project first, then repeat the verified process in production.

## 1. Before running SQL

- [ ] Confirm you are connected to the intended Supabase project.
- [ ] Confirm the project has email/password Auth enabled, or configure the chosen provider.
- [ ] Confirm the production site URL and local staging URL are known.
- [ ] Confirm no `service_role` key is present in browser files.
- [ ] Take a database backup or confirm the project is disposable if this is the first setup.
- [ ] Review [supabase-schema-final.sql](supabase-schema-final.sql) in source control before executing it.

## 2. Apply the schema

- [ ] Open the Supabase SQL Editor.
- [ ] Run [supabase-schema-final.sql](supabase-schema-final.sql) as a project administrator.
- [ ] Confirm these tables exist:
  - [ ] `public.presets`
  - [ ] `public.projects`
  - [ ] `public.brand_images`
- [ ] Confirm `owner_id` is `uuid not null` and references `auth.users(id)` on all three tables.
- [ ] Confirm RLS is enabled on all three public tables.
- [ ] Confirm the `cover-images` Storage bucket exists and is private.
- [ ] Confirm the Storage policies exist for select, insert, and delete.

## 3. Configure the frontend

- [ ] Set the Supabase project URL in [supabase-config.js](supabase-config.js).
- [ ] Set only the browser-safe publishable/anon key in [supabase-config.js](supabase-config.js).
- [ ] Confirm the key is not a service-role or secret key.
- [ ] Confirm uploads use paths shaped like `<user-id>/projects/...`, `<user-id>/logos/...`, or `<user-id>/elements/...`.
- [ ] Confirm the deployed site uses HTTPS.

## 4. Configure Supabase Auth

In **Authentication > URL Configuration**:

- [ ] Set the production **Site URL**.
- [ ] Add the local staging URL to **Redirect URLs**.
- [ ] Add the production URL to **Redirect URLs**.
- [ ] Test sign-in with a dedicated staging user.
- [ ] Test sign-out and refresh behavior.
- [ ] Confirm an unauthenticated visitor sees the auth gate and cannot use the editor.

## 5. Required security tests in staging

Use two separate test users, `User A` and `User B`.

### Anonymous access

- [ ] Anonymous `select` from `presets` returns no rows or is denied.
- [ ] Anonymous `select` from `projects` returns no rows or is denied.
- [ ] Anonymous `select` from `brand_images` returns no rows or is denied.
- [ ] Anonymous Storage listing/download is denied.
- [ ] Anonymous insert/update/delete attempts are denied.

### Owner isolation

- [ ] User A can create and read their own preset.
- [ ] User A can update and delete their own preset.
- [ ] User A can create and read their own project.
- [ ] User A can create and delete their own brand image.
- [ ] User B cannot select User A's rows.
- [ ] User B cannot update User A's rows, including changing `owner_id`.
- [ ] User B cannot delete User A's rows.
- [ ] User B cannot read, overwrite, or delete User A's Storage objects.
- [ ] A user cannot upload an object whose first path segment is another user's ID.
- [ ] A user cannot upload into an unsupported second-level folder.

### Application flows

- [ ] Sign in and hydrate presets, projects, and brand images.
- [ ] Save, update, and delete a preset.
- [ ] Create a project without an image.
- [ ] Create a project with a project image.
- [ ] Upload and delete a brand logo.
- [ ] Reload the page and confirm signed image URLs are regenerated.
- [ ] Print a project after remote image hydration.
- [ ] Disable or misconfigure Supabase and confirm local fallback behavior remains usable.

## 6. Inspect the final policies

In the Supabase dashboard, confirm:

- [ ] Each public table has separate select, insert, update, and delete owner policies.
- [ ] Table policies compare `auth.uid()` to `owner_id`.
- [ ] Update policies use both `using` and `with check` ownership conditions.
- [ ] Storage select and delete policies compare the first path segment to `auth.uid()`.
- [ ] Storage insert policy checks the first path segment and allows only `projects`, `logos`, or `elements` as the second segment.
- [ ] No older broad policy grants public or cross-user access.

Useful SQL checks:

```sql
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select id, name, public
from storage.buckets
where id = 'cover-images';
```

## 7. Pre-production application checks

From the repository root:

```bash
npm install
npm test
npm run check
```

Then verify in a browser:

- [ ] No console errors during sign-in.
- [ ] No failed Supabase requests during hydration.
- [ ] No image requests expose a permanent public URL.
- [ ] The print preview contains the expected page dimensions and images.
- [ ] Refreshing the app preserves remote data for the signed-in user.
- [ ] Signing out removes access to the editor and remote data.

## 8. Production release

- [ ] Apply the reviewed SQL to the production Supabase project.
- [ ] Configure production Auth URLs.
- [ ] Configure production `supabase-config.js` values.
- [ ] Deploy the static site over HTTPS.
- [ ] Repeat the anonymous and owner-isolation smoke tests against production.
- [ ] Create a first production user and verify the complete preset, project, logo, and print workflows.
- [ ] Record the deployment date, Supabase project, deployed commit, and test result.

## 9. Rollback notes

- Keep the previous static deployment available in the hosting provider.
- Do not disable RLS as a rollback strategy.
- If a policy issue is found, restrict access, fix the SQL, test in staging, and redeploy.
- If a frontend release is faulty, roll back the static deployment while leaving the database protections enabled.
