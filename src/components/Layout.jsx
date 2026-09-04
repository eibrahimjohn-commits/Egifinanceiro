import "./Layout.css";
import ConnectionBadge from "./ConnectionBadge";

const TABS = [
  { id: "pedidos", label: "Pedidos" },
  { id: "vales", label: "Vales e Recebidos" },
  { id: "pagamentos", label: "Pagamentos" },
  { id: "analises", label: "Análises" },
  { id: "base", label: "Base de Dados" },
  { id: "prospeccao", label: "Prospecção" },
];

export default function Layout({ active, onChange, wide, full, children }) {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">EGI <span className="brand-accent">Financeiro</span></span>
        <ConnectionBadge />
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
      <main className={"content" + (full ? " content-full" : wide ? " content-wide" : "")}>{children}</main>
    </div>
  );
}
