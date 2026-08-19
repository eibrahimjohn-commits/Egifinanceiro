import "./Layout.css";

const TABS = [
  { id: "pedidos", label: "Pedidos" },
  { id: "vales", label: "Vales e Recebidos" },
  { id: "pagamentos", label: "Pagamentos" },
  { id: "analises", label: "Análises" },
  { id: "base", label: "Base de Dados" },
];

export default function Layout({ active, onChange, wide, children }) {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">EGI <span className="brand-accent">Financeiro</span></span>
      </header>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={"tab" + (active === t.id ? " tab-active" : "")}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className={"content" + (wide ? " content-wide" : "")}>{children}</main>
    </div>
  );
}
