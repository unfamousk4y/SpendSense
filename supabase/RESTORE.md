# Rebuilding the database and restoring a student

The Free plan has no automatic backups. What can be recovered is what is in this repository, plus the export files students have downloaded.

## Rebuild an empty project

1. Create the project.
2. Run every file in `supabase/migrations/`, in file name order.
3. Set up what the migrations do not hold, in the dashboard: the Google sign-in provider, its client secret, the site URL and redirect URLs. Keep "Confirm email" as the project needs it, and do not copy the development project's setting to the beta.

## Restore one student

1. The student signs in to the new project once, so they have a user. Their id will be new.
2. Copy their id from **Authentication > Users**.
3. From the project root, using their downloaded export file:

   ```bash
   node scripts/restore-from-export.mjs export.json THEIR-USER-ID student.restore.sql
   ```

4. Read the SQL, then run it in the dashboard's SQL editor. All of it is restored or none of it. It refuses a user who does not exist or who already has accounts.
5. Ask the student to check their numbers.
6. Delete the export and `student.restore.sql`. They hold financial details.

## What comes back

- **Kept, with original ids, amounts, dates and created times:** accounts, purchases, income, corrections, bills, week plans, allowance changes, closures and releases.
- **Not kept:** the sign-in. The student gets a new user id, and every row is assigned to it. The export leaves out owner ids, and the script refuses a file that includes one.
- **Lost:** anything saved after the student's last export.

Running the SQL needs full database rights. Claude's connector write access must be off once there is real student data, so the owner runs it.
