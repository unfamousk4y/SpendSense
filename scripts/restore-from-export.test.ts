import { describe, expect, test } from 'vitest';
// @ts-expect-error A plain Node script, with no type declarations.
import { buildRestoreSql } from './restore-from-export.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const emptyLists = {
  accounts: [],
  week_plans: [],
  allowance_changes: [],
  week_closures: [],
  savings_releases: [],
  purchases: [],
  income_receipts: [],
  balance_corrections: [],
  bills: [],
};
const file = (overrides = {}) => ({ format: 'spendsense-export', version: 1, ...emptyLists, ...overrides });
const purchase = { id: 'p1', account_id: 'a1', date: '2026-10-19', merchant: 'Cafe', note: null, cents: 1250 };

describe('building the restore SQL', () => {
  test('every row is owned by the student named now, in one transaction', () => {
    const sql = buildRestoreSql(file({ purchases: [purchase] }), USER);
    expect(sql).toContain(`insert into public.purchases (user_id, id, account_id, date, merchant, note, cents) values ('${USER}', 'p1', 'a1', '2026-10-19', 'Cafe', null, 1250);`);
    expect(sql.indexOf('begin;')).toBeLessThan(sql.indexOf('insert into'));
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
  });

  test('parents come before the rows that point at them', () => {
    const sql = buildRestoreSql(
      file({
        bills: [{ id: 'b1', account_id: 'a1' }],
        allowance_changes: [{ id: 'c1', week_plan_id: 'w1' }],
        week_plans: [{ id: 'w1', account_id: 'a1' }],
        accounts: [{ id: 'a1' }],
      }),
      USER,
    );
    const at = (table: string) => sql.indexOf(`insert into public.${table} `);
    expect(at('accounts')).toBeLessThan(at('week_plans'));
    expect(at('week_plans')).toBeLessThan(at('allowance_changes'));
    expect(at('accounts')).toBeLessThan(at('bills'));
  });

  test('text cannot break out of its quotes', () => {
    const sql = buildRestoreSql(file({ purchases: [{ ...purchase, merchant: "x'); drop table public.accounts; --" }] }), USER);
    expect(sql).toContain("'x''); drop table public.accounts; --'");
  });

  test('a column name cannot carry SQL, and an owner in the file is refused', () => {
    expect(() => buildRestoreSql(file({ purchases: [{ ...purchase, 'cents) values (1); drop table x; --': 1 }] }), USER)).toThrow('Unknown column in purchases');
    expect(() => buildRestoreSql(file({ purchases: [{ ...purchase, user_id: USER }] }), USER)).toThrow('Unknown column in purchases');
  });

  test.each([
    ['fractional cents', 12.5],
    ['an object', { a: 1 }],
    ['a list', [1]],
    ['true or false', true],
    ['a null character', 'a\0b'],
  ])('%s is refused, and the message does not repeat the value', (_name, cents) => {
    expect(() => buildRestoreSql(file({ purchases: [{ ...purchase, cents }] }), USER)).toThrow('Unusable value in purchases.cents');
  });

  test('other files and bad user ids are refused', () => {
    expect(() => buildRestoreSql({ format: 'other', version: 1 }, USER)).toThrow('not a SpendSense export');
    expect(() => buildRestoreSql(file({ version: 2 }), USER)).toThrow('not a SpendSense export');
    expect(() => buildRestoreSql(file(), "x'; drop table y; --")).toThrow('must be a UUID');
    expect(() => buildRestoreSql(file({ bills: undefined }), USER)).toThrow('no bills list');
  });

  test('it refuses to run on a missing user, or over existing accounts', () => {
    const sql = buildRestoreSql(file(), USER);
    expect(sql).toContain('That user does not exist in this project');
    expect(sql).toContain('That user already has accounts here');
  });
});
