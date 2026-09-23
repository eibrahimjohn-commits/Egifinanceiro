import { useEffect, useState } from "react";
import "../components/ui.css";
import {
  lerPlanilhaVendas, importarPlanilhaVendas, listarImportacoes,
  listarResumoDiario, listarResumoClientes,
} from "../lib/vendas";
import { formatCurrency, formatDate, NOMES_MES } from "../lib/constants";
import SeletorPeriodo from "../components/SeletorPeriodo";
import { granularidadeParaPeriodo, agruparPorGranularidade } from "../lib/analytics";
import { chaveVendas, buscarGraficoSalvo, salvarGraficoSalvo, graficoEstaDesatualizado } from "../lib/graficosSalvos";
import GraficosSalvosLista from "../components/GraficosSalvosLista";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

function mesAtras(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
}

const CORES_COMPARACAO = ["var(--pink)", "var(--grape)", "var(--green)", "var(--yellow)", "#3b82f6", "#f97316"];
const CHAVE_ESTADO = "egi-financeiro-vendas-estado";
const MAX_SERIES = 6; // principal + até 5 comparações

function estadoPadrao() {
  return { mesInicio: mesAtras(2), mesFim: mesAtras(0), comparacoes: [] };
}

function carregarEstadoSalvo() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ESTADO));
    if (salvo?.mesInicio && salvo?.mesFim) return { comparacoes: [], ...salvo };
  } catch {
    // segue com o padrão se não der pra ler
  }
  return estadoPadrao();
}

// Desloca um período (mesmo comprimento) pra trás ou pra frente — usado nos
// botões "Período anterior/seguinte" de cada linha de comparação.
function deslocarPeriodo(mesInicio, mesFim, direcao) {
  const [aIni, mIni] = mesInicio.split("-").map(Number);
  const [aFim, mFim] = mesFim.split("-").map(Number);
  const nMeses = (aFim - aIni) * 12 + (mFim - mIni) + 1;
  const passo = direcao * nMeses;
  const novoIni = new Date(aIni, mIni - 1 + passo, 1);
  const novoFim = new Date(aFim, mFim - 1 + passo, 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { mesInicio: fmt(novoIni), mesFim: fmt(novoFim) };
}

const METRICAS = {
  faturamento: { sufixo: "_fat", rotulo: "Faturamento", formatar: formatCurrency, tickFormatter: (v) => `${(v / 1000).toFixed(0)}k` },
  pedidos: { sufixo: "_ped", rotulo: "Pedidos", formatar: (v) => String(Math.round(v || 0)), tickFormatter: (v) => Math.round(v) },
  ticketMedio: { sufixo: "_tm", rotulo: "Ticket médio", formatar: formatCurrency, tickFormatter: (v) => `${(v / 1000).toFixed(1)}k` },
};

function TooltipComparacao({ active, payload, formatar }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 12 }}>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          <strong>{p.payload[p.dataKey.replace(/_(fat|ped|tm)$/, "") + "_label"] || ""}</strong> — {(formatar || formatCurrency)(p.value || 0)}
        </div>
      ))}
    </div>
  );
}

export default function Vendas() {
  const [importacoes, setImportacoes] = useState([]);
  const [preview, setPreview] = useState(null);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState("");
  const [toast, setToast] = useState("");

  const estadoInicial = carregarEstadoSalvo();
  const [mesInicio, setMesInicio] = useState(estadoInicial.mesInicio);
  const [mesFim, setMesFim] = useState(estadoInicial.mesFim);
  const [comparacoes, setComparacoes] = useState(estadoInicial.comparacoes);

  const [aba, setAba] = useState("painel"); // painel | salvos | sazonalidade
  const [tipoGrafico, setTipoGrafico] = useState("linha"); // linha | barras
  const [metrica, setMetrica] = useState("faturamento"); // faturamento | pedidos | ticketMedio

  // --- Sazonalidade: mesmo mês comparado ano a ano -----------------------
  const [mesSazonalidade, setMesSazonalidade] = useState(new Date().getMonth() + 1);
  const [metricaSazonalidade, setMetricaSazonalidade] = useState("faturamento");
  const [carregandoSaz, setCarregandoSaz] = useState(false);
  const [dadosSaz, setDadosSaz] = useState(null); // null = ainda não gerado

  const mesesImportadosSet = new Set(importacoes.flatMap((i) => i.meses || []));
  const anosComEsseMes = Array.from(new Set(Array.from(mesesImportadosSet)
    .filter((m) => Number(m.slice(5, 7)) === mesSazonalidade)
    .map((m) => m.slice(0, 4)))).sort();

  async function carregarSazonalidade() {
    setCarregandoSaz(true);
    const mesPad = String(mesSazonalidade).padStart(2, "0");
    const porAno = await Promise.all(anosComEsseMes.map(async (ano) => {
      const chave = `${ano}-${mesPad}`;
      const dias = await listarResumoDiario(chave, chave);
      const faturamento = dias.reduce((s, d) => s + d.faturamento, 0);
      const pedidos = dias.reduce((s, d) => s + d.pedidos, 0);
      return { ano, faturamento, pedidos, ticketMedio: pedidos ? faturamento / pedidos : 0 };
    }));
    setDadosSaz(porAno);
    setCarregandoSaz(false);
  }
  const [carregandoDados, setCarregandoDados] = useState(false);
  const [graficoGerado, setGraficoGerado] = useState(false);
  const [resumoClientes, setResumoClientes] = useState([]);
  const [seriesGrafico, setSeriesGrafico] = useState([]); // [{mesInicio, mesFim, cor, dados: [...]}]
  const [kpis, setKpis] = useState({ faturamento: 0, pedidos: 0 });

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function carregarImportacoes() {
    setImportacoes(await listarImportacoes());
  }

  async function carregarDashboard() {
    setCarregandoDados(true);
    setGraficoGerado(true);
    const granularidade = granularidadeParaPeriodo(mesInicio, mesFim);
    const periodos = [{ mesInicio, mesFim, cor: CORES_COMPARACAO[0], principal: true }, ...comparacoes];
    const chave = chaveVendas(mesInicio, mesFim, comparacoes);

    // Já geramos esse gráfico exato antes E nenhuma importação nova tocou
    // nesse período desde então? Usa o que já foi calculado em vez de reler
    // e re-somar tudo de novo — é só 1 leitura de documento + a lista de
    // importações (que já é leve).
    const [salvo, importacoesAtuais] = await Promise.all([buscarGraficoSalvo(chave), listarImportacoes()]);
    if (salvo && !graficoEstaDesatualizado(salvo, importacoesAtuais)) {
      setSeriesGrafico(periodos.map((p, i) => ({ ...p, dados: salvo.series[i]?.dados || [] })));
      setResumoClientes(salvo.resumoClientes);
      setKpis(salvo.kpis);
      setCarregandoDados(false);
      return;
    }

    const [resultadosDiarios, cli] = await Promise.all([
      Promise.all(periodos.map((p) => listarResumoDiario(p.mesInicio, p.mesFim))),
      listarResumoClientes(mesInicio, mesFim),
    ]);

    const series = periodos.map((p, i) => ({
      ...p,
      dados: agruparPorGranularidade(resultadosDiarios[i], granularidade),
    }));

    const principal = resultadosDiarios[0];
    const kpisCalculados = {
      faturamento: principal.reduce((s, d) => s + d.faturamento, 0),
      pedidos: principal.reduce((s, d) => s + d.pedidos, 0),
    };

    setSeriesGrafico(series);
    setResumoClientes(cli);
    setKpis(kpisCalculados);
    setCarregandoDados(false);

    // Salva pra próxima vez que alguém pedir essa mesma configuração.
    salvarGraficoSalvo(chave, {
      tipo: "vendas",
      mesInicio, mesFim, comparacoes,
      series: series.map((s) => ({ mesInicio: s.mesInicio, mesFim: s.mesFim, dados: s.dados })),
      resumoClientes: cli,
      kpis: kpisCalculados,
    });
  }

  useEffect(() => { carregarImportacoes(); }, []);
  useEffect(() => {
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify({ mesInicio, mesFim, comparacoes }));
  }, [mesInicio, mesFim, comparacoes]);

  function adicionarComparacao() {
    if (comparacoes.length >= MAX_SERIES - 1) return;
    const { mesInicio: ini, mesFim: fim } = deslocarPeriodo(mesInicio, mesFim, -(comparacoes.length + 1));
    setComparacoes((c) => [...c, { id: Date.now(), mesInicio: ini, mesFim: fim, cor: CORES_COMPARACAO[c.length + 1] }]);
  }

  function atualizarComparacao(id, campo, valor) {
    setComparacoes((c) => c.map((comp) => (comp.id === id ? { ...comp, [campo]: valor } : comp)));
  }

  function deslocarComparacao(id, direcao) {
    setComparacoes((c) => c.map((comp) => {
      if (comp.id !== id) return comp;
      return { ...comp, ...deslocarPeriodo(comp.mesInicio, comp.mesFim, direcao) };
    }));
  }

  function removerComparacao(id) {
    setComparacoes((c) => c.filter((comp) => comp.id !== id));
  }

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
    // Rede de segurança: se QUALQUER etapa travar sem erro (mesmo com os
    // timeouts internos), a tela nunca fica presa pra sempre sem avisar —
    // depois de 60s ela desiste e mostra um erro, em vez de girar infinito.
    const comLimiteDeTempo = (promessa) => Promise.race([
      promessa,
      new Promise((_, reject) => setTimeout(() => reject(new Error("A importação demorou demais (mais de 2 minutos) e foi interrompida. Tente um arquivo menor ou avise o suporte.")), 120000)),
    ]);
    try {
      const resultado = await comLimiteDeTempo(
        importarPlanilhaVendas(preview.linhas, preview.nomeArquivo, (feito, total) => setProgresso({ feito, total }))
      );
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

  function abrirGraficoSalvo(g) {
    // g já tem tudo que o gráfico precisa (veio do cache) — popula direto,
    // sem nem precisar da leitura de conferência de "1 documento".
    const periodos = [{ mesInicio: g.mesInicio, mesFim: g.mesFim, cor: CORES_COMPARACAO[0], principal: true },
      ...(g.comparacoes || []).map((c, i) => ({ ...c, cor: CORES_COMPARACAO[i + 1] }))];
    setMesInicio(g.mesInicio);
    setMesFim(g.mesFim);
    setComparacoes(g.comparacoes || []);
    setSeriesGrafico(periodos.map((p, i) => ({ ...p, dados: g.series[i]?.dados || [] })));
    setResumoClientes(g.resumoClientes || []);
    setKpis(g.kpis || { faturamento: 0, pedidos: 0 });
    setGraficoGerado(true);
    setAba("painel");
  }

  const ticketMedio = kpis.pedidos > 0 ? kpis.faturamento / kpis.pedidos : 0;
  const clientesAtivos = resumoClientes.length;

  // Alinha as séries pelo índice do balde (posição 0, 1, 2... desde o início
  // de cada período) — é isso que permite sobrepor "este mês" e "mês
  // passado" lado a lado mesmo sendo datas reais bem diferentes.
  const maxPontos = Math.max(0, ...seriesGrafico.map((s) => s.dados.length));
  const dadosGrafico = Array.from({ length: maxPontos }, (_, indice) => {
    const linha = { indice };
    seriesGrafico.forEach((s, i) => {
      const chave = "s" + i;
      const ponto = s.dados[indice];
      linha[chave + "_fat"] = ponto?.faturamento;
      linha[chave + "_ped"] = ponto?.pedidos;
      // Ticket médio do balde: sem pedido no balde fica undefined (não 0),
      // pra Line/Bar não desenharem um ponto falso ali.
      linha[chave + "_tm"] = ponto?.pedidos ? ponto.faturamento / ponto.pedidos : undefined;
      linha[chave + "_label"] = ponto?.label;
    });
    return linha;
  });
  const metricaAtual = METRICAS[metrica];

  const granularidadeAtual = granularidadeParaPeriodo(mesInicio, mesFim);
  const nomeGranularidade = { dia: "dia", quinzena: "quinzena", mes: "mês", trimestre: "trimestre", ano: "ano" }[granularidadeAtual];

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (aba === "painel" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setAba("painel")}>
          Painel
        </button>
        <button className={"btn " + (aba === "salvos" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setAba("salvos")}>
          Gráficos salvos
        </button>
        <button className={"btn " + (aba === "sazonalidade" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setAba("sazonalidade")}>
          Sazonalidade
        </button>
      </div>

      {aba === "salvos" && <GraficosSalvosLista tipo="vendas" onAbrir={abrirGraficoSalvo} />}

      {aba === "sazonalidade" && (
        <>
          <div className="card">
            <h2 className="card-title">Comparar o mesmo mês ao longo dos anos</h2>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
              Compara, por exemplo, todo mês de março já importado — um contra o outro — pra separar
              "mês fraco" de "ano fraco" e ver se a sazonalidade se repete.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select className="input" style={{ width: "auto" }} value={mesSazonalidade}
                onChange={(e) => { setMesSazonalidade(Number(e.target.value)); setDadosSaz(null); }}>
                {NOMES_MES.map((nome, i) => <option key={nome} value={i + 1}>{nome}</option>)}
              </select>
              <button className="btn btn-primary" style={{ padding: "8px 16px" }} onClick={carregarSazonalidade}
                disabled={carregandoSaz || anosComEsseMes.length === 0}>
                {carregandoSaz ? "Gerando..." : "Comparar"}
              </button>
              {anosComEsseMes.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Nenhum {NOMES_MES[mesSazonalidade - 1]} importado ainda.</span>
              )}
            </div>
          </div>

          {dadosSaz && (
            <>
              <div className="card" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["faturamento", "pedidos", "ticketMedio"].map((m) => (
                  <button key={m} type="button" className={"btn " + (metricaSazonalidade === m ? "btn-primary" : "btn-ghost")}
                    style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setMetricaSazonalidade(m)}>
                    {METRICAS[m].rotulo}
                  </button>
                ))}
              </div>

              <div className="card">
                <h2 className="card-title">{NOMES_MES[mesSazonalidade - 1]} — {METRICAS[metricaSazonalidade].rotulo.toLowerCase()} por ano</h2>
                {dadosSaz.length === 0 ? (
                  <div className="empty-state">Sem dados.</div>
                ) : (
                  <>
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <BarChart data={dadosSaz}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="ano" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={METRICAS[metricaSazonalidade].tickFormatter} />
                          <Tooltip formatter={(v) => METRICAS[metricaSazonalidade].formatar(v)} labelFormatter={(a) => `${NOMES_MES[mesSazonalidade - 1]}/${a}`} />
                          <Bar dataKey={metricaSazonalidade} fill="var(--grape)" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                      {dadosSaz.map((d, i) => {
                        const anterior = dadosSaz[i - 1];
                        const variacao = anterior && anterior[metricaSazonalidade]
                          ? ((d[metricaSazonalidade] - anterior[metricaSazonalidade]) / anterior[metricaSazonalidade]) * 100
                          : null;
                        return (
                          <div key={d.ano} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                            <span>{NOMES_MES[mesSazonalidade - 1]}/{d.ano}</span>
                            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <strong>{METRICAS[metricaSazonalidade].formatar(d[metricaSazonalidade])}</strong>
                              {variacao !== null && (
                                <span style={{ fontSize: 12, color: variacao >= 0 ? "var(--green)" : "var(--red)" }}>
                                  {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}% vs {anterior.ano}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      {aba === "painel" && (
      <>
      <div className="card">
        <h2 className="card-title">Importar histórico de vendas</h2>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 8 }}>versão do módulo de vendas: 2026-09-12-b</div>
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
                {progresso ? `Importando... ${progresso.feito} / ${progresso.total}` : "Buscando categorias no Portal de Vendas (até 8s)..."}
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

      <button className="btn btn-primary btn-block" style={{ marginBottom: 12 }} onClick={carregarDashboard} disabled={carregandoDados}>
        {carregandoDados ? "Gerando..." : graficoGerado ? "🔄 Atualizar gráfico" : "📊 Gerar gráfico"}
      </button>

      {!graficoGerado ? (
        <div className="empty-state">Escolha o período (e comparações, se quiser) acima e clique em "Gerar gráfico".</div>
      ) : carregandoDados ? (
        <div className="empty-state">Carregando...</div>
      ) : seriesGrafico[0]?.dados.length === 0 ? (
        <div className="empty-state">Nenhuma venda importada nesse período ainda.</div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Faturamento no período</div>
              <strong style={{ fontSize: 22 }}>{formatCurrency(kpis.faturamento)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Pedidos</div>
              <strong style={{ fontSize: 22 }}>{kpis.pedidos}</strong>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h2 className="card-title" style={{ marginBottom: 0 }}>
                {metricaAtual.rotulo} por {nomeGranularidade}
              </h2>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                  value={metrica} onChange={(e) => setMetrica(e.target.value)}>
                  <option value="faturamento">Faturamento</option>
                  <option value="pedidos">Pedidos</option>
                  <option value="ticketMedio">Ticket médio</option>
                </select>
                <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                  <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 12, borderRadius: 0, background: tipoGrafico === "linha" ? "var(--pink)" : "transparent", color: tipoGrafico === "linha" ? "white" : "var(--ink)" }}
                    onClick={() => setTipoGrafico("linha")}>📈 Linha</button>
                  <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 12, borderRadius: 0, background: tipoGrafico === "barras" ? "var(--pink)" : "transparent", color: tipoGrafico === "barras" ? "white" : "var(--ink)" }}
                    onClick={() => setTipoGrafico("barras")}>📊 Barras</button>
                </div>
              </div>
              {comparacoes.length < MAX_SERIES - 1 && (
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={adicionarComparacao}>
                  + Comparar outro período
                </button>
              )}
            </div>

            {comparacoes.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 6 }}>
                {comparacoes.map((comp) => (
                  <div key={comp.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: comp.cor, flexShrink: 0 }} />
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => deslocarComparacao(comp.id, -1)}>◀</button>
                    <input type="month" className="input" style={{ padding: "4px 8px", fontSize: 12, width: 130 }}
                      value={comp.mesInicio} onChange={(e) => atualizarComparacao(comp.id, "mesInicio", e.target.value)} />
                    <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>até</span>
                    <input type="month" className="input" style={{ padding: "4px 8px", fontSize: 12, width: 130 }}
                      value={comp.mesFim} onChange={(e) => atualizarComparacao(comp.id, "mesFim", e.target.value)} />
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => deslocarComparacao(comp.id, 1)}>▶</button>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px", color: "var(--red)" }} onClick={() => removerComparacao(comp.id)}>Remover</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ width: "100%", height: 300, marginTop: 10 }}>
              <ResponsiveContainer>
                {tipoGrafico === "linha" ? (
                  <LineChart data={dadosGrafico}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="indice" tick={{ fontSize: 11 }} tickFormatter={(i) => seriesGrafico[0]?.dados[i]?.label || ""} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={metricaAtual.tickFormatter} />
                    <Tooltip content={<TooltipComparacao formatar={metricaAtual.formatar} />} />
                    {seriesGrafico.length > 1 && <Legend formatter={(_, entry) => {
                      const s = seriesGrafico[Number(entry.dataKey.replace(metricaAtual.sufixo, "").slice(1))];
                      return s ? `${s.mesInicio} a ${s.mesFim}` : entry.dataKey;
                    }} />}
                    {seriesGrafico.map((s, i) => (
                      <Line key={i} type="monotone" dataKey={"s" + i + metricaAtual.sufixo} stroke={s.cor} strokeWidth={2} dot={false} connectNulls />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart data={dadosGrafico}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="indice" tick={{ fontSize: 11 }} tickFormatter={(i) => seriesGrafico[0]?.dados[i]?.label || ""} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={metricaAtual.tickFormatter} />
                    <Tooltip content={<TooltipComparacao formatar={metricaAtual.formatar} />} />
                    {seriesGrafico.length > 1 && <Legend formatter={(_, entry) => {
                      const s = seriesGrafico[Number(entry.dataKey.replace(metricaAtual.sufixo, "").slice(1))];
                      return s ? `${s.mesInicio} a ${s.mesFim}` : entry.dataKey;
                    }} />}
                    {seriesGrafico.map((s, i) => (
                      <Bar key={i} dataKey={"s" + i + metricaAtual.sufixo} fill={s.cor} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                )}
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
      </>
      )}
    </div>
  );
}
