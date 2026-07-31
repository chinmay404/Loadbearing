import { describe, expect, it } from 'vitest';
import { adviseOnConnectionString } from './advice.js';

const REF = 'sfpudybqsufzxmnfivsd';

describe('adviseOnConnectionString', () => {
  it('accepts the transaction pooler with a project-ref username', () => {
    const url = `postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
    expect(adviseOnConnectionString(url, true)).toBeNull();
  });

  it('flags the direct host, which cannot serve a function fleet', () => {
    const url = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;
    expect(adviseOnConnectionString(url, true)).toMatch(/direct host/i);
    expect(adviseOnConnectionString(url, true)).toMatch(/6543/);
  });

  it('flags session mode on serverless — the max-clients failure', () => {
    const url = `postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    const advice = adviseOnConnectionString(url, true);
    expect(advice).toMatch(/SESSION mode/);
    expect(advice).toMatch(/6543/);
  });

  it('leaves session mode alone off serverless, where it is the right choice', () => {
    const url = `postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    expect(adviseOnConnectionString(url, false)).toBeNull();
  });

  it('flags a bare postgres username against the pooler', () => {
    const url = 'postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    expect(adviseOnConnectionString(url, true)).toMatch(/project ref/i);
  });

  it('says so when the value is not a URL at all', () => {
    expect(adviseOnConnectionString('host=db.example.co port=5432', true)).toMatch(/not a valid URL/);
  });

  it('has nothing to say about a plain local Postgres', () => {
    expect(adviseOnConnectionString('postgresql://me:pw@localhost:5432/loadbearing', false)).toBeNull();
  });
});
