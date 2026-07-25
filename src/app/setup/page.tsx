"use client";

import { Button, InlineNotice } from "@/components/ui";
import { api, errorMessage } from "@/lib/ui/api";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.setup({ username, password });
      router.replace("/");
    } catch (setupError) {
      setError(errorMessage(setupError));
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span>M</span>
          <strong>MONETA</strong>
        </div>
        <div className="auth-icon">
          <ShieldCheck size={21} aria-hidden="true" />
        </div>
        <p className="eyebrow">One local owner</p>
        <h1>Make it yours.</h1>
        <p className="auth-description">
          Create the administrator account for this Moneta instance.
        </p>
        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        <form onSubmit={submit} className="auth-form">
          <div className="form-field">
            <label htmlFor="setup-username">Username</label>
            <input
              id="setup-username"
              className="input"
              autoComplete="username"
              required
              autoFocus
              minLength={3}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="setup-password">Password</label>
            <input
              id="setup-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          <Button type="submit" loading={loading}>
            Create local account
            <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </form>
        <p className="auth-switch">
          Already configured? <Link href="/login">Sign in</Link>
        </p>
      </section>
      <p className="auth-footnote">Credentials stay encrypted on this server.</p>
    </main>
  );
}
