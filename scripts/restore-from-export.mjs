// Turns a student's SpendSense export file into one SQL file that puts their
// rows back, under the user id they have now. Their id changes when a project is
// rebuilt, because a new project has new sign-ins.
//
//   node scripts/restore-from-export.mjs <export.json> <user-uuid> <name>.restore.sql
//
// Then read the SQL and run it in the Supabase SQL editor for the target project.
// It runs with full rights, so the file is treated as untrusted: only known
// tables and columns are written, and every value is quoted or checked.
// It holds financial details: *.restore.sql is git-ignored. Delete it afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Parents before the rows that point at them. Ownership is never read from the file.
const COLUMNS = {
  accounts: ['id', 'currency', 'opening_date', 'opening_cash_cents', 'opening_protected_cents', 'plan_end_date', 'created_at'],
  week_plans: ['id', 'account_id', 'week_start', 'recommended_cents', 'starting_allowance_cents', 'created_at'],
  allowance_changes: ['id', 'week_plan_id', 'made_on', 'from_cents', 'to_cents', 'suggested_cents', 'created_at'],
  week_closures: ['id', 'account_id', 'week_start', 'allowance_cents', 'spent_cents', 'leftover_cents', 'protected_cents', 'created_at'],
  savings_releases: ['id', 'account_id', 'made_on', 'cents', 'created_at'],
  purchases: ['id', 'account_id', 'date', 'merchant', 'note', 'category', 'need_or_want', 'cents', 'created_at'],
  income_receipts: ['id', 'account_id', 'received_on', 'source', 'cents', 'created_at'],
  balance_corrections: ['id', 'account_id', 'corrected_on', 'difference_cents', 'note', 'created_at'],
  bills: ['id', 'account_id', 'name', 'due_on', 'cents', 'paid_on', 'paid_cents', 'created_at'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function literal(value, where) {
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && !value.includes('\0')) return `'${value.replaceAll("'", "''")}'`;
  // Names the place only. A value could be someone's financial detail.
  throw new Error(`Unusable value in ${where}`);
}

/** The SQL, in one transaction: all of it is restored, or none of it. */
export function buildRestoreSql(file, userId) {
  if (file?.format !== 'spendsense-export' || file.version !== 1) {
    throw new Error('This is not a SpendSense export this script understands');
  }
  if (!UUID.test(userId)) throw new Error('The user id must be a UUID');

  const statements = [];
  for (const [table, allowed] of Object.entries(COLUMNS)) {
    const rows = file[table];
    if (!Array.isArray(rows)) throw new Error(`The export has no ${table} list`);
    for (const row of rows) {
      const columns = Object.keys(row);
      const unknown = columns.find((column) => !allowed.includes(column));
      if (unknown !== undefined) throw new Error(`Unknown column in ${table}`);
      const values = columns.map((column) => literal(row[column], `${table}.${column}`));
      statements.push(`insert into public.${table} (user_id, ${columns.join(', ')}) values ('${userId}', ${values.join(', ')});`);
    }
  }

  return `-- Restores one student's SpendSense export. Holds financial details: delete after use.
begin;
set local standard_conforming_strings = on;

do $$
begin
  if not exists (select 1 from auth.users where id = '${userId}') then
    raise exception 'That user does not exist in this project. They must sign in here first.';
  end if;
  if exists (select 1 from public.accounts where user_id = '${userId}') then
    raise exception 'That user already has accounts here, so nothing was restored.';
  end if;
end;
$$;

${statements.join('\n')}

commit;
`;
}

// Only when run directly, so the test can import the function above.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [exportPath, userId, outputPath] = process.argv.slice(2);
  if (!exportPath || !userId || !outputPath?.endsWith('.restore.sql')) {
    console.error('Usage: node scripts/restore-from-export.mjs <export.json> <user-uuid> <name>.restore.sql');
    process.exit(1);
  }
  try {
    writeFileSync(outputPath, buildRestoreSql(JSON.parse(readFileSync(exportPath, 'utf8')), userId));
    console.log(`Wrote ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not build the restore file');
    process.exit(1);
  }
}
