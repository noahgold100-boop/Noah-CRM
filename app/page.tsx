import { currentUser } from "@/lib/session";
import { missingEnv } from "@/lib/env";
import App from "@/components/App";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const missing = missingEnv();

  if (missing.length) {
    return (
      <main className="login">
        <div style={{ maxWidth: 460 }}>
          <h1>Setup isn&apos;t finished</h1>
          <p>Add these in Vercel under Settings, Environment Variables, then redeploy:</p>
          <ul style={{ textAlign: "left", lineHeight: 1.8, margin: "0 auto", display: "inline-block" }}>
            {missing.map((m) => (
              <li key={m}>
                <code>{m}</code>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  let user: string | null = null;
  let configError: string | null = null;
  try {
    user = await currentUser();
  } catch (e: any) {
    configError = e?.message || "The app isn't configured yet.";
  }

  if (!user) {
    return (
      <main className="login">
        <div>
          <h1>Noah Gold</h1>
          <p>Your contacts, kept current from your email.</p>
          {configError ? (
            <p className="err">{configError}</p>
          ) : (
            <a className="btn primary" href="/api/auth/google">
              Sign in with Google
            </a>
          )}
          {error && <p className="err" style={{ marginTop: 16 }}>{error}</p>}
        </div>
      </main>
    );
  }
  return <App />;
}
