"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  BookOpen,
  Plus,
  Globe2,
  RefreshCw,
  ArrowRight,
  Check,
  Pencil,
  Trash2,
  X,
  Search,
  ExternalLink,
} from "lucide-react";
import type { KnowledgeEntryRecord, KnowledgeSourceRecord } from "@saha/shared";
import { api } from "../lib/api";
type EntryPage = {
  items: KnowledgeEntryRecord[];
  total: number;
  page: number;
  pages: number;
};
type SearchResult = {
  development: boolean;
  matches: {
    id: string;
    title: string;
    content: string;
    sourceUrl: string | null;
    score: number;
  }[];
};
const errorLabels: Record<string, string> = {
  ROBOTS_DISALLOWED: "This website does not allow crawling.",
  ROBOTS_UNAVAILABLE:
    "Could not read the website’s crawl rules. Try again later.",
  PRIVATE_DESTINATION: "This destination is not a public website.",
  OFF_DOMAIN_REDIRECT: "The website redirected to a different domain.",
  NO_TEXT_CONTENT: "No readable page text was found.",
  FETCH_TIMEOUT: "The website took too long to respond.",
  FETCH_FAILED: "Could not reach the website.",
  CRAWL_DELAY_TOO_LONG:
    "The website requests a longer crawl interval than this version supports.",
  PARTIAL_CRAWL: "Some pages could not be read.",
  PAGE_TOO_LARGE: "A page exceeded the size limit.",
  PROCESSING_FAILED: "The background task failed. Try again.",
  QUEUE_FAILED: "The background task exhausted its retries.",
};
export default function KnowledgePanel({
  tenantId,
  owner,
}: {
  tenantId: string;
  owner: boolean;
}) {
  const [data, setData] = useState<EntryPage>({
    items: [],
    total: 0,
    page: 1,
    pages: 1,
  });
  const [page, setPage] = useState(1);
  const [sources, setSources] = useState<KnowledgeSourceRecord[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<
    KnowledgeEntryRecord | null | undefined
  >(undefined);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [addingWebsite, setAddingWebsite] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeEntryRecord | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const path = `/tenants/${tenantId}/knowledge`;
  async function refresh() {
    const [entries, websites] = await Promise.all([
      api<EntryPage>(`${path}/entries?page=${page}`),
      api<KnowledgeSourceRecord[]>(`${path}/sources`),
    ]);
    setData(entries);
    setSources(websites);
  }
  useEffect(() => {
    if (!owner) return;
    let current = true;
    setLoading(true);
    async function fetchState() {
      try {
        const [entries, websites] = await Promise.all([
          api<EntryPage>(`${path}/entries?page=${page}`),
          api<KnowledgeSourceRecord[]>(`${path}/sources`),
        ]);
        if (current) {
          setData(entries);
          setSources(websites);
        }
      } catch (e) {
        if (current)
          setError(
            e instanceof Error ? e.message : "Could not load knowledge.",
          );
      } finally {
        if (current) setLoading(false);
      }
    }
    void fetchState();
    const interval = setInterval(() => void fetchState(), 5000);
    return () => {
      current = false;
      clearInterval(interval);
    };
  }, [path, page, owner]);
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
  function open(entry: KnowledgeEntryRecord | null) {
    setEditing(entry);
    setTitle(entry?.title ?? "");
    setContent(entry?.draftContent ?? "");
    setError("");
    setNotice("");
    setAddingWebsite(false);
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const approve =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "approve";
    void action(async () => {
      let entry = editing;
      if (!entry)
        entry = await api<KnowledgeEntryRecord>(`${path}/entries`, {
          title,
          content,
        });
      else if (!approve)
        entry = await api<KnowledgeEntryRecord>(
          `${path}/entries/${entry.id}/save`,
          { title, content, version: entry.version },
        );
      if (approve)
        await api(`${path}/entries/${entry.id}/approve`, {
          title,
          content,
          version: entry.version,
        });
      setEditing(undefined);
      setResults(null);
      await refresh();
      setNotice(
        approve
          ? "Entry approved. Its search index is being prepared."
          : "Draft saved. Approve it when it is ready for customer answers.",
      );
    });
  }
  if (!owner)
    return (
      <section className="card coming-card">
        <BookOpen />
        <h2>Your owner manages business knowledge.</h2>
        <p>Reviewed answers help the team give customers consistent support.</p>
      </section>
    );
  return (
    <section className="knowledge-panel">
      <div className="panel-toolbar">
        <div>
          <h2>Good answers start with your knowledge.</h2>
          <p>
            Bring in your website, review what we find, and add the details that
            make your business yours.
          </p>
        </div>
        <div className="toolbar-actions">
          <button
            className="button secondary"
            onClick={() => {
              setAddingWebsite(!addingWebsite);
              setEditing(undefined);
              setError("");
            }}
          >
            <Globe2 size={15} />
            Add website
          </button>
          <button className="button primary" onClick={() => open(null)}>
            <Plus size={16} />
            Add entry
          </button>
        </div>
      </div>
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
      {addingWebsite && (
        <section className="card knowledge-editor">
          <div className="section-title">
            <h3>Your website is a good place to start.</h3>
            <button
              className="icon-button"
              aria-label="Close website form"
              onClick={() => setAddingWebsite(false)}
            >
              <X size={17} />
            </button>
          </div>
          <p>
            We read public pages on the same hostname and follow the site’s
            crawl rules. You review every entry before it becomes available for
            answers.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void action(async () => {
                await api(`${path}/sources`, {
                  url: String(form.get("url")),
                  pageLimit: Number(form.get("pageLimit")),
                  depthLimit: Number(form.get("depthLimit")),
                });
                setAddingWebsite(false);
                await refresh();
                setNotice(
                  "Website added. Your crawl is queued and its progress will appear below.",
                );
              });
            }}
          >
            <label>
              Website URL
              <input
                name="url"
                type="url"
                required
                placeholder="https://your-business.lk"
                maxLength={2000}
              />
            </label>
            <div className="form-grid">
              <label>
                Page limit
                <input
                  name="pageLimit"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={20}
                  required
                />
              </label>
              <label>
                Link depth
                <input
                  name="depthLimit"
                  type="number"
                  min={0}
                  max={3}
                  defaultValue={2}
                  required
                />
              </label>
            </div>
            <button className="button primary" disabled={busy}>
              Start crawl <ArrowRight size={15} />
            </button>
          </form>
        </section>
      )}
      {editing !== undefined && (
        <section className="card knowledge-editor">
          <div className="section-title">
            <h3>
              {editing
                ? "Review knowledge entry"
                : "What should customers know?"}
            </h3>
            <button
              className="icon-button"
              aria-label="Close knowledge editor"
              onClick={() => setEditing(undefined)}
            >
              <X size={17} />
            </button>
          </div>
          {editing?.sourceUrl && (
            <a
              className="source-link"
              href={editing.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              View source page <ExternalLink size={13} />
            </a>
          )}
          <form onSubmit={save}>
            <label>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="e.g. Delivery and returns"
              />
            </label>
            <label>
              Answer or business information
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
                maxLength={20000}
                rows={9}
                placeholder="Add clear, factual information your customers can rely on."
              />
            </label>
            <p className="form-hint">
              Website text is untrusted source material. Check its accuracy and
              remove instructions that do not describe your business.
            </p>
            {editing?.approvedContent &&
              editing.approvedContent !== content && (
                <details className="approved-details">
                  <summary>Currently approved answer</summary>
                  <p>{editing.approvedContent}</p>
                </details>
              )}
            <div className="toolbar-actions">
              <button
                className="button secondary"
                value="draft"
                disabled={busy}
              >
                Save draft
              </button>
              <button
                className="button primary"
                value="approve"
                disabled={busy}
              >
                Approve for answers <Check size={15} />
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="knowledge-layout">
        <div className="knowledge-main">
          <section className="card knowledge-list">
            <div className="list-header">
              <strong>
                {data.total} knowledge entr{data.total === 1 ? "y" : "ies"}
              </strong>
              <button
                className="text-button"
                onClick={() => void action(refresh)}
                disabled={busy}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            {loading ? (
              <div className="empty-state" role="status">
                Loading your knowledge…
              </div>
            ) : data.items.length === 0 ? (
              <div className="empty-state">
                <div className="next-icon">
                  <BookOpen size={25} />
                </div>
                <h3>Your business has a story to tell.</h3>
                <p>Add a website or write your first answer.</p>
                <button className="button secondary" onClick={() => open(null)}>
                  Add your first entry <Plus size={15} />
                </button>
              </div>
            ) : (
              <div className="entry-list">
                {data.items.map((entry) => (
                  <article className="knowledge-row" key={entry.id}>
                    <div className="entry-heading">
                      <h3>{entry.title}</h3>
                      <span
                        className={`pill ${entry.reviewStatus === "APPROVED" ? "" : "muted"}`}
                      >
                        {entry.reviewStatus === "CHANGES_PENDING"
                          ? "Changes to review"
                          : entry.reviewStatus === "APPROVED"
                            ? "Approved"
                            : "Draft"}
                      </span>
                    </div>
                    <p>
                      {entry.draftContent.slice(0, 170)}
                      {entry.draftContent.length > 170 ? "…" : ""}
                    </p>
                    <div className="entry-footer">
                      <span>
                        {entry.sourceUrl ? "Website" : "Manual entry"}
                        {entry.approvedContent && (
                          <span
                            className={`index-state ${entry.embeddingStatus === "READY" ? "ready" : ""}`}
                          >
                            {" "}
                            ·{" "}
                            {entry.embeddingStatus === "READY"
                              ? "Indexed"
                              : entry.embeddingStatus === "FAILED"
                                ? "Index failed · approve again"
                                : entry.embeddingStatus === "PENDING"
                                  ? "Index queued"
                                  : "Not indexed"}
                          </span>
                        )}
                      </span>
                      <div className="row-actions">
                        <button
                          className="text-button"
                          onClick={() => open(entry)}
                        >
                          <Pencil size={13} />
                          {entry.reviewStatus === "APPROVED"
                            ? "Edit"
                            : "Review"}
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`Delete ${entry.title}`}
                          onClick={() => setDeleting(entry)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="pagination">
              <span>
                Page {data.page} of {data.pages}
              </span>
              <div>
                <button
                  className="button small secondary"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  className="button small secondary"
                  disabled={page >= data.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
          <section className="card knowledge-search">
            <div className="section-title">
              <h3>Check your approved knowledge</h3>
              <span className="pill">Development index</span>
            </div>
            <p>
              Try a customer question. This local test index checks the
              retrieval workflow; a production semantic model will be selected
              before launch.
            </p>
            <form
              className="search-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  setResults(
                    await api<SearchResult>(`${path}/search`, {
                      query,
                      limit: 5,
                    }),
                  );
                });
              }}
            >
              <Search size={16} />
              <input
                aria-label="Test knowledge search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. How does delivery work?"
                minLength={2}
                maxLength={1000}
                required
              />
              <button className="button small secondary" disabled={busy}>
                Search
              </button>
            </form>
            {results && (
              <div className="search-results">
                {results.matches.length ? (
                  results.matches.map((match) => (
                    <article key={match.id}>
                      <strong>{match.title}</strong>
                      <p>{match.content}</p>
                      {match.sourceUrl && (
                        <a
                          href={match.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="source-link"
                        >
                          Source <ExternalLink size={12} />
                        </a>
                      )}
                    </article>
                  ))
                ) : (
                  <p>
                    No indexed approved entries yet. Approve an entry and wait
                    for its index to finish.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
        <aside className="knowledge-aside">
          <section className="card website-sources">
            <div className="section-title">
              <h3>Your websites</h3>
              <Globe2 size={17} />
            </div>
            {sources.length === 0 ? (
              <p>
                Connect your website to turn its public pages into drafts you
                can review.
              </p>
            ) : (
              sources.map((source) => {
                const run = source.runs[0];
                const running =
                  run && ["QUEUED", "RUNNING"].includes(run.status);
                return (
                  <article className="website-source" key={source.id}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {new URL(source.url).hostname}
                      <ExternalLink size={12} />
                    </a>
                    <small>{new URL(source.url).pathname}</small>
                    <span
                      className={`pill ${run?.status === "COMPLETED" ? "" : "muted"}`}
                    >
                      {run?.status === "RUNNING"
                        ? "Crawling…"
                        : run?.status === "QUEUED"
                          ? "Queued"
                          : run?.status === "COMPLETED"
                            ? "Crawl complete"
                            : run?.status === "FAILED"
                              ? "Crawl failed"
                              : "Ready"}
                    </span>
                    {run && (
                      <p>
                        {run.pageCount} pages read
                        {run.skippedCount
                          ? ` · ${run.skippedCount} skipped`
                          : ""}
                      </p>
                    )}
                    {run?.errorCode && (
                      <p className="crawl-error">
                        {errorLabels[run.errorCode] ??
                          "The crawl could not be completed."}
                      </p>
                    )}
                    <small>
                      Up to {source.pageLimit} pages · depth {source.depthLimit}
                    </small>
                    <button
                      className="text-button"
                      disabled={busy || Boolean(running)}
                      onClick={() =>
                        void action(async () => {
                          await api(`${path}/sources/${source.id}/recrawl`, {});
                          await refresh();
                          setNotice(
                            "Re-crawl queued. Approved answers remain available while you review changes.",
                          );
                        })
                      }
                    >
                      <RefreshCw size={13} />
                      {running ? "Crawl in progress" : "Re-crawl website"}
                    </button>
                  </article>
                );
              })
            )}
          </section>
          <section className="review-note">
            <BookOpen size={22} />
            <h3>You have the final word.</h3>
            <p>
              Only approved, indexed entries are available for retrieval.
              Website changes arrive as drafts, leaving your reviewed answers in
              place.
            </p>
          </section>
        </aside>
      </div>
      {deleting && (
        <div className="modal-backdrop">
          <section
            className="card confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-entry-title"
          >
            <h2 id="delete-entry-title">Remove this knowledge entry?</h2>
            <p>“{deleting.title}” and its search index will be removed.</p>
            <div className="toolbar-actions">
              <button
                className="button secondary"
                onClick={() => setDeleting(null)}
              >
                Keep entry
              </button>
              <button
                className="button danger-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`${path}/entries/${deleting.id}/delete`, {});
                    setDeleting(null);
                    setResults(null);
                    await refresh();
                    setNotice("Knowledge entry removed.");
                  })
                }
              >
                Remove entry
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
