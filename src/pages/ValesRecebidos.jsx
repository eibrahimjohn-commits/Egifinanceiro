import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, registrarBaixa, confirmarFormaPagamento, arquivarPedidos, editarItemPedido } from "../lib/pedidos";
import { listarClientes } from "../lib/clientes";
import ClienteCadastroModal from "../components/ClienteCadastroModal";
import {
  formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO, CONTAS_PADRAO,
  pedidoEstaAtrasado, calcularPercentualAberto, tagResumoCliente, podeMoverParaRecebidos,
  calcularParcelasCheque, valorDevidoDoPedido, saldoDoPedido,
} from "../lib/constants";

const FORMAS_COM_CONTA = ["pix_ted", "deposito"];
const FORMAS_COM_CONFIRMAR = ["pix_ted", "deposito"];

function labelForma(tipo) {
  return FORMAS_PAGAMENTO.find((f) => f.value === tipo)?.label || tipo;
}

function montarConta(contaSelecionada, identificacao) {
  if (contaSelecionada === "Terceiros") {
    return identificacao.trim() ? `Terceiros - ${identificacao.trim()}` : "Terceiros";
  }
  return contaSelecionada;
}

// Padrão de exibição: "Nome (Representante)" — usa o Grupo de cliente como nome
// quando existir, senão usa o nome do cliente. O representante aparece entre
// parênteses sempre que estiver preenchido, com ou sem grupo.
function nomeExibicao(g) {
  const nomeBase = g.nomeGrupo || Array.from(g.clientesNomes)[0];
  return g.representante ? `${nomeBase} (${g.representante})` : nomeBase;
}

// Só o nome do grupo (ou do cliente, se não tiver grupo), sem o representante
// junto — usado no título do card, que agora leva o representante numa
// linha separada.
function nomeGrupoOuCliente(g) {
  return g.nomeGrupo || Array.from(g.clientesNomes)[0];
}

// Agrupa uma lista qualquer de pedidos por "Grupo de cliente" (ou cliente individual),
// somando valor devido/pago e derivando saldo, percentual, atraso e representante.
function agruparPorCliente(lista) {
  const grupos = new Map();
  lista.forEach((p) => {
    const chave = (p.clienteGrupo || "").trim().toLowerCase() || `cli_${p.clienteId}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        nomeGrupo: (p.clienteGrupo || "").trim(),
        clientesNomes: new Set(),
        clientesIds: new Set(),
        representante: "",
        pedidos: [],
        totalDevido: 0,
        totalPago: 0,
        dataMaisRecente: p.data,
        atrasado: false,
      });
    }
    const g = grupos.get(chave);
    g.pedidos.push(p);
    g.clientesNomes.add(p.clienteNome);
    if (p.clienteId) g.clientesIds.add(p.clienteId);
    if (!g.representante && p.clienteRepresentante) g.representante = p.clienteRepresentante;
    g.totalDevido += valorDevidoDoPedido(p);
    g.totalPago += Number(p.valorPago || 0);
    if (new Date(p.data) > new Date(g.dataMaisRecente)) g.dataMaisRecente = p.data;
    if (pedidoEstaAtrasado(p)) g.atrasado = true;
  });
  return Array.from(grupos.values()).map((g) => {
    const saldo = g.totalDevido - g.totalPago;
    const percentual = calcularPercentualAberto(saldo, g.totalDevido);
    return { ...g, saldo, percentual, tag: tagResumoCliente(saldo, percentual, g.atrasado) };
  });
}

// Estimativa de quanto de um saldo em aberto cai dentro dos próximos 30 dias,
// proporcional ao prazo de pagamento do pedido: prazo de 30 dias conta o
// valor integral; prazos maiores contam proporcionalmente (ex: prazo de 90
// dias conta 1/3 do saldo). Sem prazo definido, considera o valor todo
// (mais seguro pra previsão do que assumir prazo indefinido).
function contribuicao30Dias(saldo, prazoDias) {
  const prazo = Number(prazoDias) || 0;
  if (prazo <= 0) return saldo;
  const fator = Math.min(30 / prazo, 1);
  return saldo * fator;
}

function CampoConta({ conta, setConta, identificacao, setIdentificacao }) {
  return (
    <>
      <div className="field">
        <label>Conta</label>
        <select className="input" value={conta} onChange={(e) => setConta(e.target.value)}>
          <option value="">Selecione...</option>
          {CONTAS_PADRAO.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {conta === "Terceiros" && (
        <div className="field">
          <label>Identificação</label>
          <input className="input" value={identificacao} onChange={(e) => setIdentificacao(e.target.value)}
            placeholder="Nome da pessoa/conta de terceiro" />
        </div>
      )}
    </>
  );
}

// Conteúdo expandido de um grupo — some cliente, compras, pagamentos, ações.
// Fica DENTRO do card, sem navegar de página. Componente hoisted fora do corpo
// da página (senão perde o foco dos campos a cada tecla).
function DetalheExpandido({
  g,
  pedidoBaixa, onAbrirBaixa, onCancelarBaixa, onConfirmarBaixa,
  valorBaixa, setValorBaixa, dataBaixa, setDataBaixa, formaBaixa, setFormaBaixa,
  contaBaixa, setContaBaixa, contaBaixaId, setContaBaixaId,
  numFolhasBaixa, setNumFolhasBaixa, prazoUltimoChequeBaixa, setPrazoUltimoChequeBaixa,
  descricaoBaixa, setDescricaoBaixa,
  editandoItem, onAbrirEdicaoItem, onCancelarEdicaoItem, onSalvarEdicaoItem, setValorEditandoItem,
  confirmando, onAbrirConfirmar, onCancelarConfirmar, onConfirmarPixDeposito,
  contaConfirmar, setContaConfirmar, contaConfirmarId, setContaConfirmarId,
  onMoverRecebidos, somenteLeitura,
}) {
  const historico = g.pedidos
    .flatMap((p) => (p.pagamentos || []).map((pg) => ({ ...pg, pedidoData: p.data })))
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  const pedidosComSaldo = somenteLeitura ? [] : g.pedidos.filter((p) => saldoDoPedido(p) > 0.01);

  return (
    <div style={{ padding: "0 4px 4px" }} onClick={(e) => e.stopPropagation()}>
      {!somenteLeitura && podeMoverParaRecebidos(g.percentual) && !pedidoBaixa && (
        <button className="btn btn-secondary btn-block" style={{ marginBottom: 12 }} onClick={() => onMoverRecebidos(g)}>
          Mover para recebidos
        </button>
      )}

      {pedidosComSaldo.length > 0 && !pedidoBaixa && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Registrar pagamento</h3>
          {pedidosComSaldo.length === 1 ? (
            <button className="btn btn-primary btn-block" onClick={() => onAbrirBaixa(pedidosComSaldo[0])}>
              Registrar pagamento de {formatCurrency(saldoDoPedido(pedidosComSaldo[0]))}
            </button>
          ) : (
            pedidosComSaldo.map((p) => (
              <div key={p.id} className="list-item" onClick={() => onAbrirBaixa(p)}>
                <div>
                  <strong>{formatDate(p.data)}</strong>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {formatCurrency(saldoDoPedido(p))} em aberto
                  </div>
                </div>
                <span>→</span>
              </div>
            ))
          )}
        </div>
      )}

      {pedidoBaixa && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Registrar pagamento — pedido de {formatDate(pedidoBaixa.data)}</h3>
          <div className="row">
            <div className="field">
              <label>Valor recebido</label>
              <input className="input" type="number" step="0.01" value={valorBaixa} onChange={(e) => setValorBaixa(e.target.value)} />
            </div>
            <div className="field">
              <label>Data</label>
              <input className="input" type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Forma de pagamento</label>
            <select className="input" value={formaBaixa} onChange={(e) => setFormaBaixa(e.target.value)}>
              {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          {FORMAS_COM_CONTA.includes(formaBaixa) && (
            <CampoConta conta={contaBaixa} setConta={setContaBaixa} identificacao={contaBaixaId} setIdentificacao={setContaBaixaId} />
          )}
          {formaBaixa === "conta_terceiros" && (
            <div className="field">
              <label>De quem é a conta</label>
              <input className="input" value={descricaoBaixa} onChange={(e) => setDescricaoBaixa(e.target.value)}
                placeholder="Ex: conta do irmão do cliente, João Silva" />
            </div>
          )}
          {formaBaixa === "cheque" && (
            <>
              <div className="row">
                <div className="field">
                  <label>Número de folhas</label>
                  <input className="input" type="number" min="1" value={numFolhasBaixa}
                    onChange={(e) => setNumFolhasBaixa(e.target.value)} />
                </div>
                <div className="field">
                  <label>Prazo do último cheque</label>
                  <input className="input" type="date" value={prazoUltimoChequeBaixa}
                    onChange={(e) => setPrazoUltimoChequeBaixa(e.target.value)} />
                </div>
              </div>
              {valorBaixa && prazoUltimoChequeBaixa && Number(numFolhasBaixa) > 0 && (
                <div style={{ background: "white", borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  {calcularParcelasCheque(prazoUltimoChequeBaixa, numFolhasBaixa, valorBaixa).map((p) => (
                    <div key={p.numero} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                      <span>Folha {p.numero} — {formatDate(p.data)}</span>
                      <strong>{formatCurrency(p.valor)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost btn-block" onClick={onCancelarBaixa}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-block" onClick={onConfirmarBaixa}>Confirmar</button>
          </div>
        </div>
      )}

      <div className="card" style={{ background: "var(--bg)" }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Compras</h3>
        {g.pedidos.flatMap((p) => (p.itens?.length ? p.itens : [{ valor: p.valor, data: p.data }]).map((it, i) => {
          const editandoEsse = editandoItem?.pedido.id === p.id && editandoItem?.itemIndex === i;
          return (
            <div key={p.id + "_" + i} style={{ padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              {editandoEsse ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>{formatDate(it.data)}</span>
                  <input className="input" type="number" step="0.01" autoFocus
                    style={{ padding: "4px 8px", fontSize: 13 }}
                    value={editandoItem.valor}
                    onChange={(e) => setValorEditandoItem(e.target.value)} />
                  <button type="button" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onSalvarEdicaoItem}>✓</button>
                  <button type="button" className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onCancelarEdicaoItem}>✕</button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span>{formatDate(it.data)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{formatCurrency(it.valor)}</strong>
                    {!somenteLeitura && (
                      <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }}
                        onClick={() => onAbrirEdicaoItem(p, i, it.valor)} title="Editar valor">✎</button>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        }))}
      </div>

      {g.pedidos.some((p) => p.historicoEdicoes?.length > 0) && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Histórico de edições</h3>
          {g.pedidos.flatMap((p) =>
            (p.historicoEdicoes || []).map((ed, i) => (
              <div key={p.id + "_ed_" + i} style={{ fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Compra de {formatDate(ed.dataItem)}</span>
                  <span>{formatDate(ed.data.slice(0, 10))}</span>
                </div>
                <div style={{ color: "var(--ink-soft)" }}>
                  {formatCurrency(ed.valorAnterior)} → <strong style={{ color: "var(--ink)" }}>{formatCurrency(ed.valorNovo)}</strong>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {g.pedidos.some((p) =>
        p.formasPagamento?.some((f) => f.tipo === "cheque") || p.pagamentos?.some((pg) => pg.formaPagamento === "cheque" && pg.parcelas)
      ) && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Cheques</h3>
          {g.pedidos.flatMap((p) => [
            ...(p.formasPagamento?.filter((f) => f.tipo === "cheque").flatMap((f, fi) =>
              (f.parcelas || []).map((parc) => (
                <div key={p.id + "_ch_" + fi + "_" + parc.numero} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>Folha {parc.numero} — {formatDate(parc.data)}</span>
                  <strong>{formatCurrency(parc.valor)}</strong>
                </div>
              ))
            ) || []),
            ...(p.pagamentos?.filter((pg) => pg.formaPagamento === "cheque" && pg.parcelas).flatMap((pg, pgi) =>
              (pg.parcelas || []).map((parc) => (
                <div key={p.id + "_bx_" + pgi + "_" + parc.numero} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>Folha {parc.numero} (pagamento) — {formatDate(parc.data)}</span>
                  <strong>{formatCurrency(parc.valor)}</strong>
                </div>
              ))
            ) || []),
          ])}
        </div>
      )}

      {historico.length > 0 && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Pagamentos</h3>
          {historico.map((pg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              <span>{formatDate(pg.data)} · {labelForma(pg.formaPagamento)}{pg.conta ? ` (${pg.conta})` : ""}</span>
              <strong>{formatCurrency(pg.valor)}</strong>
            </div>
          ))}
        </div>
      )}

      {!somenteLeitura && g.pedidos.some((p) => p.formasPagamento?.some((f) => FORMAS_COM_CONFIRMAR.includes(f.tipo) && !f.confirmado)) && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>PIX/Depósito pendentes de confirmação</h3>
          {g.pedidos.map((p) =>
            (p.formasPagamento || []).map((f, i) => {
              if (!FORMAS_COM_CONFIRMAR.includes(f.tipo) || f.confirmado) return null;
              return (
                <div key={p.id + "_f" + i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                    <span>{labelForma(f.tipo)} · {formatDate(p.data)}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>{formatCurrency(f.valor)}</strong>
                      <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => onAbrirConfirmar(p, i)}>
                        Confirmar
                      </button>
                    </div>
                  </div>
                  {confirmando?.pedido.id === p.id && confirmando?.formaIndex === i && (
                    <div style={{ background: "white", borderRadius: 10, padding: 10, marginTop: 6 }}>
                      <CampoConta conta={contaConfirmar} setConta={setContaConfirmar} identificacao={contaConfirmarId} setIdentificacao={setContaConfirmarId} />
                      <div className="row" style={{ margin: 0 }}>
                        <button type="button" className="btn btn-ghost btn-block" style={{ padding: "6px 10px", fontSize: 13 }} onClick={onCancelarConfirmar}>Cancelar</button>
                        <button type="button" className="btn btn-primary btn-block" style={{ padding: "6px 10px", fontSize: 13 }} onClick={onConfirmarPixDeposito}>Confirmar recebimento</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function CardGrupo({ g, expandido, onToggle, onAbrirGrupo, children }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => onToggle(g.chave)} onDoubleClick={() => onAbrirGrupo?.(g)}>
        <div>
          <strong>{nomeGrupoOuCliente(g)} - {formatCurrency(g.saldo)}</strong>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
            {[g.representante, formatDate(g.dataMaisRecente), `${g.percentual.toFixed(1)}%`].filter(Boolean).join(" - ")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className={"badge " + g.tag.classe}>{g.tag.texto}</span>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{expandido ? "▲" : "▼"}</span>
        </div>
      </div>
      {expandido && children}
    </div>
  );
}

export default function ValesRecebidos({ alvoAbrir, onAlvoConsumido } = {}) {
  const [sub, setSub] = useState("vales"); // vales | comissoes | recebidos
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(null); // { clientes, grupoNome }

  const [filtro, setFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState("data_desc");
  const [expandidos, setExpandidos] = useState(new Set());

  const [pedidoBaixa, setPedidoBaixa] = useState(null);
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix_ted");
  const [contaBaixa, setContaBaixa] = useState("");
  const [contaBaixaId, setContaBaixaId] = useState("");
  const [numFolhasBaixa, setNumFolhasBaixa] = useState("1");
  const [prazoUltimoChequeBaixa, setPrazoUltimoChequeBaixa] = useState("");
  const [descricaoBaixa, setDescricaoBaixa] = useState("");
  const [editandoItem, setEditandoItem] = useState(null); // { pedido, itemIndex, valor }

  const [confirmando, setConfirmando] = useState(null);
  const [contaConfirmar, setContaConfirmar] = useState("");
  const [contaConfirmarId, setContaConfirmarId] = useState("");

  const [selecionadosComissao, setSelecionadosComissao] = useState(new Set());

  const [toast, setToast] = useState("");

  async function carregar() {
    setCarregando(true);
    const [lista, listaClientes] = await Promise.all([listarPedidos(), listarClientes()]);
    setPedidos(lista);
    setClientes(listaClientes);
    setCarregando(false);
    return lista;
  }

  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!alvoAbrir || pedidos.length === 0) return;
    const chaveAlvo = (alvoAbrir.clienteGrupo || "").trim().toLowerCase() || `cli_${alvoAbrir.clienteId}`;
    setSub("vales");
    setExpandidos(new Set([chaveAlvo]));
    onAlvoConsumido?.();
  }, [alvoAbrir, pedidos]);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function toggleExpandido(chave) {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
    setPedidoBaixa(null);
    setConfirmando(null);
  }

  // Resolve os cadastros reais (com id, cnpj, etc.) dos clientes que
  // compõem o grupo clicado — os pedidos só guardam uma cópia do nome/id
  // no momento da venda, então buscamos o cadastro atual pra editar.
  function abrirGrupo(g) {
    const encontrados = clientes.filter((c) => g.clientesIds.has(c.id));
    if (encontrados.length === 0) {
      mostrarToast("Cadastro do cliente não encontrado na Base de Dados.");
      return;
    }
    setModalAberto({ clientes: encontrados, grupoNome: nomeExibicao(g) });
  }

  function aplicarFiltroOrdenacao(lista, campoNome, campoData, campoValor, campoPercentual, campoRepresentante) {
    let out = lista;
    if (filtro.trim()) {
      const f = filtro.toLowerCase();
      out = out.filter((item) => campoNome(item).toLowerCase().includes(f));
    }
    const [campo, dir] = ordenacao.split("_");
    const mult = dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (campo === "nome") return mult * campoNome(a).localeCompare(campoNome(b), "pt-BR");
      if (campo === "percentual" && campoPercentual) return mult * (campoPercentual(a) - campoPercentual(b));
      if (campo === "representante" && campoRepresentante) {
        return mult * (campoRepresentante(a) || "").localeCompare(campoRepresentante(b) || "", "pt-BR");
      }
      const va = campo === "data" ? new Date(campoData(a)) : campoValor(a);
      const vb = campo === "data" ? new Date(campoData(b)) : campoValor(b);
      return dir === "asc" ? va - vb : vb - va;
    });
    return out;
  }

  const pedidosAtivos = pedidos.filter((p) => !p.arquivado);
  const pedidosComissao = pedidosAtivos.filter((p) => p.status === "pago" && p.clienteRepresentante);
  const pedidosVales = pedidosAtivos.filter((p) => !(p.status === "pago" && p.clienteRepresentante));
  const pedidosRecebidos = pedidos.filter((p) => p.arquivado === true);

  // Total geral em aberto e previsão de recebimento nos próximos 30 dias
  // (valor integral pra prazo de 30 dias, proporcional pra prazos maiores
  // — ver contribuicao30Dias). Calculado sobre todos os vales, sem levar
  // em conta o filtro de busca da tela.
  const totalAReceberGeral = pedidosVales.reduce((soma, p) => {
    const saldo = saldoDoPedido(p);
    return soma + Math.max(saldo, 0);
  }, 0);
  const totalProximos30Dias = pedidosVales.reduce((soma, p) => {
    const saldo = saldoDoPedido(p);
    if (saldo <= 0) return soma;
    return soma + contribuicao30Dias(saldo, p.clientePrazo);
  }, 0);

  const gruposVales = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidosVales),
    (g) => nomeExibicao(g),
    (g) => g.dataMaisRecente,
    (g) => g.saldo,
    (g) => g.percentual,
    (g) => g.representante
  );
  const gruposRecebidos = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidosRecebidos),
    (g) => nomeExibicao(g),
    (g) => g.dataMaisRecente,
    (g) => g.totalPago,
    (g) => g.percentual,
    (g) => g.representante
  );
  const comissoesFiltradas = aplicarFiltroOrdenacao(
    pedidosComissao,
    (p) => p.clienteNome,
    (p) => p.data,
    (p) => p.valor,
    null,
    (p) => p.clienteRepresentante
  );

  function abrirBaixa(pedido) {
    const saldo = saldoDoPedido(pedido);
    setPedidoBaixa(pedido);
    setValorBaixa(saldo.toFixed(2));
    setDataBaixa(todayISO());
    setFormaBaixa("pix_ted");
    setContaBaixa("");
    setContaBaixaId("");
    setNumFolhasBaixa("1");
    setPrazoUltimoChequeBaixa("");
    setDescricaoBaixa("");
  }

  async function confirmarBaixa() {
    if (!valorBaixa || Number(valorBaixa) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    const ehCheque = formaBaixa === "cheque";
    if (ehCheque && (!prazoUltimoChequeBaixa || Number(numFolhasBaixa) < 1)) {
      mostrarToast("Informe o prazo do último cheque e o número de folhas");
      return;
    }
    if (formaBaixa === "conta_terceiros" && !descricaoBaixa.trim()) {
      mostrarToast("Informe de quem é a conta");
      return;
    }
    const parcelas = ehCheque ? calcularParcelasCheque(prazoUltimoChequeBaixa, numFolhasBaixa, valorBaixa) : null;
    await registrarBaixa(pedidoBaixa.id, pedidoBaixa, {
      valor: Number(valorBaixa),
      data: dataBaixa,
      formaPagamento: formaBaixa,
      conta: FORMAS_COM_CONTA.includes(formaBaixa) ? montarConta(contaBaixa, contaBaixaId) : null,
      ...(ehCheque ? { numFolhas: Number(numFolhasBaixa), prazoUltimoCheque: prazoUltimoChequeBaixa, parcelas } : {}),
      ...(formaBaixa === "conta_terceiros" ? { descricao: descricaoBaixa.trim() } : {}),
    });
    mostrarToast("Pagamento registrado!");
    setPedidoBaixa(null);
    carregar();
  }

  function abrirEdicaoItem(pedido, itemIndex, valorAtual) {
    setEditandoItem({ pedido, itemIndex, valor: String(valorAtual) });
  }

  function setValorEditandoItem(valor) {
    setEditandoItem((atual) => (atual ? { ...atual, valor } : atual));
  }

  async function salvarEdicaoItem() {
    if (!editandoItem || !editandoItem.valor || Number(editandoItem.valor) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    await editarItemPedido(editandoItem.pedido.id, editandoItem.pedido, editandoItem.itemIndex, Number(editandoItem.valor));
    mostrarToast("Valor atualizado!");
    setEditandoItem(null);
    carregar();
  }

  function abrirConfirmar(pedido, formaIndex) {
    setConfirmando({ pedido, formaIndex });
    setContaConfirmar("");
    setContaConfirmarId("");
  }

  async function confirmarPixDeposito() {
    const { pedido, formaIndex } = confirmando;
    await confirmarFormaPagamento(pedido.id, pedido, formaIndex, montarConta(contaConfirmar, contaConfirmarId));
    mostrarToast("Pagamento confirmado e baixado!");
    setConfirmando(null);
    carregar();
  }

  async function moverParaRecebidos(g) {
    await arquivarPedidos(g.pedidos.map((p) => p.id));
    mostrarToast("Cliente movido para Recebidos!");
    setExpandidos((atual) => { const n = new Set(atual); n.delete(g.chave); return n; });
    carregar();
  }

  function toggleSelecaoComissao(id) {
    setSelecionadosComissao((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  async function confirmarComissaoPaga() {
    await arquivarPedidos(Array.from(selecionadosComissao), { comissaoPaga: true });
    mostrarToast(`${selecionadosComissao.size} pedido(s) movido(s) para Recebidos!`);
    setSelecionadosComissao(new Set());
    carregar();
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (sub === "vales" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("vales")}>
          Vales ({gruposVales.length})
        </button>
        <button className={"btn " + (sub === "comissoes" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("comissoes")}>
          Comissões ({pedidosComissao.length})
        </button>
        <button className={"btn " + (sub === "recebidos" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("recebidos")}>
          Recebidos ({gruposRecebidos.length})
        </button>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <input className="input" placeholder="Buscar por cliente ou grupo" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: "0 0 180px" }}>
            <select className="input" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)}>
              <option value="data_desc">Data (recente)</option>
              <option value="data_asc">Data (antiga)</option>
              <option value="valor_desc">Valor (maior)</option>
              <option value="valor_asc">Valor (menor)</option>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="nome_desc">Nome (Z-A)</option>
              <option value="percentual_desc">% em aberto (maior)</option>
              <option value="percentual_asc">% em aberto (menor)</option>
              <option value="representante_asc">Representante (A-Z)</option>
              <option value="representante_desc">Representante (Z-A)</option>
            </select>
          </div>
        </div>
      </div>

      {sub === "vales" && (
        <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Total a receber</div>
            <strong style={{ fontSize: 22 }}>{formatCurrency(totalAReceberGeral)}</strong>
          </div>
          <div title="Estimativa: pedidos com prazo de 30 dias entram integralmente; prazos maiores entram proporcionalmente (ex: prazo de 90 dias conta 1/3 do saldo). Pedidos sem prazo definido entram integralmente.">
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              Previsto p/ próximos 30 dias <span style={{ cursor: "help" }}>ⓘ</span>
            </div>
            <strong style={{ fontSize: 22, color: "var(--grape)" }}>{formatCurrency(totalProximos30Dias)}</strong>
          </div>
        </div>
      )}

      {carregando && <div className="empty-state">Carregando...</div>}

      {!carregando && sub === "vales" && (
        gruposVales.length === 0 ? (
          <div className="empty-state">Nenhuma conta em aberto 🎉</div>
        ) : (
          <div className="lista-grid">
            {gruposVales.map((g) => (
              <CardGrupo key={g.chave} g={g} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido} onAbrirGrupo={abrirGrupo}>
                <DetalheExpandido
                  g={g}
                  pedidoBaixa={pedidoBaixa} onAbrirBaixa={abrirBaixa} onCancelarBaixa={() => setPedidoBaixa(null)} onConfirmarBaixa={confirmarBaixa}
                  valorBaixa={valorBaixa} setValorBaixa={setValorBaixa} dataBaixa={dataBaixa} setDataBaixa={setDataBaixa}
                  formaBaixa={formaBaixa} setFormaBaixa={setFormaBaixa}
                  numFolhasBaixa={numFolhasBaixa} setNumFolhasBaixa={setNumFolhasBaixa}
                  prazoUltimoChequeBaixa={prazoUltimoChequeBaixa} setPrazoUltimoChequeBaixa={setPrazoUltimoChequeBaixa}
                  descricaoBaixa={descricaoBaixa} setDescricaoBaixa={setDescricaoBaixa}
                  editandoItem={editandoItem} onAbrirEdicaoItem={abrirEdicaoItem} onCancelarEdicaoItem={() => setEditandoItem(null)}
                  onSalvarEdicaoItem={salvarEdicaoItem} setValorEditandoItem={setValorEditandoItem}
                  contaBaixa={contaBaixa} setContaBaixa={setContaBaixa} contaBaixaId={contaBaixaId} setContaBaixaId={setContaBaixaId}
                  confirmando={confirmando} onAbrirConfirmar={abrirConfirmar} onCancelarConfirmar={() => setConfirmando(null)} onConfirmarPixDeposito={confirmarPixDeposito}
                  contaConfirmar={contaConfirmar} setContaConfirmar={setContaConfirmar} contaConfirmarId={contaConfirmarId} setContaConfirmarId={setContaConfirmarId}
                  onMoverRecebidos={moverParaRecebidos}
                />
              </CardGrupo>
            ))}
          </div>
        )
      )}

      {!carregando && sub === "comissoes" && (
        comissoesFiltradas.length === 0 ? (
          <div className="empty-state">Nenhum pedido pago aguardando comissão.</div>
        ) : (
          <>
            {selecionadosComissao.size > 0 && (
              <button className="btn btn-primary btn-block" style={{ marginBottom: 12 }} onClick={confirmarComissaoPaga}>
                Comissão paga ({selecionadosComissao.size} selecionado{selecionadosComissao.size > 1 ? "s" : ""})
              </button>
            )}
            <div className="lista-grid">
              {comissoesFiltradas.map((p) => (
                <div key={p.id} className="list-item" onClick={() => toggleSelecaoComissao(p.id)} style={{ alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="checkbox" checked={selecionadosComissao.has(p.id)} onChange={() => toggleSelecaoComissao(p.id)} onClick={(e) => e.stopPropagation()} />
                    <div>
                      <strong>{p.clienteNome}</strong>
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                        Rep: {p.clienteRepresentante} · {formatDate(p.data)} · {formatCurrency(p.valor)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {!carregando && sub === "recebidos" && (
        gruposRecebidos.length === 0 ? (
          <div className="empty-state">Nenhum recebimento ainda.</div>
        ) : (
          <div className="lista-grid">
            {gruposRecebidos.map((g) => (
              <CardGrupo key={g.chave} g={{ ...g, tag: { texto: "Pago", classe: "badge-pago" } }} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido} onAbrirGrupo={abrirGrupo}>
                <DetalheExpandido
                  g={g}
                  pedidoBaixa={null} onAbrirBaixa={() => {}} onCancelarBaixa={() => {}} onConfirmarBaixa={() => {}}
                  valorBaixa="" setValorBaixa={() => {}} dataBaixa="" setDataBaixa={() => {}}
                  formaBaixa="" setFormaBaixa={() => {}}
                  contaBaixa="" setContaBaixa={() => {}} contaBaixaId="" setContaBaixaId={() => {}}
                  confirmando={null} onAbrirConfirmar={() => {}} onCancelarConfirmar={() => {}} onConfirmarPixDeposito={() => {}}
                  contaConfirmar="" setContaConfirmar={() => {}} contaConfirmarId="" setContaConfirmarId={() => {}}
                  onMoverRecebidos={() => {}}
                  somenteLeitura
                />
              </CardGrupo>
            ))}
          </div>
        )
      )}

      {modalAberto && (
        <ClienteCadastroModal
          clientes={modalAberto.clientes}
          grupoNome={modalAberto.grupoNome}
          onClose={() => setModalAberto(null)}
          onSaved={carregar}
        />
      )}
    </div>
  );
}
