import { notFound } from 'next/navigation';
import { getDefaultMermaidText, isValidSessionId } from '../../../lib/session';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isValidSessionId(id)) {
    notFound();
  }

  return (
    <main style={{ minHeight: '100vh', padding: '2rem', background: '#020617' }}>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div>
            <p style={{ margin: 0, color: '#93c5fd', fontWeight: 700 }}>Session</p>
            <h1 style={{ margin: '0.25rem 0 0', fontSize: '2rem' }}>{id}</h1>
          </div>
          <span style={{ padding: '0.35rem 0.65rem', borderRadius: 999, background: '#1e293b', color: '#fbbf24' }}>
            Scaffold only
          </span>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: '1rem' }}>
          <article style={{ border: '1px solid #1f2937', borderRadius: 16, padding: '1rem', background: '#0f172a' }}>
            <h2 style={{ marginTop: 0 }}>Editor placeholder</h2>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, color: '#cbd5e1' }}>{getDefaultMermaidText()}</pre>
          </article>
          <article style={{ border: '1px solid #1f2937', borderRadius: 16, padding: '1rem', background: '#0f172a' }}>
            <h2 style={{ marginTop: 0 }}>Preview placeholder</h2>
            <p style={{ color: '#cbd5e1' }}>
              Mermaid rendering, Yjs sync, activity feed, and presence UI land in later phases.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
