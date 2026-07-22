import DashboardPageContent from "../DashboardPageContent";
import Link from "next/link";

type DashboardPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchValue(params: Record<string, string | string[] | undefined>, key: string): string {
	const value = params[key];
	return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function FastDashboardPage() {
	return (
		<main className="shell txt-page-shell">
			<section className="hero txt-page-hero-grid" style={{ gridTemplateColumns: "1.15fr 0.85fr", gap: 14 }}>
				<div className="panel txt-page-hero">
					<div className="eyebrow">Dashboard</div>
					<h1 className="title" style={{ fontSize: 34, marginBottom: 8 }}>Cockpit rapide</h1>
					<p className="subtle" style={{ marginBottom: 12 }}>
						Vue stable et immediate pendant que les modules lourds restent consultables dans leurs routes dediees.
					</p>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						<Link href="/live-ops">Live Ops</Link>
						<Link href="/live-readiness">Readiness</Link>
						<Link href="/advanced/reality-gap">Execution Gap</Link>
						<Link href="/dashboard?full=1">Dashboard complet</Link>
					</div>
				</div>
				<div className="panel" style={{ display: "grid", gap: 10 }}>
					<div className="eyebrow">Etat de route</div>
					<div className="row"><span>Rendu</span><strong className="good">FAST</strong></div>
					<div className="row"><span>Route lourde</span><span>/dashboard?full=1</span></div>
					<div className="row"><span>Execution live</span><span>Lire Live Ops</span></div>
					<p className="subtle mini">Le dashboard rapide evite qu'un fetch control-plane lent transforme la route principale en 504.</p>
				</div>
			</section>

			<section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
				<article className="panel">
					<div className="eyebrow">Live Ops</div>
					<h2 style={{ margin: "4px 0 8px", fontSize: 22 }}>Approbations et verrous</h2>
					<p className="subtle">Lis le kill switch, le mode systeme, les demandes MT5 et les raisons de blocage.</p>
					<p><Link href="/live-ops">Ouvrir Live Ops</Link></p>
				</article>
				<article className="panel">
					<div className="eyebrow">Readiness</div>
					<h2 style={{ margin: "4px 0 8px", fontSize: 22 }}>Qualite donnees</h2>
					<p className="subtle">Controle freshness, bus marche, runtime decision, drift et collecte controlee.</p>
					<p><Link href="/live-readiness">Ouvrir Readiness</Link></p>
				</article>
				<article className="panel">
					<div className="eyebrow">Execution Gap</div>
					<h2 style={{ margin: "4px 0 8px", fontSize: 22 }}>Latence et ecart</h2>
					<p className="subtle">Compare predicted vs realized, latence, slippage, fill probability et replay.</p>
					<p><Link href="/advanced/reality-gap">Ouvrir Execution Gap</Link></p>
				</article>
			</section>
		</main>
	);
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
	const params = searchParams ? await searchParams : {};
	if (readSearchValue(params, "full") === "1") {
		return <DashboardPageContent />;
	}
	return <FastDashboardPage />;
}