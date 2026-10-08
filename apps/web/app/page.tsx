import Link from "next/link";
import {
  ArrowUpRight,
  MessageCircle,
  Sparkles,
  Globe2,
  ShieldCheck,
} from "lucide-react";
export default function Home() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Link className="brand" href="/">
          <span className="brand-mark">s</span>saha
          <span className="brand-dot">.</span>
        </Link>
        <Link href="/login" className="button secondary">
          Sign in <ArrowUpRight size={16} />
        </Link>
      </nav>
      <section className="hero">
        <div>
          <span className="eyebrow">
            <span className="status-dot" /> MADE FOR LOCAL BUSINESS
          </span>
          <h1>
            A little closer
            <br />
            to every <em>customer.</em>
          </h1>
          <p>
            One home for your customer conversations.
            <br />
            Built for the languages your customers call their own.
          </p>
          <Link href="/register" className="button primary">
            Create your workspace <ArrowUpRight size={18} />
          </Link>
          <div className="language-line">
            English <span>·</span> සිංහල <span>·</span> தமிழ்
          </div>
        </div>
        <div
          className="hero-art"
          aria-label="Illustration of multilingual customer support"
        >
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-center">
            <MessageCircle size={70} strokeWidth={1.3} />
            <Sparkles className="art-spark" size={34} />
          </div>
          <div className="bubble bubble-one">
            Hello! 👋<small>Every conversation starts somewhere.</small>
          </div>
          <div className="bubble bubble-two">
            ආයුබෝවන් <span>✦</span>
          </div>
          <div className="bubble bubble-three">
            வணக்கம் <span>↗</span>
          </div>
          <span className="art-caption">LOCAL ROOTS. MORE POSSIBILITIES.</span>
        </div>
      </section>
      <section className="landing-features">
        <article>
          <MessageCircle />
          <h3>Your business, together</h3>
          <p>
            Create a workspace and invite the people behind your customer
            experience.
          </p>
        </article>
        <article>
          <Globe2 />
          <h3>Speak their language</h3>
          <p>
            A foundation for sales and support in English, Sinhala, Tamil, and
            beyond.
          </p>
        </article>
        <article>
          <ShieldCheck />
          <h3>A space of your own</h3>
          <p>
            Separate workspaces, clear team roles, and secure access from day
            one.
          </p>
        </article>
      </section>
      <footer className="landing-footer">
        saha / Built for the conversations that grow your business.
        <span>Early access · Phase 3</span>
      </footer>
    </main>
  );
}
