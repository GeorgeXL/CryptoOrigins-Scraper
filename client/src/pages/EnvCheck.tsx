export default function EnvCheck() {
  const env = import.meta.env as Record<string, string | undefined>;
  
  const envVars = {
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    SUPABASE_URL: env.SUPABASE_URL,
    PUBLIC_SUPABASE_URL: env.PUBLIC_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ? '***' + env.VITE_SUPABASE_ANON_KEY.slice(-4) : undefined,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ? '***' + env.SUPABASE_ANON_KEY.slice(-4) : undefined,
    PUBLIC_SUPABASE_ANON_KEY: env.PUBLIC_SUPABASE_ANON_KEY ? '***' + env.PUBLIC_SUPABASE_ANON_KEY.slice(-4) : undefined,
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1>Environment Variables Check</h1>
      <pre style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '4px' }}>
        {JSON.stringify(envVars, null, 2)}
      </pre>
      <p style={{ marginTop: '2rem', color: '#666' }}>
        This page shows which Supabase environment variables are available to the client.
      </p>
    </div>
  );
}

