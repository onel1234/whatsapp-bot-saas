"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
export default function Invite() {
  const [message, setMessage] = useState(
    "Sign in with the email address this invitation was sent to, then accept to join the team.",
  );
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    try {
      const token = new URLSearchParams(window.location.search).get("token");
      const result = await api<{ tenantId: string }>("/invitations/accept", {
        token,
      });
      localStorage.setItem("saha_workspace", result.tenantId);
      window.location.assign("/dashboard");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not accept invitation.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="center-page">
      <section className="card invite-card">
        <span className="brand">saha.</span>
        <h1>You’re invited.</h1>
        <p role="status">{message}</p>
        <button className="button primary" disabled={busy} onClick={accept}>
          {busy ? "Joining…" : "Accept invitation"}
        </button>
        <p>
          <Link href="/login" target="_blank">
            Sign in in a new tab
          </Link>{" "}
          ·{" "}
          <Link href="/register" target="_blank">
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
