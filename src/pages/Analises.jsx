import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, importarHistoricoPedidos } from "../lib/pedidos";
import { listarClientes, registrarContatoInativo } from "../lib/clientes";
import { lerHistoricoPedidos } from "../lib/importarHistorico";
import { formatCurrency, formatDate, pedidoEstaAtrasado, linkWhatsAppInativo, saldoDoPedido } from "../lib/constants";
import ClienteCadastroModal from "../components/ClienteCadastroModal";

const DIAS_INATIVO = 60;
const DIAS_COOLDOWN_CONTATO = 14;

export default function Analises({ onAbrirNoVales }) {
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(null); // { clientes, grupoNome }
  const [ordenacaoInativos, setOrdenacaoInativos] = useState("nome_asc");
  const [expandidosInativos, setExpandidosInativos] = useState(new Set());

  function toggleExpandidoInativo(chave) {
    setExpandidosInativos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  }
  const [toast, setToast] = useState("");

  const [previewHist, setPreviewHist] = useState(null); // { pedidos, ignoradas, abasEncontradas }
  const [importandoHist, setImportandoHist] = useState(false);
  const [progressoHist, setProgressoHist] = useState(null);
  const [resultadoHist, setResultadoHist] = useState(null);
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false);
  const [mostrarImportarHist, setMostrarImportarHist] = useState(false);

  async function carregarTudo() {
    setCarregando(true);
    const [p, c] = await Promise.all([listarPedidos(), listarClientes()]);
    setPedidos(p);
    setClientes(c);
    setCarregando(false);
  }

  useEffect(() => { carregarTudo(); }, []);

  if (carregando) return <div className="empty-state">Carregando análises...</div>;

  async function handleContatoRealizado(clienteId) {
    await registrarContatoInativo(clienteId);
    setClientes((atual) => atual.map((c) => (c.id === clienteId ? { ...c, ultimoContatoInativo: new Date().toISOString().slice(0, 10) } : c)));
  }

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
      await carregarTudo();
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
    if (dias < DIAS_INATIVO) return false;
    // se já entramos em contato recentemente (e ele não comprou depois disso),
    // não repete na lista até passar o prazo de reabordagem
    if (c.ultimoContatoInativo) {
      const diasContato = (hoje - new Date(c.ultimoContatoInativo)) / 86400000;
      const contatoDepoisDaCompra = new Date(c.ultimoContatoInativo) > new Date(ultima);
      if (contatoDepoisDaCompra && diasContato < DIAS_COOLDOWN_CONTATO) return false;
    }
    return true;
  });

  const [campoOrdInativos, dirOrdInativos] = ordenacaoInativos.split("_");
  const multOrdInativos = dirOrdInativos === "asc" ? 1 : -1;

  // Agrupa os clientes inativos pelo campo "Grupo de cliente" — mesma lógica
  // usada em Base de Dados e Vales, pra não listar 3 cards separados quando
  // na prática é uma única relação comercial com vários CNPJs.
  function chaveGrupoCliente(c) {
    return (c.grupo || "").trim().toLowerCase() || `cli_${c.id}`;
  }
  function nomeGrupoOuCliente(g) {
    return g.nomeGrupo || g.clientes[0]?.nome || "";
  }
  function ultimaCompraDoCliente(c) {
    return ultimaCompraPorCliente[c.id] || c.ultimaCompraPlanilha || "";
  }

  const gruposInativos = (() => {
    const grupos = new Map();
    inativos.forEach((c) => {
      const chave = chaveGrupoCliente(c);
      if (!grupos.has(chave)) {
        grupos.set(chave, { chave, nomeGrupo: (c.grupo || "").trim(), clientes: [], representante: "" });
      }
      const g = grupos.get(chave);
      g.clientes.push(c);
      if (!g.representante && c.representante) g.representante = c.representante;
    });
    return Array.from(grupos.values()).map((g) => {
      const ultimaCompra = g.clientes.reduce((max, c) => {
        const u = ultimaCompraDoCliente(c);
        return u && (!max || u > max) ? u : max;
      }, "");
      const mediaCompra = g.clientes.reduce((s, c) => s + (Number(c.mediaCompra) || 0), 0);
      return { ...g, ultimaCompra, mediaCompra };
    });
  })();

  const gruposInativosOrdenados = [...gruposInativos].sort((a, b) => {
    if (campoOrdInativos === "ultimaCompra") {
      return multOrdInativos * (new Date(a.ultimaCompra || 0) - new Date(b.ultimaCompra || 0));
    }
    if (campoOrdInativos === "mediaCompra") {
      return multOrdInativos * (a.mediaCompra - b.mediaCompra);
    }
    return multOrdInativos * nomeGrupoOuCliente(a).localeCompare(nomeGrupoOuCliente(b), "pt-BR");
  });

  // Junta os telefones de todos os CNPJs do grupo num só lugar, sem duplicar
  // o mesmo número que apareça em mais de um cadastro do grupo.
  function telefonesDoGrupo(g) {
    const vistos = new Set();
    const todos = [];
    g.clientes.forEach((c) => {
      telefonesDoCliente(c).forEach((t) => {
        const digitos = String(t.numero || "").replace(/\D/g, "");
        if (!vistos.has(digitos)) { vistos.add(digitos); todos.push(t); }
      });
    });
    return todos;
  }

  async function handleContatoRealizadoGrupo(g) {
    await Promise.all(g.clientes.map((c) => handleContatoRealizado(c.id)));
  }

  // Mapa pra resolver o cadastro completo do cliente a partir de um pedido
  // (o pedido só guarda uma cópia do nome/id no momento da venda).
  const clientesPorId = {};
  clientes.forEach((c) => { clientesPorId[c.id] = c; });

  function mostrarToastGenerico(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function abrirClientePorId(clienteId, clienteNome) {
    const c = clientesPorId[clienteId];
    if (!c) {
      mostrarToastGenerico(`Cadastro de "${clienteNome}" não encontrado na Base de Dados.`);
      return;
    }
    setModalAberto({ clientes: [c] });
  }

  function abrirCliente(c) {
    setModalAberto({ clientes: [c] });
  }

  // Junta todos os telefones do cadastro (principal, alternativo, WhatsApp e
  // os que vieram da consulta pública de CNPJ), sem duplicar o mesmo número
  // vindo de fontes diferentes.
  function telefonesDoCliente(c) {
    const candidatos = [
      { numero: c.whatsapp, rotulo: "WhatsApp" },
      { numero: c.telefones?.[0], rotulo: "Telefone" },
      { numero: c.telefones?.[1], rotulo: "Telefone alternativo" },
      ...(c.infoExtra?.telefones || []).map((t) => ({ numero: t, rotulo: "Receita Federal" })),
    ];
    const vistos = new Set();
    return candidatos.filter(({ numero }) => {
      const digitos = String(numero || "").replace(/\D/g, "");
      if (digitos.length < 8 || vistos.has(digitos)) return false;
      vistos.add(digitos);
      return true;
    });
  }

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
      {toast && <div className="toast">{toast}</div>}

      {!previewHist && !importandoHist && !resultadoHist && !mostrarImportarHist ? (
        <button type="button" className="card" style={{ border: "2px solid var(--pink)", width: "100%", textAlign: "left", cursor: "pointer", background: "none" }}
          onClick={() => setMostrarImportarHist(true)}>
          <strong>📤 Importar vales e compras pagas (planilha antiga)</strong>
        </button>
      ) : (
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
              {previewHist.itensComDataImplausivel > 0 && (
                <div>
                  Células com data inválida (ex: anos 1900-1902) ignoradas: <strong style={{ color: "var(--yellow)" }}>{previewHist.itensComDataImplausivel}</strong>
                  <div style={{ fontSize: 12 }}>
                    Provavelmente erro de formatação na planilha antiga. O valor total do cliente
                    (coluna "Total Pedidos") não é afetado — só essas linhas específicas do
                    detalhamento de compras não entram no histórico.
                  </div>
                </div>
              )}
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

        {!previewHist && !importandoHist && (
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10, fontSize: 13 }}
            onClick={() => { setMostrarImportarHist(false); setResultadoHist(null); }}>
            Recolher
          </button>
        )}
      </div>
      )}

      <div className="analises-grid">
        <div className="card">
          <h2 className="card-title">Pagamentos atrasados ({atrasados.length})</h2>
          <div className="analises-col-scroll">
            {atrasados.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum pagamento atrasado.</div>
            ) : (
              atrasados.map((p) => (
                <div key={p.id} className="list-item" onClick={() => onAbrirNoVales?.(p)}
                  onDoubleClick={() => abrirClientePorId(p.clienteId, p.clienteNome)}>
                  <div>
                    <strong>{clientesPorId[p.clienteId]?.nome || p.clienteNome}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Pedido em {formatDate(p.data)} · {formatCurrency(saldoDoPedido(p))}
                    </div>
                  </div>
                  <span className="badge badge-atraso">Atrasado</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Clientes inativos (+{DIAS_INATIVO} dias, sem pendências)</h2>
            <select className="input" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
              value={ordenacaoInativos} onChange={(e) => setOrdenacaoInativos(e.target.value)}>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="nome_desc">Nome (Z-A)</option>
              <option value="ultimaCompra_desc">Última compra (recente)</option>
              <option value="ultimaCompra_asc">Última compra (antiga)</option>
              <option value="mediaCompra_desc">Valor médio (maior)</option>
              <option value="mediaCompra_asc">Valor médio (menor)</option>
            </select>
          </div>
          <div className="analises-col-scroll">
            {gruposInativosOrdenados.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum cliente inativo no momento.</div>
            ) : (
              gruposInativosOrdenados.map((g) => {
                const telefones = telefonesDoGrupo(g);
                const expandido = expandidosInativos.has(g.chave);
                const multiplos = g.clientes.length > 1;
                return (
                  <div key={g.chave} className="list-item"
                    onDoubleClick={() => (multiplos ? toggleExpandidoInativo(g.chave) : abrirCliente(g.clientes[0]))}
                    style={{ flexDirection: "column", alignItems: "stretch", gap: 6, cursor: "default" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{nomeGrupoOuCliente(g)}</strong>
                      {multiplos && (
                        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{g.clientes.length} CNPJs</span>
                      )}
                    </div>
                    {g.representante && (
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Rep: {g.representante}</div>
                    )}
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Última compra: {formatDate(g.ultimaCompra)}
                      {g.mediaCompra > 0 && ` · Ticket médio ${formatCurrency(g.mediaCompra)}`}
                    </div>
                    {telefones.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {telefones.map(({ numero, rotulo }) => (
                          <div key={numero} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                              📞 {numero} <span style={{ fontSize: 11 }}>({rotulo})</span>
                            </span>
                            <a href={linkWhatsAppInativo(numero, nomeGrupoOuCliente(g))} target="_blank" rel="noopener noreferrer"
                              className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }}
                              onClick={(e) => e.stopPropagation()}>
                              Mandar mensagem
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                    {multiplos && expandido && (
                      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                        {g.clientes.map((c) => (
                          <div key={c.id} onClick={() => abrirCliente(c)} style={{ fontSize: 13, cursor: "pointer" }}>
                            {c.nome} — Cód {c.codigo} · última compra {formatDate(ultimaCompraDoCliente(c))}
                          </div>
                        ))}
                      </div>
                    )}
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 10px", alignSelf: "flex-start" }}
                      onClick={() => handleContatoRealizadoGrupo(g)}>
                      Contato realizado
                    </button>
                  </div>
                );
              })
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

      {modalAberto && (
        <ClienteCadastroModal
          clientes={modalAberto.clientes}
          grupoNome={modalAberto.grupoNome}
          onClose={() => setModalAberto(null)}
          onSaved={carregarTudo}
        />
      )}
    </div>
  );
}
