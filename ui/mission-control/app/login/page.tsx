export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  return (
    <main className="shell">
      <section className="hero" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel" style={{ maxWidth: 540, margin: "0 auto" }}>
          <div className="eyebrow">TXT</div>
          <h1 className="title" style={{ fontSize: 34 }}>Connexion securisee</h1>
          <p className="subtle">Authentification RBAC pour acceder au cockpit.</p>
          <div className="txt-auth-guide" aria-label="Guide connexion rapide">
            <strong>Guide rapide</strong>
            <p className="subtle">1) Connecte-toi avec ton compte operateur. 2) Verifie le mode (paper/live) dans Terminal avant toute action. 3) Si erreur, reviens ici puis verifie la rotation mot de passe.</p>
          </div>
          {searchParams?.error ? <p className="warn">Identifiants invalides ou redirection echouee.</p> : null}
          <form action="/api/auth/login" method="post" className="form-grid" style={{ marginTop: 16 }}>
            <label className="subtle" htmlFor="username">Username</label>
            <input id="username" name="username" defaultValue="admin" required />
            <label className="subtle" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" defaultValue="admin123" required />
            <button type="submit">Se connecter</button>
          </form>
        </div>
      </section>
    </main>
  );
}
