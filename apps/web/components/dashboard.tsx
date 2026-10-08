"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  LayoutDashboard,
  MessageSquare,
  ShoppingBag,
  Package,
  BookOpen,
  Radio,
  SlidersHorizontal,
  Users,
  ChartNoAxesCombined,
  ChevronDown,
  Check,
  Plus,
  LogOut,
  Sparkles,
  Globe2,
  HelpCircle,
  PanelLeftClose,
} from "lucide-react";
import type { Viewer, Workspace } from "@saha/shared";
import { plans } from "@saha/shared";
import { api, ApiError } from "../lib/api";
import CatalogPanel from "./catalog-panel";
import KnowledgePanel from "./knowledge-panel";
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Inbox", icon: MessageSquare, phase: 5 },
  { name: "Orders", icon: ShoppingBag, phase: 5 },
  { name: "Catalog", icon: Package },
  { name: "Knowledge", icon: BookOpen },
  { name: "Channels", icon: Radio, phase: 4 },
];
type Member = {
  id: string;
  role: string;
  user: { name: string; email: string };
};
export default function Dashboard() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [page, setPage] = useState("Overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState("");
  async function load() {
    try {
      const user = await api<Viewer>("/auth/me");
      setViewer(user);
      const saved = localStorage.getItem("saha_workspace");
      setWorkspace(
        user.tenants.find((t) => t.id === saved) ?? user.tenants[0] ?? null,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        window.location.assign("/login");
      else
        setError(
          "We couldn’t reach your workspace. Check that the API and database are running, then reload.",
        );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    let current = true;
    setMembers([]);
    setInvite("");
    if (workspace && page === "Team" && workspace.role === "OWNER")
      api<Member[]>(`/tenants/${workspace.id}/members`)
        .then((r) => {
          if (current) setMembers(r);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [workspace, page]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function select(id: string) {
    localStorage.setItem("saha_workspace", id);
    setWorkspace(viewer?.tenants.find((t) => t.id === id) ?? null);
    setPage("Overview");
    setError("");
    setNotice("");
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    void action(async () => {
      const tenant = await api<Workspace>("/tenants", { name });
      localStorage.setItem("saha_workspace", tenant.id);
      await load();
      setCreating(false);
    });
  }
  if (!viewer)
    return (
      <main className="center-page">
        <div className="card invite-card">
          <span className="brand">saha.</span>
          <p role="status">{error || "Opening your workspace…"}</p>
          {error && (
            <button className="button secondary" onClick={load}>
              Try again
            </button>
          )}
        </div>
      </main>
    );
  if (!workspace || creating)
    return (
      <main className="center-page">
        <div className="card invite-card">
          <span className="eyebrow">A NEW BEGINNING</span>
          <h1>Create a workspace.</h1>
          <p>Give your business a home for its customer conversations.</p>
          <form onSubmit={create}>
            <label>
              Business name
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                placeholder="Your business name"
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              Create workspace <ArrowRight size={16} />
            </button>
            {workspace && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            )}
          </form>
        </div>
      </main>
    );
  const owner = workspace.role === "OWNER";
  const plan = plans[workspace.plan];
  const later = [...nav, { name: "Bot settings", phase: 3 }].find(
    (n) => n.name === page && n.phase,
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">s</span>saha
          <span className="brand-dot">.</span>
          <PanelLeftClose className="sidebar-fold" size={17} />
        </a>
        <div className="workspace-picker">
          <span className="workspace-avatar">
            {workspace.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <select
              aria-label="Current workspace"
              value={workspace.id}
              onChange={(e) => select(e.target.value)}
            >
              {viewer.tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <small>{plan.label} workspace</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav className="side-nav">
          {nav.map((item) => (
            <button
              key={item.name}
              onClick={() => {
                setPage(item.name);
                setNotice("");
              }}
              className={page === item.name ? "active" : ""}
            >
              <item.icon size={18} />
              {item.name}
              {item.phase && (
                <span className="soon-dot" title={`Phase ${item.phase}`} />
              )}
            </button>
          ))}
        </nav>
        <span className="nav-label manage-label">MANAGE</span>
        <nav className="side-nav">
          {[
            { name: "Bot settings", icon: SlidersHorizontal },
            { name: "Team", icon: Users },
            { name: "Plan & usage", icon: ChartNoAxesCombined },
            { name: "Workspace settings", icon: SlidersHorizontal },
          ]
            .filter((i) => owner || i.name === "Bot settings")
            .map((item) => (
              <button
                key={item.name}
                className={page === item.name ? "active" : ""}
                onClick={() => {
                  setPage(item.name);
                  setNotice("");
                }}
              >
                <item.icon size={18} />
                {item.name}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="phase-note">
            <Sparkles size={19} />
            <strong>
              Small beginnings.
              <br />
              Big possibilities.
            </strong>
            <p>
              Your workspace is ready.
              <br />
              Let’s build what comes next.
            </p>
            <span>
              EARLY ACCESS <i>02 / 06</i>
            </span>
          </div>
          <button className="help-button" onClick={() => setPage("Help")}>
            <HelpCircle size={17} />
            Workspace guide
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">{viewer.name.charAt(0)}</span>
            <div>
              <strong>{viewer.name}</strong>
              <small>{owner ? "Workspace owner" : "Team agent"}</small>
            </div>
            <button
              aria-label="Sign out"
              onClick={() =>
                void action(async () => {
                  await api("/auth/logout", {});
                  window.location.assign("/login");
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> <strong>{page}</strong>
          </span>
          <div>
            <span className="early-tag">
              <span className="status-dot" /> Early access
            </span>
            <button
              className="button small secondary"
              onClick={() => setCreating(true)}
            >
              <Plus size={15} />
              New workspace
            </button>
          </div>
        </header>
        <div className="mobile-workspace">
          <label htmlFor="mobile-workspace">Workspace</label>
          <select
            id="mobile-workspace"
            value={workspace.id}
            onChange={(e) => select(e.target.value)}
          >
            {viewer.tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </div>
        <main className="dashboard-content">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                YOUR BUSINESS, A LITTLE MORE CONNECTED
              </span>
              <h1>
                {page === "Overview"
                  ? `Welcome, ${viewer.name.split(" ")[0]}.`
                  : page}
              </h1>
              <p>
                {page === "Overview"
                  ? "Good conversations start with a strong foundation. Here’s yours."
                  : workspace.name}
              </p>
            </div>
            <span className="workspace-badge">
              <span className="status-dot" />
              {owner ? "Owner" : "Agent"} workspace
            </span>
          </div>
          {page === "Overview" && (
            <>
              <section className="welcome-banner">
                <div>
                  <span className="banner-kicker">HELLO, POSSIBILITIES</span>
                  <h2>
                    Local business.
                    <br />
                    <em>Limitless conversations.</em>
                  </h2>
                  <p>
                    Your workspace is set. Bring your team together
                    <br />
                    and get ready to meet your customers where they are.
                  </p>
                  <button
                    className="button dark"
                    onClick={() => setPage(owner ? "Team" : "Help")}
                  >
                    {owner ? "Invite your team" : "Explore the workspace"}
                    <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="banner-ring" />
                  <div className="mini-chat first">
                    Hello! <span>✦</span>
                  </div>
                  <div className="mini-chat second">
                    ආයුබෝවන් <span>↗</span>
                  </div>
                  <div className="mini-chat third">
                    வணக்கம் <span>♡</span>
                  </div>
                  <span className="art-plus">✳</span>
                  <span className="art-label">
                    A WORLD OF WORDS. ONE WORKSPACE.
                  </span>
                </div>
              </section>
              <section className="stats-grid">
                <article className="stat-card">
                  <span className="stat-title">
                    Your plan <ChartNoAxesCombined size={17} />
                  </span>
                  <strong>
                    {plan.label}
                    <span className="pill">Development</span>
                  </strong>
                  <small>Room to grow, at your pace</small>
                </article>
                <article className="stat-card">
                  <span className="stat-title">
                    Team access <Users size={17} />
                  </span>
                  <strong>
                    {owner ? "Owner" : "Agent"}
                    <span className="tiny-check">
                      <Check size={14} />
                    </span>
                  </strong>
                  <small>Secure, role-based workspace</small>
                </article>
                <article className="stat-card">
                  <span className="stat-title">
                    Customer languages <Globe2 size={17} />
                  </span>
                  <strong>
                    3 <span className="stat-muted">+ romanized</span>
                  </strong>
                  <small>Planned for the conversation engine</small>
                </article>
              </section>
              <section className="overview-bottom">
                <div className="card setup-card">
                  <div className="section-title">
                    <h3>A good place to start</h3>
                    <span>01 / 03</span>
                  </div>
                  <p>A few steps toward your first customer conversation.</p>
                  <div className="setup-row">
                    <span className="step done">
                      <Check size={16} />
                    </span>
                    <div>
                      <strong>Create your workspace</strong>
                      <small>{workspace.name} is ready to go.</small>
                    </div>
                    <span className="complete-text">Complete</span>
                  </div>
                  <button
                    className="setup-row"
                    onClick={() => setPage(owner ? "Team" : "Help")}
                  >
                    <span className="step">02</span>
                    <div>
                      <strong>Bring your people together</strong>
                      <small>Invite a teammate to share the journey.</small>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                  <button
                    className="setup-row"
                    onClick={() => setPage("Knowledge")}
                  >
                    <span className="step">03</span>
                    <div>
                      <strong>Make it your business</strong>
                      <small>Add your website and product knowledge.</small>
                    </div>
                    <span className="pill">Get started</span>
                  </button>
                </div>
                <div className="card next-card">
                  <span className="eyebrow">ON THE HORIZON</span>
                  <div className="next-icon">
                    <BookOpen size={25} />
                    <span>✦</span>
                  </div>
                  <h3>
                    Your next hello.
                    <br />A little more connected.
                  </h3>
                  <p>
                    Your catalog and knowledge are ready. Next comes the
                    conversation engine and your website chat widget.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setPage("Bot settings")}
                  >
                    Explore what’s next <ArrowRight size={15} />
                  </button>
                </div>
              </section>
              <div className="workspace-footer">
                <span>
                  <span className="status-dot" /> Catalog & knowledge ready
                </span>
                <span>Made for the way you do business.</span>
              </div>
            </>
          )}
          {page === "Catalog" && (
            <CatalogPanel
              key={workspace.id}
              tenantId={workspace.id}
              owner={owner}
            />
          )}
          {page === "Knowledge" && (
            <KnowledgePanel
              key={workspace.id}
              tenantId={workspace.id}
              owner={owner}
            />
          )}
          {page === "Team" && owner && (
            <section className="card settings-card">
              <h2>The people behind your business.</h2>
              <p>
                Invite a teammate with a private link. Invitations expire in 48
                hours and only work for the specified email.
              </p>
              <div className="member-list">
                {members.map((m) => (
                  <div className="member" key={m.id}>
                    <span className="profile-avatar">
                      {m.user.name.charAt(0)}
                    </span>
                    <div>
                      <strong>{m.user.name}</strong>
                      <small>{m.user.email}</small>
                    </div>
                    <span className="pill">{m.role.toLowerCase()}</span>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  void action(async () => {
                    const r = await api<{ url: string }>(
                      `/tenants/${workspace.id}/invitations`,
                      data,
                    );
                    setInvite(r.url);
                    setNotice(
                      "Invitation created. Share this link privately with your teammate.",
                    );
                  });
                }}
              >
                <div className="form-grid">
                  <label>
                    Email address
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="teammate@business.lk"
                    />
                  </label>
                  <label>
                    Role
                    <select name="role">
                      <option value="AGENT">Agent</option>
                      <option value="OWNER">Owner</option>
                    </select>
                  </label>
                </div>
                <p className="form-hint">
                  Agents will handle conversations and orders. Owners also
                  manage settings, team access, and plans.
                </p>
                <button className="button primary" disabled={busy}>
                  <Plus size={16} />
                  Create invitation
                </button>
              </form>
              {invite && (
                <label className="invite-result">
                  Private invitation link
                  <input
                    value={invite}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
            </section>
          )}
          {page === "Workspace settings" && owner && (
            <section className="card settings-card">
              <h2>A name that feels like you.</h2>
              <p>Your business name appears throughout your workspace.</p>
              <form
                key={workspace.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get("name");
                  void action(async () => {
                    await api(`/tenants/${workspace.id}/settings`, { name });
                    await load();
                    setNotice("Workspace name updated.");
                  });
                }}
              >
                <label>
                  Business name
                  <input
                    name="name"
                    defaultValue={workspace.name}
                    required
                    minLength={2}
                    maxLength={100}
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  Save changes <Check size={16} />
                </button>
              </form>
            </section>
          )}
          {page === "Plan & usage" && owner && (
            <section className="card settings-card">
              <span className="eyebrow">YOUR CURRENT PLAN</span>
              <h2>{plan.label}</h2>
              <p>
                Development configuration · Commercial limits are awaiting
                approval.
              </p>
              <div className="plan-grid">
                {Object.entries(plans).map(([key, p]) => (
                  <article
                    key={key}
                    className={workspace.plan === key ? "selected-plan" : ""}
                  >
                    <h3>{p.label}</h3>
                    <strong>{p.conversations.toLocaleString()}</strong>
                    <p>provisional conversations / period</p>
                    <small>
                      {p.channels.length} planned channel
                      {p.channels.length > 1 ? "s" : ""}
                    </small>
                    {workspace.plan === key && (
                      <span className="pill">Current workspace</span>
                    )}
                  </article>
                ))}
              </div>
              <p className="info-note">
                Usage metering arrives in Phase 6. Upgrades and billing are not
                enabled.
              </p>
            </section>
          )}
          {later && (
            <section className="card coming-card">
              <div className="next-icon">
                <Sparkles size={28} />
              </div>
              <span className="eyebrow">COMING IN PHASE {later.phase}</span>
              <h2>
                {page === "Knowledge"
                  ? "Good answers start here."
                  : `${page}, built around your business.`}
              </h2>
              <p>
                {page === "Knowledge"
                  ? "Website crawling, reviewed knowledge entries, and your product catalog are next in the build plan."
                  : "This part of your workspace is on the build plan. Your account and team are ready while we build the next phase."}
              </p>
              <button
                className="button secondary"
                onClick={() => setPage("Overview")}
              >
                Back to overview <ArrowRight size={16} />
              </button>
            </section>
          )}
          {page === "Help" && (
            <section className="card settings-card">
              <h2>Your workspace guide</h2>
              <p>
                Use the workspace selector to switch businesses. Each workspace
                has its own team and access rules.
              </p>
              <p>
                Owners can update the business name, view plan configuration,
                and create invitations. Share invitation links privately;
                recipients must sign in with the matching email address.
              </p>
              <p>
                Catalog and knowledge are available now. Next comes the
                conversation engine, messaging channels, orders and payments,
                then metering. Each phase has a review checkpoint.
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
