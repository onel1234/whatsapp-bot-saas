"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
type Connection = {
  id: string;
  channel: string;
  providerAccountId: string;
  label: string;
  enabled: boolean;
  instagramLogin: string;
};
type Settings = {
  connections: Connection[];
  liveSendingEnabled: boolean;
  webhookConfigured: boolean;
};
type Delivery = {
  id: string;
  state: string;
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  connection: { label: string; channel: string };
};
export default function ChannelsPanel({
  tenantId,
  owner,
}: {
  tenantId: string;
  owner: boolean;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [channel, setChannel] = useState("WHATSAPP");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const [settings, deliveries] = await Promise.all([
      api<Settings>(`/tenants/${tenantId}/channels`),
      api<Delivery[]>(`/tenants/${tenantId}/channels/deliveries`),
    ]);
    setSettings(settings);
    setDeliveries(deliveries);
  }
  useEffect(() => {
    if (!owner) return;
    let current = true;
    Promise.all([
      api<Settings>(`/tenants/${tenantId}/channels`),
      api<Delivery[]>(`/tenants/${tenantId}/channels/deliveries`),
    ])
      .then(([s, d]) => {
        if (current) {
          setSettings(s);
          setDeliveries(d);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [tenantId, owner]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void action(async () => {
      await api(`/tenants/${tenantId}/channels`, { ...data, channel });
      form.reset();
      setNotice(
        "Connection saved and paused. Enable it when your webhook is ready.",
      );
    });
  }
  if (!owner)
    return (
      <section className="card settings-card">
        <h2>Customer channels</h2>
        <p>Your workspace owner manages channel connections.</p>
      </section>
    );
  return (
    <div className="channel-stack">
      <section className="card settings-card">
        <span className="eyebrow">CUSTOMER CHANNELS</span>
        <h2>Meet customers where they message.</h2>
        <p>
          Connect your Meta accounts, then enable incoming messages when setup
          is complete.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="channel-summary">
          <span className="pill">
            {settings?.liveSendingEnabled
              ? "Sending enabled"
              : "Sending paused"}
          </span>
          <span className="pill">
            {settings?.webhookConfigured
              ? "Webhook configured"
              : "Webhook setup needed"}
          </span>
        </div>
        <p>
          Your server administrator must authorize the account ID for this
          workspace before you save it, configure the webhook, and enable
          sending. Saved details still need a test message to confirm the
          connection. Your unpublished Meta app can use its test accounts.
        </p>
        <form onSubmit={create} autoComplete="off">
          <div className="form-grid">
            <label>
              Channel
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="MESSENGER">Messenger</option>
                <option value="INSTAGRAM">Instagram</option>
              </select>
            </label>
            <label>
              Connection name
              <input
                name="label"
                required
                maxLength={80}
                placeholder="Customer support"
              />
            </label>
            <label>
              {channel === "WHATSAPP"
                ? "Phone-number ID"
                : channel === "MESSENGER"
                  ? "Facebook Page ID"
                  : "Instagram professional-account ID"}
              <input
                name="providerAccountId"
                autoComplete="off"
                required
                inputMode="numeric"
                pattern="[0-9]{1,40}"
                placeholder={
                  channel === "WHATSAPP"
                    ? "Phone-number ID from Meta"
                    : "Account ID from Meta"
                }
              />
            </label>
            <label>
              Access token
              <input
                name="accessToken"
                type="password"
                required
                minLength={10}
                maxLength={4096}
                autoComplete="new-password"
              />
            </label>
            {channel === "INSTAGRAM" && (
              <label>
                Instagram connection method
                <select name="instagramLogin">
                  <option value="INSTAGRAM">Instagram Login</option>
                  <option value="FACEBOOK">Facebook Login</option>
                </select>
              </label>
            )}
          </div>
          <p>Tokens are encrypted on the server and never shown again.</p>
          <button className="button primary" disabled={busy}>
            Save connection
          </button>
        </form>
      </section>
      <section className="card settings-card">
        <div className="channel-heading">
          <h2>Your connections</h2>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void action(load)}
          >
            Refresh
          </button>
        </div>
        {!settings && !error && <p role="status">Loading connections…</p>}
        {settings?.connections.length === 0 && (
          <p>No accounts connected yet.</p>
        )}
        {settings?.connections.map((c) => (
          <div key={c.id} className="channel-connection">
            <div>
              <strong>{c.label}</strong>
              <p>
                {c.channel.toLowerCase()} · {c.providerAccountId}
              </p>
              <span className="pill">
                {c.enabled ? "Receiving enabled" : "Paused"}
              </span>
            </div>
            <div className="channel-controls">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    api(`/tenants/${tenantId}/channels/${c.id}`, {
                      enabled: !c.enabled,
                    }),
                  )
                }
              >
                {c.enabled ? "Pause" : "Enable receiving"}
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const accessToken = new FormData(form).get("accessToken");
                  void action(async () => {
                    await api(`/tenants/${tenantId}/channels/${c.id}`, {
                      enabled: c.enabled,
                      accessToken,
                    });
                    form.reset();
                    setNotice("Access token replaced.");
                  });
                }}
              >
                <label>
                  Replace access token
                  <input
                    name="accessToken"
                    type="password"
                    required
                    minLength={10}
                    maxLength={4096}
                    autoComplete="new-password"
                  />
                </label>
                <button className="text-button" disabled={busy}>
                  Update token
                </button>
              </form>
            </div>
          </div>
        ))}
      </section>
      <section className="card settings-card">
        <h2>Recent deliveries</h2>
        <p>
          Messages with an unknown outcome need review before retrying. Replies
          outside the allowed window are held for the team.
        </p>
        {deliveries.length === 0 ? (
          <p>No outgoing channel messages yet.</p>
        ) : (
          <div className="channel-deliveries">
            {deliveries.map((d) => (
              <div key={d.id} className="channel-delivery">
                <strong>{d.connection.label}</strong>
                <span className="pill">{d.state.toLowerCase()}</span>
                <span>{d.attempts} attempts</span>
                {d.errorCode && (
                  <small>
                    {d.errorCode.replaceAll("_", " ").toLowerCase()}
                  </small>
                )}
                <time>{new Date(d.createdAt).toLocaleString()}</time>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
