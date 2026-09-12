import { useEffect, useState } from "react";
import "../components/ui.css";
import {
  lerPlanilhaVendas, importarPlanilhaVendas, listarImportacoes,
  listarResumoDiario, listarResumoClientes,
} from "../lib/vendas";
import { formatCurrency, formatDate } from "../lib/constants";
import SeletorPeriodo from "../components/SeletorPeriodo";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

function mesAtras(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
}

export default function Vendas() {
  const [importacoes, setImportacoes] = useState([]);
  const [preview, setPreview] = useState(null); // { linhas, ignoradas, meses, nomeArquivo }
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState("");
  const [toast, setToast] = useState("");

  const [mesInicio, setMesInicio] = useState(mesAtras(2));
  const [mesFim, setMesFim] = useState(mesAtras(0));

  const [carregandoDados, setCarregandoDados] = useState(true);
  const [resumoDiario, setResumoDiario] = useState([]);
  const [resumoClientes, setResumoClientes] = useState([]);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function carregarImportacoes() {
    setImportacoes(await listarImportacoes());
  }

  async function carregarDashboard() {
    setCarregandoDados(true);
    const [dia, cli] = await Promise.all([
      listarResumoDiario(mesInicio, mesFim),
      listarResumoClientes(mesInicio, mesFim),
    ]);
    setResumoDiario(dia);
    setResumoClientes(cli);
    setCarregandoDados(false);
  }

  useEffect(() => { carregarImportacoes(); }, []);
  useEffect(() => { carregarDashboard(); }, [mesInicio, mesFim]);

  async function handleArquivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro("");
    setPreview(null);
    try {
      const { linhas, ignoradas, meses } = await lerPlanilhaVendas(file);
      if (linhas.length === 0) {
        setErro("Não encontrei nenhuma linha válida nessa planilha.");
        return;
      }
      setPreview({ linhas, ignoradas, meses, nomeArquivo: file.name });
    } catch (err) {
      setErro(err.message);
    } finally {
      e.target.value = "";
    }
  }

  async function confirmarImportacao() {
    if (!preview) return;
    setImportando(true);
    setProgresso({ feito: 0, total: preview.linhas.length });
    try {
      const resultado = await importarPlanilhaVendas(preview.linhas, preview.nomeArquivo, (feito, total) => setProgresso({ feito, total }));
      mostrarToast(`Importado! ${resultado.linhasProcessadas} linhas · ${formatCurrency(resultado.faturamentoTotal)} · meses: ${resultado.meses.join(", ")}`);
      setPreview(null);
      carregarImportacoes();
      carregarDashboard();
    } catch (err) {
      setErro("Erro ao importar: " + err.message);
    } finally {
      setImportando(false);
      setProgresso(null);
    }
  }

  const faturamentoTotal = resumoDiario.reduce((s, d) => s + d.faturamento, 0);
  const pedidosTotal = resumoDiario.reduce((s, d) => s + d.pedidos, 0);
  const ticketMedio = pedidosTotal > 0 ? faturamentoTotal / pedidosTotal : 0;
  const clientesAtivos = resumoClientes.length;

  const dadosGrafico = resumoDiario.map((d) => ({ data: formatDate(d.data).slice(0, 5), faturamento: d.faturamento }));

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card">
        <h2 className="card-title">Importar histórico de vendas</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
          Planilha com Data, Nº Pedido, Produto, Código, Cliente, Quantidade, Unidade, Valor Unitário e
          Valor Total. Pode importar aos poucos (por trimestre ou ano) — reimportar o mesmo período não duplica nada.
        </p>
        <input type="file" accept=".xls,.xlsx,.csv" onChange={handleArquivo} disabled={importando} />

        {erro && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{erro}</div>}

        {preview && (
          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              <strong>{preview.nomeArquivo}</strong>
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 4 }}>
              {preview.linhas.length} linhas válidas · meses: {preview.meses.join(", ")}
              {preview.ignoradas > 0 && ` · ${preview.ignoradas} linha(s) ignorada(s) (data ou valor inválido)`}
            </div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Faturamento nesse arquivo: <strong>{formatCurrency(preview.linhas.reduce((s, l) => s + l.valorTotal, 0))}</strong>
            </div>
            {importando ? (
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Importando... {progresso ? `${progresso.feito} / ${progresso.total}` : ""}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={confirmarImportacao}>Confirmar importação</button>
                <button className="btn btn-ghost" onClick={() => setPreview(null)}>Cancelar</button>
              </div>
            )}
          </div>
        )}

        {importacoes.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-soft)" }}>
              Ver importações já feitas ({importacoes.length})
            </summary>
            <div style={{ marginTop: 8 }}>
              {importacoes.map((imp) => (
                <div key={imp.id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  {imp.nomeArquivo} · {imp.linhasProcessadas} linhas · meses: {imp.meses?.join(", ")}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <SeletorPeriodo
        mesInicio={mesInicio} mesFim={mesFim}
        anoMinimo={importacoes.length ? Math.min(...importacoes.flatMap((i) => i.meses || []).map((m) => Number(m.slice(0, 4)))) : undefined}
        onChange={(inicio, fim) => { setMesInicio(inicio); setMesFim(fim); }}
      />

      {carregandoDados ? (
        <div className="empty-state">Carregando...</div>
      ) : resumoDiario.length === 0 ? (
        <div className="empty-state">Nenhuma venda importada nesse período ainda.</div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Faturamento no período</div>
              <strong style={{ fontSize: 22 }}>{formatCurrency(faturamentoTotal)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Pedidos</div>
              <strong style={{ fontSize: 22 }}>{pedidosTotal}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Ticket médio</div>
              <strong style={{ fontSize: 22 }}>{formatCurrency(ticketMedio)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Clientes ativos</div>
              <strong style={{ fontSize: 22 }}>{clientesAtivos}</strong>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title">Faturamento por dia</h2>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={dadosGrafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Line type="monotone" dataKey="faturamento" stroke="var(--pink)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h2 className="card-title">Ranking de clientes</h2>
            <div className="lista-grid">
              {resumoClientes.slice(0, 30).map((c, i) => (
                <div key={c.cliente} className="list-item">
                  <div>
                    <strong>{i + 1}. {c.cliente}</strong>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.pedidos} pedido{c.pedidos > 1 ? "s" : ""}</div>
                  </div>
                  <strong>{formatCurrency(c.faturamento)}</strong>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
