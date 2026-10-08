"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  botConfigSchema,
  type BotConfigInput,
  type ChatSession,
  type Language,
} from "@saha/shared";
import { api } from "../lib/api";
import Chat from "./chat";
type Config = { publicId: string; settings: BotConfigInput };
type Notice = {
  id: string;
  reason: string;
  conversationId: string;
  createdAt: string;
};
const languages: Record<Language, string> = {
  en: "English",
  si: "Sinhala",
  ta: "Tamil",
  singlish: "Singlish",
  tanglish: "Tanglish",
};
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export default function BotPanel({
  tenantId,
  owner,
}: {
  tenantId: string;
  owner: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null),
    [session, setSession] = useState<ChatSession | null>(null),
    [notices, setNotices] = useState<Notice[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [webOrigin, setWebOrigin] = useState("");
  const path = `/tenants/${tenantId}/bot`;
  useEffect(() => {
    let current = true;
    setWebOrigin(window.location.origin);
    if (owner)
      api<Config>(path)
        .then((c) => {
          if (current) {
            setConfig(c);
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    const refresh = () =>
      api<Notice[]>(`${path}/notifications`)
        .then((n) => {
          if (current) setNotices(n);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [path, owner]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!config) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(e.currentTarget);
    try {
      const result = botConfigSchema.safeParse({
        ...config.settings,
        businessName: form.get("businessName"),
        greeting: form.get("greeting"),
        tone: form.get("tone"),
        rules: String(form.get("rules"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        handoffTriggers: String(form.get("triggers"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        allowedOrigins: String(form.get("origins"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        businessHours: days.flatMap((_, day) =>
          form.get(`day-${day}`) === "on"
            ? [
                {
                  day,
                  open: form.get(`open-${day}`),
                  close: form.get(`close-${day}`),
                },
              ]
            : [],
        ),
        widgetEnabled: form.get("enabled") === "on",
        enabledLanguages: form.getAll("languages"),
      });
      if (!result.success)
        throw new Error(
          result.error.issues[0]?.message ?? "Please check your bot settings.",
        );
      setConfig(await api<Config>(path, result.data));
      setNotice("Settings saved. Start a new preview to try the greeting.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please check your settings.");
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    setError("");
    try {
      setSession(await api<ChatSession>(`${path}/preview`, {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bot-layout">
      <div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        {owner && config ? (
          <section className="card settings-card">
            <span className="eyebrow">A VOICE FOR YOUR BUSINESS</span>
            <h2>Make every hello yours.</h2>
            <p>
              Choose how your assistant welcomes customers and when your team
              takes over.
            </p>
            <form key={config.publicId} onSubmit={save}>
              <label>
                Business name
                <input
                  name="businessName"
                  required
                  maxLength={100}
                  defaultValue={config.settings.businessName}
                />
              </label>
              <label>
                Tone
                <select name="tone" defaultValue={config.settings.tone}>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                </select>
              </label>
              <label>
                Greeting
                <textarea
                  name="greeting"
                  required
                  maxLength={500}
                  defaultValue={config.settings.greeting}
                />
              </label>
              <fieldset className="language-options">
                <legend>Customer languages</legend>
                {Object.entries(languages).map(([key, label]) => (
                  <label className="check-label" key={key}>
                    <input
                      type="checkbox"
                      name="languages"
                      value={key}
                      defaultChecked={config.settings.enabledLanguages.includes(
                        key as Language,
                      )}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label>
                Business rules · one per line
                <textarea
                  name="rules"
                  defaultValue={config.settings.rules.join("\n")}
                  placeholder="Never offer discounts"
                />
              </label>
              <label>
                Handoff phrases · one per line
                <textarea
                  name="triggers"
                  defaultValue={config.settings.handoffTriggers.join("\n")}
                  placeholder="Talk to the owner"
                />
              </label>
              <fieldset className="hours-options">
                <legend>Business hours · Asia/Colombo</legend>
                {days.map((name, day) => {
                  const h = config.settings.businessHours.find(
                    (h) => h.day === day,
                  );
                  return (
                    <div className="hours-row" key={day}>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          name={`day-${day}`}
                          defaultChecked={!!h}
                        />
                        {name}
                      </label>
                      <input
                        type="time"
                        name={`open-${day}`}
                        aria-label={`${name} opening time`}
                        defaultValue={h?.open ?? "09:00"}
                      />
                      <span>to</span>
                      <input
                        type="time"
                        name={`close-${day}`}
                        aria-label={`${name} closing time`}
                        defaultValue={h?.close ?? "17:00"}
                      />
                    </div>
                  );
                })}
              </fieldset>
              <p className="form-hint">
                Select the days your business opens. Leave all days unchecked if
                hours are not set.
              </p>
              <label>
                Website origins · one per line
                <textarea
                  name="origins"
                  defaultValue={config.settings.allowedOrigins.join("\n")}
                  placeholder="https://your-shop.lk"
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={config.settings.widgetEnabled}
                />
                Enable website chat
              </label>
              <button className="button primary" disabled={busy}>
                Save bot settings
              </button>
            </form>
            <div className="embed-block">
              <h3>Add chat to your website</h3>
              <p>
                Allow your website origin above, enable chat, then add this
                script to its page.
              </p>
              <code>{`<script src="${webOrigin}/widget.js" data-saha-id="${config.publicId}" defer></script>`}</code>
              <p>
                <a
                  href={`/widget-demo.html?id=${config.publicId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open website demo
                </a>{" "}
                · Allow {webOrigin} to test this page.
              </p>
            </div>
          </section>
        ) : !owner ? (
          <section className="card settings-card">
            <h2>Bot settings belong to the owner.</h2>
            <p>You can see customer handoff requests below.</p>
          </section>
        ) : (
          <p role="status">Loading your bot settings…</p>
        )}
        <section className="card settings-card">
          <h3>Requests for your team</h3>
          <p>
            Customer handoffs are saved here. The live inbox and replies arrive
            in Phase 5.
          </p>
          {notices.length ? (
            notices.map((n) => (
              <article className="handoff-notice" key={n.id}>
                <div>
                  <strong>{n.reason.replaceAll("_", " ")}</strong>
                  <small>
                    {new Date(n.createdAt).toLocaleString()} ·{" "}
                    {n.conversationId.slice(0, 8)}
                  </small>
                </div>
                <button
                  className="button small secondary"
                  onClick={async () => {
                    await api(`${path}/notifications/${n.id}/read`, {});
                    setNotices(notices.filter((x) => x.id !== n.id));
                  }}
                >
                  Mark read
                </button>
              </article>
            ))
          ) : (
            <p className="form-hint">No new requests.</p>
          )}
        </section>
      </div>
      {owner && (
        <aside className="bot-preview">
          <div className="preview-intro">
            <span className="eyebrow">TRY A CUSTOMER CONVERSATION</span>
            <h3>A little practice, before hello.</h3>
            <p>
              This local provider selects catalog tools and reviewed excerpts.
              It does not test live AI translation or answer quality.
            </p>
            <button
              className="button secondary"
              disabled={busy || !config}
              onClick={preview}
            >
              {session ? "Start new conversation" : "Start preview"}
            </button>
          </div>
          {session && (
            <Chat key={session.token} session={session} origin={webOrigin} />
          )}
        </aside>
      )}
    </div>
  );
}
