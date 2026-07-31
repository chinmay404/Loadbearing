// Diagnosis of a Postgres connection string, kept apart from the Postgres client
// so reading it costs nothing on an install that never loads pg.
//
// Every one of these mistakes fails as a connection error that says nothing about
// the URL — "max clients reached", "connection timeout", "password
// authentication failed" — so the URL has to be checked directly.

export function adviseOnConnectionString(url: string, serverless: boolean): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'DATABASE_URL is not a valid URL.';
  }
  const host = parsed.hostname;
  const port = parsed.port || '5432';
  const pooled = host.includes('pooler.supabase.com');

  if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
    return `DATABASE_URL points at Supabase's direct host (${host}). Use the transaction pooler on port 6543 instead — the direct host is IPv6-only on newer projects, and its connection limit does not survive a fleet of functions.`;
  }
  if (pooled && port === '5432' && serverless) {
    return `DATABASE_URL uses the Supabase pooler in SESSION mode (port ${port}), which holds one database backend per client and allows only 15 of them. Change the port to 6543 for transaction mode, which multiplexes many clients onto few backends.`;
  }
  if (pooled && !parsed.username.includes('.')) {
    return `DATABASE_URL uses the Supabase pooler but the username is "${parsed.username}". The pooler needs the project ref in the username: postgres.<project-ref>.`;
  }
  return null;
}
