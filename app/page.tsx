import { currentUser } from "@/lib/session";
import App from "@/components/App";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
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
