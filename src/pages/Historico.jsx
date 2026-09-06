import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarLogs } from "../lib/auditoria";
import { formatCurrency, formatDate } from "../lib/constants";

const ROTULOS_TIPO = {
  edicao_item: { label: "Compra editada", cor: "var(--grape)" },
  exclusao_item: { label: "Compra excluída", cor: "var(--red)" },
  edicao_pagamento: { label: "Pagamento editado", cor: "var(--grape)" },
  exclusao_pagamento: { label: "Pagamento excluído", cor: "var(--red)" },
  edicao_data_pedido: { label: "Data do pedido editada", cor: "var(--grape)" },
};

function formatDataHora(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function Historico() {
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  useEffect(() => {
    listarLogs().then((lista) => {
      setLogs(lista);
      setCarregando(false);
    });
  }, []);

  const logsFiltrados = logs.filter((l) => {
    if (filtroTipo && l.tipo !== filtroTipo) return false;
    if (filtro && !(l.clienteNome || "").toLowerCase().includes(filtro.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <input className="input" style={{ flex: "2 1 220px" }} placeholder="Buscar por cliente..."
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <select className="input" style={{ flex: "1 1 200px" }} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            <option value="edicao_item">Compra editada</option>
            <option value="exclusao_item">Compra excluída</option>
            <option value="edicao_pagamento">Pagamento editado</option>
            <option value="exclusao_pagamento">Pagamento excluído</option>
            <option value="edicao_data_pedido">Data do pedido editada</option>
          </select>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 8 }}>
          {logsFiltrados.length} de {logs.length} alterações registradas
        </div>
      </div>

      {carregando ? (
        <div className="empty-state">Carregando histórico...</div>
      ) : logsFiltrados.length === 0 ? (
        <div className="empty-state">Nenhuma alteração encontrada.</div>
      ) : (
        <div className="lista-grid">
          {logsFiltrados.map((l) => {
            const rotulo = ROTULOS_TIPO[l.tipo] || { label: l.tipo, cor: "var(--ink-soft)" };
            return (
              <div key={l.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <strong>{l.clienteNome || "Cliente não identificado"}</strong>
                  <span className="badge" style={{ background: rotulo.cor, color: "white", flexShrink: 0 }}>{rotulo.label}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6 }}>{l.descricao}</div>
                {(l.valorAnterior !== null || l.valorNovo !== null) && (
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    {formatarValorLog(l.valorAnterior)} → <strong>{formatarValorLog(l.valorNovo)}</strong>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{formatDataHora(l.data)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Os valores de log tanto podem ser um número (valor em R$) quanto uma data
// (string "YYYY-MM-DD") — mostra do jeito certo pra cada caso.
function formatarValorLog(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatCurrency(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return String(v);
}
