import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell txt-page-shell">
      <section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel txt-page-hero">
          <div className="eyebrow">TXT</div>
          <h1 className="title" style={{ fontSize: 34 }}>Page introuvable</h1>
          <p className="subtle">Cette route n'existe pas ou n'est plus disponible.</p>
          <div className="txt-mini-guide operator-panel-guide compact" role="note" aria-label="Guide Navigation quick guidance">
            <div className="operator-panel-guide-copy">
              <div className="operator-panel-guide-head">
                <div className="txt-mini-guide-title">Guide Navigation</div>
              </div>
              <span className="txt-mini-guide-text">Revenir vite vers une page valide sans perdre le fil operateur.</span>
            </div>
          </div>
          <div className="txt-page-guide-note">
            <strong>Note operateur</strong>
            Si ce lien devait exister, traite-le comme un incident UX ou routing, pas comme une invitation a contourner le cockpit.
          </div>
          <p>
            <Link href="/dashboard">Retour au dashboard</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
