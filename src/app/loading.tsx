/** Esqueleto instantáneo al cambiar de vista: sin esto, Next espera a que
 *  la página del servidor termine (todas sus consultas a Supabase) antes de
 *  mostrar nada, y el clic parece no responder. Con este archivo, además,
 *  Next puede prefetch las vistas dinámicas del menú. */
export default function Loading() {
  return (
    <div className="shell">
      <aside className="sidebar" aria-hidden="true">
        <div className="brand">Desempeño</div>
        <div className="loading-bar" style={{ height: 36 }} />
        <div className="loading-bar" style={{ height: 36 }} />
        <div className="loading-bar" style={{ height: 36 }} />
        <div className="loading-bar" style={{ height: 36 }} />
      </aside>
      <main className="main">
        <header className="page-head">
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div className="loading-bar" style={{ height: 36, marginBottom: 10 }} />
            <div className="loading-bar" style={{ height: 16, maxWidth: 320 }} />
          </div>
        </header>
        <section className="panel" style={{ marginTop: 28, padding: 26 }}>
          <div className="loading-bar" style={{ height: 22, maxWidth: 260, marginBottom: 18 }} />
          <div className="loading-bar" style={{ height: 14, marginBottom: 12 }} />
          <div className="loading-bar" style={{ height: 14, marginBottom: 12 }} />
          <div className="loading-bar" style={{ height: 14, maxWidth: '70%' }} />
        </section>
        <p className="muted" style={{ marginTop: 18 }}>Cargando…</p>
      </main>
    </div>
  )
}
