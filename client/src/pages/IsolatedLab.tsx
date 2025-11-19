import { FormEvent, type CSSProperties, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type LabSample = {
  id: string;
  title: string;
  details: string | null;
  importance: number;
  created_at: string;
};

const env = import.meta.env as Record<string, string | undefined>;

const supabaseUrl =
  env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY ??
  env.SUPABASE_ANON_KEY ??
  env.PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      })
    : null;

export default function IsolatedLab() {
  const [samples, setSamples] = useState<LabSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState({
    title: "",
    details: "",
    importance: 1,
  });

  const isReady = Boolean(supabase);

  const fetchSamples = async (showSpinner = true) => {
    if (!supabase) return;
    showSpinner ? setLoading(true) : setRefreshing(true);
    const { data, error: queryError } = await supabase
      .from("isolated_lab_samples")
      .select("*")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
    } else {
      setError(null);
      setSamples(data ?? []);
    }

    showSpinner ? setLoading(false) : setRefreshing(false);
  };

  useEffect(() => {
    if (!supabase) {
      setError(
        "Supabase credentials are missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY (VITE_/PUBLIC_ prefixes also work)."
      );
      setLoading(false);
      return;
    }
    fetchSamples();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    if (!formValues.title.trim()) {
      setError("Title is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("isolated_lab_samples")
      .insert({
        title: formValues.title.trim(),
        details: formValues.details.trim() || null,
        importance: formValues.importance,
      });

    if (insertError) {
      setError(insertError.message);
    } else {
      setFormValues({ title: "", details: "", importance: 1 });
      fetchSamples(false);
    }

    setSaving(false);
  };

  return (
    <div style={pageStyles.wrapper}>
      <div style={pageStyles.card}>
        <header style={pageStyles.header}>
          <div>
            <p style={pageStyles.eyebrow}>Supabase Lab</p>
            <h1 style={pageStyles.title}>Isolated Testing Ground</h1>
            <p style={pageStyles.subtitle}>
              Minimal React page that talks directly to the Supabase table
              <code style={pageStyles.code}>isolated_lab_samples</code>.
            </p>
          </div>
          <button
            style={pageStyles.refreshButton}
            onClick={() => fetchSamples(false)}
            disabled={!isReady || loading || refreshing}
          >
            {refreshing ? "Refreshing…" : "Manual Refresh"}
          </button>
        </header>

        {!isReady && (
          <div style={pageStyles.alert}>
            Supabase client is not configured. Set environment variables and
            reload.
          </div>
        )}

        {error && <div style={pageStyles.error}>{error}</div>}

        <section>
          <form style={pageStyles.form} onSubmit={handleSubmit}>
            <label style={pageStyles.label}>
              Title
              <input
                style={pageStyles.input}
                type="text"
                value={formValues.title}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
                placeholder="Quick headline"
                required
                disabled={!isReady || saving}
              />
            </label>

            <label style={pageStyles.label}>
              Details
              <textarea
                style={{ ...pageStyles.input, minHeight: 80, resize: "vertical" }}
                value={formValues.details}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    details: event.target.value,
                  }))
                }
                placeholder="Longer note for context (optional)"
                disabled={!isReady || saving}
              />
            </label>

            <label style={pageStyles.label}>
              Importance (0-5)
              <input
                style={pageStyles.input}
                type="number"
                min={0}
                max={5}
                step={1}
                value={formValues.importance}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    importance: Number(event.target.value),
                  }))
                }
                disabled={!isReady || saving}
              />
            </label>

            <button
              style={pageStyles.primaryButton}
              type="submit"
              disabled={!isReady || saving}
            >
              {saving ? "Saving…" : "Insert Row"}
            </button>
          </form>
        </section>

        <section>
          <h2 style={pageStyles.sectionTitle}>
            Latest rows ({samples.length})
          </h2>
          {loading ? (
            <p style={pageStyles.muted}>Loading data…</p>
          ) : samples.length === 0 ? (
            <p style={pageStyles.muted}>
              No entries yet. Add one above to populate the table.
            </p>
          ) : (
            <div style={pageStyles.list}>
              {samples.map((sample) => (
                <article key={sample.id} style={pageStyles.listItem}>
                  <div style={pageStyles.listItemHeader}>
                    <strong>{sample.title}</strong>
                    <span style={pageStyles.badge}>
                      importance {sample.importance}
                    </span>
                  </div>
                  {sample.details && (
                    <p style={pageStyles.details}>{sample.details}</p>
                  )}
                  <p style={pageStyles.timestamp}>
                    {new Date(sample.created_at).toLocaleString()}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const pageStyles: Record<string, CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    padding: "32px",
    background:
      "linear-gradient(120deg, rgba(13,17,23,1) 0%, rgba(29,35,42,1) 60%, rgba(43,50,61,1) 100%)",
    color: "#f2f4f8",
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  card: {
    maxWidth: 960,
    margin: "0 auto",
    background: "rgba(10, 12, 15, 0.65)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    padding: 32,
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 24,
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 12,
    color: "#a0aec0",
    marginBottom: 4,
  },
  title: {
    fontSize: 32,
    margin: 0,
  },
  subtitle: {
    marginTop: 8,
    color: "#cbd5f5",
  },
  code: {
    marginLeft: 8,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(255,255,255,0.08)",
    fontSize: 14,
  },
  refreshButton: {
    alignSelf: "flex-start",
    padding: "10px 18px",
    background: "#1e293b",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#e2e8f0",
    cursor: "pointer",
  },
  alert: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid #facc15",
    background: "rgba(250,204,21,0.1)",
    color: "#facc15",
    marginBottom: 16,
  },
  error: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid #f87171",
    background: "rgba(248,113,113,0.1)",
    color: "#fca5a5",
    marginBottom: 16,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    marginBottom: 32,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 14,
    color: "#cbd5f5",
  },
  input: {
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(15,18,25,0.9)",
    color: "#f8fafc",
    fontSize: 16,
  },
  primaryButton: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    background:
      "linear-gradient(135deg, rgba(56,189,248,1), rgba(14,165,233,1))",
    color: "#0f172a",
    fontWeight: 600,
    cursor: "pointer",
  },
  sectionTitle: {
    fontSize: 22,
    marginBottom: 12,
  },
  muted: {
    color: "#94a3b8",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  listItem: {
    padding: 20,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(15,18,25,0.9)",
  },
  listItemHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    gap: 16,
  },
  badge: {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(14,165,233,0.15)",
    color: "#38bdf8",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  details: {
    margin: "8px 0 12px",
    color: "#e2e8f0",
    lineHeight: 1.5,
  },
  timestamp: {
    fontSize: 13,
    color: "#94a3b8",
  },
};


