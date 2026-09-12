import { useEffect, useState } from "react";
import { formatCurrency } from "../lib/constants";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

function formatarMes(mes) {
  const [ano, m] = mes.split("-");
  return `${m}/${ano.slice(2)}`;
}

export default function ModalProduto({ produto, onFechar, buscarDetalhe }) {
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState(null);
  const [aba, setAba] = useState("historico"); // historico | ultimoAno

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    buscarDetalhe(produto.codigoProduto).then((d) => {
      if (!cancelado) { setDetalhe(d); setCarregando(false); }
    });
    return () => { cancelado = true; };
  }, [produto.codigoProduto, buscarDetalhe]);

  const dadosGrafico = detalhe?.porMes.map((m) => ({ ...m, label: formatarMes(m.mes) })) || [];
  const listaClientes = aba === "historico" ? detalhe?.clientesTodoPeriodo : detalhe?.clientesUltimoAno;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(43,33,64,0.5)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onFechar}>
      <div className="card" style={{ maxWidth: 700, width: "100%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
          <h2 className="card-title" style={{ marginBottom: 0 }}>{produto.produto || "(sem nome)"}</h2>
          <button className="btn btn-ghost" style={{ padding: "4px 10px" }} onClick={onFechar}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 14 }}>
          {produto.codigoProduto} {produto.categoria && `· ${produto.categoria}`}{produto.subcategoria && ` / ${produto.subcategoria}`}
        </div>

        {carregando ? (
          <div className="empty-state">Carregando histórico do produto...</div>
        ) : !detalhe || detalhe.qtdTotal === 0 ? (
          <div className="empty-state">Sem histórico encontrado pra esse produto.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Faturamento (todo o histórico)</div>
                <strong style={{ fontSize: 18 }}>{formatCurrency(detalhe.faturamentoTotal)}</strong>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Quantidade vendida</div>
                <strong style={{ fontSize: 18 }}>{detalhe.qtdTotal} un.</strong>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Clientes distintos</div>
                <strong style={{ fontSize: 18 }}>{detalhe.clientesDistintos}</strong>
              </div>
            </div>

            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Vendas mês a mês</h3>
            <div style={{ width: "100%", height: 200, marginBottom: 20 }}>
              <ResponsiveContainer>
                <BarChart data={dadosGrafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v, nome) => (nome === "faturamento" ? formatCurrency(v) : v)} />
                  <Bar dataKey="faturamento" fill="var(--pink)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Ranking de clientes</h3>
              <div style={{ display: "flex", gap: 6 }}>
                <button className={"btn " + (aba === "historico" ? "btn-primary" : "btn-ghost")} style={{ fontSize: 12, padding: "5px 10px" }}
                  onClick={() => setAba("historico")}>Todo o histórico</button>
                <button className={"btn " + (aba === "ultimoAno" ? "btn-primary" : "btn-ghost")} style={{ fontSize: 12, padding: "5px 10px" }}
                  onClick={() => setAba("ultimoAno")}>Últimos 12 meses</button>
              </div>
            </div>
            {listaClientes.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhuma compra nesse recorte.</div>
            ) : (
              <div className="lista-grid">
                {listaClientes.slice(0, 20).map((c, i) => (
                  <div key={c.cliente} className="list-item">
                    <div>
                      <strong>{i + 1}. {c.cliente || "(não identificado)"}</strong>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.qtd} un. · {c.pedidos} pedido{c.pedidos > 1 ? "s" : ""}</div>
                    </div>
                    <strong>{formatCurrency(c.faturamento)}</strong>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
