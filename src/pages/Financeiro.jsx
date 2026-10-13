import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, listarEventosRecebimento } from "../lib/pedidos";
import { formatCurrency, formatDate, labelFormaPagamento } from "../lib/constants";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
} from "recharts";

const CORES_PIZZA = ["var(--pink)", "var(--grape)", "var(--green)", "var(--yellow)", "#3b82f6", "#f97316", "#14b8a6", "var(--ink-soft)"];

function paraISO(d) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
const HOJE = new Date();
const INICIO_MES_ATUAL = new Date(HOJE.getFullYear(), HOJE.getMonth(), 1);

export default function Financeiro() {
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [dataInicio, setDataInicio] = useState(paraISO(INICIO_MES_ATUAL));
  const [dataFim, setDataFim] = useState(paraISO(HOJE));

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setPedidos(await listarPedidos());
      setCarregando(false);
    })();
  }, []);

  const eventosTodos = listarEventosRecebimento(pedidos);

  function aplicarAtalho(inicio, fim) {
    setDataInicio(paraISO(inicio));
    setDataFim(paraISO(fim));
  }
  function esteMes() {
    aplicarAtalho(new Date(HOJE.getFullYear(), HOJE.getMonth(), 1), HOJE);
  }
  function mesPassado() {
    const ref = new Date(HOJE.getFullYear(), HOJE.getMonth() - 1, 1);
    aplicarAtalho(ref, new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  }
  function ultimos30Dias() {
    const ini = new Date(HOJE);
    ini.setDate(ini.getDate() - 30);
    aplicarAtalho(ini, HOJE);
  }
  function esteAno() {
    aplicarAtalho(new Date(HOJE.getFullYear(), 0, 1), HOJE);
  }
  function anoPassado() {
    aplicarAtalho(new Date(HOJE.getFullYear() - 1, 0, 1), new Date(HOJE.getFullYear() - 1, 11, 31));
  }
  function todoPeriodo() {
    const datas = eventosTodos.map((e) => e.data).filter(Boolean).sort();
    const primeira = datas.length ? new Date(datas[0] + "T00:00:00") : HOJE;
    aplicarAtalho(primeira, HOJE);
  }

  const eventosPeriodo = eventosTodos.filter((e) => e.data && e.data >= dataInicio && e.data <= dataFim);
  const totalRecebido = eventosPeriodo.reduce((s, e) => s + e.valor, 0);

  const porFormaMap = new Map();
  eventosPeriodo.forEach((e) => {
    porFormaMap.set(e.tipo, (porFormaMap.get(e.tipo) || 0) + e.valor);
  });
  const dadosPizza = Array.from(porFormaMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, valor]) => ({
      tipo,
      nome: labelFormaPagamento(tipo),
      valor,
      percentual: totalRecebido ? (valor / totalRecebido) * 100 : 0,
    }));

  return (
    <div>
      <div className="card">
        <h2 className="card-title">Período</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={esteMes}>Este mês</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={mesPassado}>Mês passado</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={ultimos30Dias}>Últimos 30 dias</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={esteAno}>Este ano</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={anoPassado}>Ano passado</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={todoPeriodo}>Todo o período</button>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label>De</label>
            <input className="input" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div className="field">
            <label>Até</label>
            <input className="input" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>
      </div>

      {carregando ? (
        <div className="empty-state">Carregando...</div>
      ) : eventosPeriodo.length === 0 ? (
        <div className="empty-state">Nenhum recebimento nesse período.</div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Total recebido no período</div>
              <strong style={{ fontSize: 26, color: "var(--green)" }}>{formatCurrency(totalRecebido)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Quantidade de recebimentos</div>
              <strong style={{ fontSize: 22 }}>{eventosPeriodo.length}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Período</div>
              <strong style={{ fontSize: 15 }}>{formatDate(dataInicio)} a {formatDate(dataFim)}</strong>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title">Percentual por forma de pagamento</h2>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ width: "100%", maxWidth: 380, height: 280, flexShrink: 0 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={dadosPizza} dataKey="valor" nameKey="nome" cx="50%" cy="50%" outerRadius={100}
                      label={({ percentual }) => `${percentual.toFixed(0)}%`} labelLine={false}>
                      {dadosPizza.map((_, i) => <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, _n, item) => [`${formatCurrency(v)} (${item.payload.percentual.toFixed(1)}%)`, item.payload.nome]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                {dadosPizza.map((d, i) => (
                  <div key={d.tipo} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 0", borderBottom: "1px solid var(--border)",
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                        background: CORES_PIZZA[i % CORES_PIZZA.length], display: "inline-block",
                      }} />
                      {d.nome}
                    </span>
                    <span style={{ fontSize: 13, textAlign: "right" }}>
                      <strong>{formatCurrency(d.valor)}</strong>{" "}
                      <span style={{ color: "var(--ink-soft)" }}>({d.percentual.toFixed(1)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
