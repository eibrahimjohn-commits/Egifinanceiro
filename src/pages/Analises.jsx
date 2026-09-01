import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, importarHistoricoPedidos } from "../lib/pedidos";
import { listarClientes } from "../lib/clientes";
import { lerHistoricoPedidos } from "../lib/importarHistorico";
import { formatCurrency, formatDate, pedidoEstaAtrasado } from "../lib/constants";

const DIAS_INATIVO = 60;

export default function Analises({ onAbrirNoVales }) {
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [previewHist, setPreviewHist] = useState(null); // { pedidos, ignoradas, abasEncontradas }
  const [importandoHist, setImportandoHist] = useState(false);
  const [progressoHist, setProgressoHist] = useState(null);
  const [resultadoHist, setResultadoHist] = useState(null);
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const [p, c] = await Promise.all([listarPedidos(), listarClientes()]);
      setPedidos(p);
      setClientes(c);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <div className="empty-state">Carregando análises...</div>;

  async function handleArquivoHistorico(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setResultadoHist(null);
    try {
      const resultado = await lerHistoricoPedidos(file);
      if (resultado.pedidos.length === 0) {
        setResultadoHist({ erro: "Não encontrei as abas Pranchteta/PAGOS, ou nenhuma linha válida nelas." });
        return;
      }
      setPreviewHist(resultado);
    } catch (err) {
      setResultadoHist({ erro: err.message });
    }
  }

  async function confirmarImportacaoHistorico() {
    if (!previewHist) return;
    setImportandoHist(true);
    setProgressoHist({ feitos: 0, total: previewHist.pedidos.length });
    try {
      const resultado = await importarHistoricoPedidos(
        previewHist.pedidos,
        clientes,
        (feitos, total, clientesCriados) => setProgressoHist({ feitos, total, clientesCriados })
      );
      setResultadoHist({ sucesso: true, ...resultado, ignoradas: previewHist.ignoradas.length });
      setPreviewHist(null);
      // recarrega pedidos/clientes pra refletir na tela
      const [p, c] = await Promise.all([listarPedidos(), listarClientes()]);
      setPedidos(p);
      setClientes(c);
    } catch (err) {
      setResultadoHist({ erro: err.message });
    } finally {
      setImportandoHist(false);
      setProgressoHist(null);
    }
  }

  const hoje = new Date();

  // Clientes com pagamento atrasado (parcela de cheque com data já vencida)
  const atrasados = pedidos.filter(pedidoEstaAtrasado);

  // Clientes inativos: última compra há mais de 60 dias, sem vale em aberto
  const ultimaCompraPorCliente = {};
  pedidos.forEach((p) => {
    const atual = ultimaCompraPorCliente[p.clienteId];
    if (!atual || new Date(p.data) > new Date(atual)) {
      ultimaCompraPorCliente[p.clienteId] = p.data;
    }
  });
  const temValeAberto = new Set(pedidos.filter((p) => p.status === "aberto").map((p) => p.clienteId));

  const inativos = clientes.filter((c) => {
    if (temValeAberto.has(c.id)) return false;
    // se já sabemos que o CNPJ não está ativo (baixado/suspenso), não faz sentido
    // sinalizar como "parou de comprar" — a empresa nem existe mais oficialmente
    const situacao = (c.infoExtra?.situacaoCadastral || "").toUpperCase();
    if (situacao && !situacao.includes("ATIVA")) return false;
    // considera tanto pedidos lançados no sistema quanto a data vinda da planilha
    const doSistema = ultimaCompraPorCliente[c.id];
    const daPlanilha = c.ultimaCompraPlanilha;
    const ultima = doSistema && daPlanilha
      ? (doSistema > daPlanilha ? doSistema : daPlanilha)
      : (doSistema || daPlanilha);
    if (!ultima) return false; // nunca comprou - não é "parou de comprar"
    const dias = (hoje - new Date(ultima)) / 86400000;
    return dias >= DIAS_INATIVO;
  });

  // Heatmap simples por cidade/estado (contagem de pedidos)
  const porCidade = {};
  pedidos.forEach((p) => {
    const chave = `${p.clienteCidade || "?"}/${p.clienteEstado || "?"}`;
    porCidade[chave] = (porCidade[chave] || 0) + Number(p.valor || 0);
  });
  const cidadesOrdenadas = Object.entries(porCidade).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxValor = cidadesOrdenadas[0]?.[1] || 1;

  return (
    <div>
      <div className="card" style={{ border: "2px solid var(--pink)" }}>
        <h2 className="card-title">📤 Importar vales e compras pagas (planilha antiga)</h2>

        {!previewHist && !importandoHist && (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
              Envie o arquivo com as abas "Pranchteta" (contas em aberto) e "PAGOS" (histórico
              de pedidos já quitados). Vincula automaticamente pelo código do cliente já cadastrado.
            </p>
            <label className="btn btn-secondary btn-block" style={{ cursor: "pointer" }}>
              Escolher arquivo .xlsx
              <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleArquivoHistorico} />
            </label>
          </>
        )}

        {importandoHist && (
          <div className="empty-state">
            Importando... {progressoHist ? `${progressoHist.feitos}/${progressoHist.total}` : ""}
            {progressoHist?.clientesCriados > 0 && ` · ${progressoHist.clientesCriados} clientes novos criados`}
          </div>
        )}

        {previewHist && !importandoHist && (
          <>
            <div style={{ background: "var(--bg)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}>
              <div>Abas encontradas: <strong style={{ color: "var(--ink)" }}>{previewHist.abasEncontradas.join(", ")}</strong></div>
              <div>Pedidos a importar: <strong style={{ color: "var(--ink)" }}>{previewHist.pedidos.length}</strong></div>
              <div>Linhas ignoradas (quebradas): <strong style={{ color: "var(--red)" }}>{previewHist.ignoradas.length}</strong></div>
            </div>

            {previewHist.ignoradas.length > 0 && (
              <>
                <button type="button" className="btn btn-ghost" style={{ marginBottom: 10, fontSize: 13 }}
                  onClick={() => setMostrarIgnoradas((v) => !v)}>
                  {mostrarIgnoradas ? "Esconder" : "Ver"} linhas ignoradas
                </button>
                {mostrarIgnoradas && (
                  <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
                    {previewHist.ignoradas.map((ig, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--ink-soft)", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                        {ig.aba} linha {ig.linha} · {ig.cliente} · {ig.motivo}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>Prévia:</div>
            {previewHist.pedidos.slice(0, 5).map((p, i) => (
              <div key={i} style={{ fontSize: 13, color: "var(--ink-soft)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                {p.codigo || "(sem cód)"} · {p.nome} · {p.situacao} · {formatCurrency(p.totalPedidos)}
              </div>
            ))}

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setPreviewHist(null)}>Cancelar</button>
              <button className="btn btn-primary btn-block" onClick={confirmarImportacaoHistorico}>
                Importar {previewHist.pedidos.length} pedidos
              </button>
            </div>
          </>
        )}

        {resultadoHist && (
          <div className="card" style={{
            marginTop: 12, background: resultadoHist.erro ? "var(--red-light)" : "var(--green-light)",
            color: resultadoHist.erro ? "var(--red)" : "#158a45", fontSize: 13,
          }}>
            {resultadoHist.erro
              ? resultadoHist.erro
              : `${resultadoHist.processados} pedidos importados! ${resultadoHist.clientesCriados} clientes novos criados. ${resultadoHist.ignoradas} linhas ignoradas.`}
          </div>
        )}
      </div>

      <div className="analises-grid">
        <div className="card">
          <h2 className="card-title">Pagamentos atrasados ({atrasados.length})</h2>
          <div className="analises-col-scroll">
            {atrasados.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum pagamento atrasado.</div>
            ) : (
              atrasados.map((p) => (
                <div key={p.id} className="list-item" onClick={() => onAbrirNoVales?.(p)}>
                  <div>
                    <strong>{p.clienteNome}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Pedido em {formatDate(p.data)} · {formatCurrency(Number(p.valorDevido ?? p.valor) - Number(p.valorPago || 0))}
                    </div>
                  </div>
                  <span className="badge badge-atraso">Atrasado</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Clientes inativos (+{DIAS_INATIVO} dias, sem pendências)</h2>
          <div className="analises-col-scroll">
            {inativos.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum cliente inativo no momento.</div>
            ) : (
              inativos.map((c) => (
                <div key={c.id} className="list-item">
                  <div>
                    <strong>{c.nome}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Última compra: {formatDate(ultimaCompraPorCliente[c.id])}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Mapa de calor — por cidade/estado</h2>
          <div className="analises-col-scroll">
            {cidadesOrdenadas.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Sem dados de pedidos ainda.</div>
            ) : (
              cidadesOrdenadas.map(([cidade, valor]) => (
                <div key={cidade} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{cidade}</span>
                    <strong>{formatCurrency(valor)}</strong>
                  </div>
                  <div style={{ background: "var(--pink-light)", borderRadius: 8, height: 10 }}>
                    <div style={{
                      width: `${(valor / maxValor) * 100}%`,
                      background: "linear-gradient(90deg, var(--pink), var(--grape))",
                      height: "100%",
                      borderRadius: 8,
                    }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
