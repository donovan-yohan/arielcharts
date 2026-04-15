import Link from 'next/link';
import { randomSessionId } from '../lib/session';

export default function LandingPage() {
  const sessionId = randomSessionId();

  return (
    <main style={{ padding: '3rem', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <p style={{ margin: 0, color: '#93c5fd', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          MermaidFlow
        </p>
        <h1 style={{ margin: 0, fontSize: '3rem' }}>Collaborative Mermaid diagrams for humans and agents</h1>
        <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.6 }}>
          Phase 1 scaffolds the app shell. Later phases add realtime Yjs sync, Mermaid rendering,
          activity feeds, presence, and MCP tools.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link
            href={`/s/${sessionId}`}
            style={{
              padding: '0.85rem 1.2rem',
              borderRadius: 12,
              background: '#2563eb',
              textDecoration: 'none',
              fontWeight: 700,
            }}
          >
            Start a session
          </Link>
          <code style={{ padding: '0.85rem 1.2rem', borderRadius: 12, background: '#111827', border: '1px solid #1f2937' }}>
            Suggested session: {sessionId}
          </code>
        </div>
      </div>
    </main>
  );
}
