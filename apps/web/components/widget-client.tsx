"use client";
import { useEffect, useState } from "react";
import type { ChatSession } from "@saha/shared";
import Chat, { widgetRequest } from "./chat";
export default function WidgetClient({ publicId }: { publicId: string }) {
  const [session, setSession] = useState<ChatSession | null>(null),
    [origin, setOrigin] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let started = false,
      current = true;
    const receive = (event: MessageEvent) => {
      if (
        started ||
        event.source !== window.parent ||
        event.data?.type !== "saha:init" ||
        event.data?.publicId !== publicId ||
        window.parent === window
      )
        return;
      started = true;
      setOrigin(event.origin);
      widgetRequest<ChatSession>(
        `${publicId}/session`,
        event.origin,
        undefined,
        {},
      )
        .then((s) => {
          if (current) setSession(s);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "saha:ready", publicId }, "*");
    return () => {
      current = false;
      window.removeEventListener("message", receive);
    };
  }, [publicId]);
  return (
    <main className="widget-page">
      {session ? (
        <Chat session={session} origin={origin} />
      ) : (
        <div className="widget-wait" role="status">
          <span className="brand">saha.</span>
          <p>{error || "Opening your customer chat…"}</p>
        </div>
      )}
    </main>
  );
}
