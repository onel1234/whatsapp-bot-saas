"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { api, apiUrl } from "../lib/api";
export default function AuthForm({ register = false }: { register?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    api<{ google: boolean }>("/auth/config")
      .then((r) => setGoogle(r.google))
      .catch(() => {});
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/auth/${register ? "register" : "login"}`, data);
      window.location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <aside className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-mark">s</span>saha.
        </Link>
        <div>
          <span className="eyebrow">GOOD CONVERSATIONS. GREAT BUSINESS.</span>
          <h1>
            Your next chapter
            <br />
            starts with
            <br />
            <em>a hello.</em>
          </h1>
          <p>
            A workspace for your team.
            <br />A warmer welcome for your customers.
          </p>
          <div className="language-line">Hello. ආයුබෝවන්. வணக்கம்.</div>
        </div>
        <small>Built with local business in mind.</small>
      </aside>
      <section className="auth-panel">
        <Link className="back-link" href="/">
          Back to home <ArrowUpRight size={14} />
        </Link>
        <div className="auth-box">
          <span className="eyebrow">LET’S GET YOU SETTLED</span>
          <h2>{register ? "Make room for growth." : "Welcome back."}</h2>
          <p>
            {register
              ? "Create your account and your first business workspace."
              : "Sign in to your customer workspace."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <>
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                    placeholder="e.g. Amaya Perera"
                  />
                </label>
                <label>
                  Business name
                  <input
                    name="businessName"
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="e.g. Ceylon Collective"
                  />
                </label>
              </>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@business.lk"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 12 : 1}
                maxLength={128}
                placeholder={
                  register ? "At least 12 characters" : "Your password"
                }
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? "One moment…" : register ? "Create workspace" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          {google && (
            <>
              <div className="divider">or</div>
              <a
                className="button secondary full"
                href={`${apiUrl}/auth/google`}
              >
                Continue with Google
              </a>
            </>
          )}
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to Saha?"}{" "}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create a workspace"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
