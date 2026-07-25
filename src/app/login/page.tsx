"use client";

import { Button, InlineNotice } from "@/components/ui";
import { api, errorMessage } from "@/lib/ui/api";
import { ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

function safeNextPath() {
  const candidate = new URLSearchParams(window.location.search).get("next");
  return candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login({ username, password });
      router.replace(safeNextPath());
    } catch (loginError) {
      setError(errorMessage(loginError));
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
          <LockKeyhole size={20} aria-hidden="true" />
        </div>
        <p className="eyebrow">Private finance workspace</p>
        <h1>Welcome back.</h1>
        <p className="auth-description">
          Sign in to your self-hosted financial home.
        </p>
        {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
        <form onSubmit={submit} className="auth-form">
          <div className="form-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              required
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" loading={loading}>
            Sign in
            <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </form>
        <p className="auth-switch">
          First time here? <Link href="/setup">Set up Moneta</Link>
        </p>
      </section>
      <p className="auth-footnote">No telemetry · No cloud account · Your SQLite file</p>
    </main>
  );
}
