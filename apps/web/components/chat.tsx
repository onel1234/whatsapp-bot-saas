"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import type { ChatSession, ChatState } from "@saha/shared";
import { apiUrl } from "../lib/api";
export async function widgetRequest<T>(
  path: string,
  origin: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  const res = await fetch(`${apiUrl}/widget/${path}`, {
    method: data === undefined ? "GET" : "POST",
    credentials: "omit",
    headers: {
      "X-Widget-Origin": origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res
    .json()
    .catch(() => ({
      message:
        res.status === 429
          ? "Chat is busy. Please wait a moment and try again."
          : "Chat is temporarily unavailable. Please try again.",
    }));
  if (!res.ok) throw new Error(result.message ?? "Chat unavailable.");
  return result as T;
}
export default function Chat({
  session,
  origin,
}: {
  session: ChatSession;
  origin: string;
}) {
  const [state, setState] = useState<ChatState>({
      mode: "BOT",
      messages: [],
      pending: false,
    }),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false);
  const retry = useRef<{ clientMessageId: string; text: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const s = await widgetRequest<ChatState>(
          "session/messages",
          origin,
          session.token,
        );
        if (current) {
          setState(s);
          setConnectionError("");
          timer = setTimeout(() => void refresh(), s.pending ? 3000 : 15000);
        }
      } catch (e) {
        if (current) {
          setConnectionError(
            e instanceof Error ? e.message : "Connection unavailable.",
          );
          timer = setTimeout(() => void refresh(), 30000);
        }
      }
    };
    void refresh();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [session.token, origin, state.pending]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages.length]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy || state.pending) return;
    setBusy(true);
    setError("");
    const data =
      retry.current?.text === text.trim()
        ? retry.current
        : { clientMessageId: crypto.randomUUID(), text: text.trim() };
    retry.current = data;
    try {
      setState(
        await widgetRequest<ChatState>(
          "session/messages",
          origin,
          session.token,
          data,
        ),
      );
      setText("");
      retry.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  const money = (minor: number) =>
    `LKR ${new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
  return (
    <section className="chat-shell" aria-label="Customer chat">
      <header className="chat-header">
        <span className="brand-mark">s</span>
        <div>
          <strong>{session.businessName}</strong>
          <small>
            {state.mode === "HUMAN"
              ? "Waiting for the team"
              : "Product & business support"}
          </small>
        </div>
      </header>
      <div className="chat-transcript" role="log" aria-label="Conversation">
        <p className="chat-bubble bot">{session.greeting}</p>
        {state.messages.map((m) => (
          <div key={m.id} className={`chat-message ${m.sender.toLowerCase()}`}>
            <p className="chat-bubble">{m.body}</p>
            {m.cards?.map((card) => (
              <article className="chat-product" key={card.id}>
                <strong>{card.name}</strong>
                {card.variants.map((v) => (
                  <div key={v.sku}>
                    <span>
                      {v.sku}{" "}
                      {Object.entries(v.attributes)
                        .map(([k, val]) => `${k}: ${val}`)
                        .join(" · ")}
                    </span>
                    <b>{money(v.priceMinor)}</b>
                    <small>
                      {v.stock > 0 ? `${v.stock} in stock` : "Out of stock"}
                    </small>
                  </div>
                ))}
              </article>
            ))}
            {!!m.sources?.length && (
              <div className="chat-sources">
                Reviewed sources:{" "}
                {m.sources.map((s, i) =>
                  s.url ? (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    <span key={i}>{s.title}</span>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        {state.pending && (
          <p role="status" className="form-hint">
            Preparing a reply…
          </p>
        )}
        <div ref={bottom} />
      </div>
      {state.mode === "HUMAN" && (
        <p className="chat-mode-note">
          Your request is saved for the team. Dashboard replies arrive in Phase
          5.
        </p>
      )}
      {(error || connectionError) && (
        <p className="error" role="alert">
          {error || connectionError}
        </p>
      )}
      <form className="chat-composer" onSubmit={send}>
        <label className="sr-only" htmlFor="chat-text">
          Your message
        </label>
        <input
          id="chat-text"
          placeholder="Ask a question…"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy || state.pending}
        />
        <button
          className="button primary"
          disabled={!text.trim() || busy || state.pending}
        >
          Send
        </button>
      </form>
      <footer className="chat-footer">
        Saha · Development preview · No live AI provider
      </footer>
    </section>
  );
}
