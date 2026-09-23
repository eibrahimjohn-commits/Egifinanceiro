import "./Layout.css";
import ConnectionBadge from "./ConnectionBadge";
import AtualizarApp from "./AtualizarApp";
import AvisoPagamentos from "./AvisoPagamentos";
import TarefasWidget from "./TarefasWidget";

const TABS = [
  { id: "pedidos", label: "Pedidos" },
  { id: "vales", label: "Vales e Recebidos" },
  { id: "pagamentos", label: "Pagamentos" },
  { id: "analises", label: "Análises" },
  { id: "base", label: "Base de Dados" },
  { id: "prospeccao", label: "Prospecção" },
  { id: "historico", label: "Histórico" },
  { id: "vendas", label: "Vendas" },
  { id: "produtos", label: "Produtos" },
];

export default function Layout({ active, onChange, wide, full, children }) {
  return (
    <div className="layout">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="brand">EGI <span className="brand-accent">Financeiro</span></span>
          <TarefasWidget />
        </div>
        <AvisoPagamentos onIr={() => onChange("pagamentos")} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AtualizarApp />
          <ConnectionBadge />
        </div>
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
