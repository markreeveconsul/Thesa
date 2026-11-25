"use client";
import { Otto } from "./Otto";
import Link from "next/link";
import { Brand } from "./Brand";
import { useActionState, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { authenticate, signInWithGoogle } from "@/app/auth/actions";

type AuthMode = "login" | "signup" | "reset" | "update";

export function AuthForm({
  configured,
  recovery = false,
  linkError = false,
  oauthError = false,
}: {
  configured: boolean;
  recovery?: boolean;
  linkError?: boolean;
  oauthError?: boolean;
}) {
  const [mode, setMode] = useState<AuthMode>(recovery ? "update" : "login");
  const [state, action, pending] = useActionState(authenticate, {});
  const [googleState, googleAction, googlePending] = useActionState(
    signInWithGoogle,
    {},
  );
  const title = {
    login: "Welcome back",
    signup: "Begin your next chapter.",
    reset: "Find your way back.",
    update: "Choose a new password.",
  }[mode];

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-intro">
          <span className="auth-intro-eyebrow">THESA STUDIO · ARCHIVAL EDITION</span>
          <h1>Your thesis, backed by every source you read.</h1>
          <p>
            Read your PDFs beside your manuscript, verify every claim with
            grounded citations, and keep your argument tethered to your research
            problem.
          </p>
          <div className="auth-manuscript">
            <div className="auth-manuscript-head">
              <span className="eyebrow">CHAPTER II · LITERATURE SYNTHESIS</span>
              <Otto pose="welcome" size="md" animate />
            </div>
            <p>
              Learners now spend several hours each day on social platforms
              <strong>Dela Cruz &amp; Lim, 2022</strong>, shaping the cadence
              they reserve for deep academic reading.
            </p>
            <div className="auth-manuscript-meta">
              <span className="sample-citation">Dela Cruz &amp; Lim, p. 4</span>
              <span aria-hidden="true" className="auth-meta-dot">·</span>
              <span className="auth-preview-fit">
                Aligned with your research problem
              </span>
            </div>
          </div>

          <ul className="auth-pillars" aria-label="Workspace highlights">
            <li>
              <Check size={14} aria-hidden="true" />
              <span>Source-grounded Q&amp;A with page citations</span>
            </li>
            <li>
              <Check size={14} aria-hidden="true" />
              <span>6-dimension thesis feasibility diagnostic</span>
            </li>
            <li>
              <Check size={14} aria-hidden="true" />
              <span>APA 7, MLA 9 &amp; IEEE inline citing + Markdown export</span>
            </li>
          </ul>
        </section>

        <section className="auth-card">
          <Link href="/" className="wordmark">
            <Brand />
          </Link>
          <span className="eyebrow">THESA</span>

          <h2>{title}</h2>
          <p>
            {mode === "login"
              ? "Sign in to continue your thesis."
              : mode === "signup"
                ? "Create your private research workspace."
                : mode === "reset"
                  ? "Enter your university or personal email to receive a recovery link."
                  : "Set a strong password for your workspace."}
          </p>

          {!configured && (
            <p className="notice">
              Account setup is pending. You can write browser drafts without an
              account.
            </p>
          )}
          {linkError && (
            <p role="alert" className="error-text">
              This sign-in link is invalid or expired. Please try signing in
              again, or check Supabase provider and callback settings.
            </p>
          )}
          {oauthError && (
            <p role="alert" className="error-text">
              Google did not complete sign-in. Check that Google is enabled,
              new user sign-ups are allowed, and your account is listed as a
              test user if the consent screen is in testing mode.
            </p>
          )}

          <form action={action} className="stack">
            <input type="hidden" name="mode" value={mode} />
            {mode !== "update" && (
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@university.edu"
                  disabled={!configured}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  placeholder="Your password"
                  required
                  minLength={mode === "login" ? 1 : 12}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  disabled={!configured}
                />
                {mode !== "login" && <small>At least 12 characters.</small>}
              </label>
            )}
            {state.error && (
              <p role="alert" className="error-text">
                {state.error}
              </p>
            )}
            {state.message && (
              <p role="status" className="notice">
                {state.message}
              </p>
            )}
            <button className="primary" disabled={!configured || pending}>
              {pending
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "reset"
                      ? "Send recovery email"
                      : "Update password"}
              <ArrowRight size={16} />
            </button>
          </form>

          {mode === "login" && (
            <form action={googleAction}>
              {googleState.error && (
                <p role="alert" className="error-text">
                  {googleState.error}
                </p>
              )}
              <button
                className="secondary google-login"
                disabled={!configured || googlePending}
                type="submit"
              >
                {googlePending ? "Connecting…" : "Continue with Google"}
              </button>
            </form>
          )}
          {!recovery && (
            <div className="auth-links">
              <button
                type="button"
                className="text-button"
                onClick={() => setMode(mode === "signup" ? "login" : "signup")}
              >
                {mode === "signup"
                  ? "Already have an account? Sign in"
                  : "New here? Create an account"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setMode(mode === "reset" ? "login" : "reset")}
              >
                {mode === "reset" ? "Back to sign in" : "Forgot password?"}
              </button>
            </div>
          )}
        </section>
      </div>
      <footer className="auth-footer">
        Your ideas stay yours. Browser drafts stay on this device.
      </footer>
    </main>
  );
}
