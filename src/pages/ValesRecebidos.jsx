import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, registrarBaixa, confirmarFormaPagamento, arquivarPedidos } from "../lib/pedidos";
import {
  formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO, CONTAS_PADRAO,
  pedidoEstaAtrasado, calcularPercentualAberto, tagResumoCliente, podeMoverParaRecebidos,
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
    if (!g.representante && p.clienteRepresentante) g.representante = p.clienteRepresentante;
    g.totalDevido += Number(p.valorDevido ?? p.valor);
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
  confirmando, onAbrirConfirmar, onCancelarConfirmar, onConfirmarPixDeposito,
  contaConfirmar, setContaConfirmar, contaConfirmarId, setContaConfirmarId,
  onMoverRecebidos, somenteLeitura,
}) {
  const historico = g.pedidos
    .flatMap((p) => (p.pagamentos || []).map((pg) => ({ ...pg, pedidoData: p.data })))
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  const pedidosComSaldo = somenteLeitura ? [] : g.pedidos.filter((p) => (Number(p.valorDevido ?? p.valor) - Number(p.valorPago || 0)) > 0.01);

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
              Registrar pagamento de {formatCurrency(Number(pedidosComSaldo[0].valorDevido ?? pedidosComSaldo[0].valor) - Number(pedidosComSaldo[0].valorPago || 0))}
            </button>
          ) : (
            pedidosComSaldo.map((p) => (
              <div key={p.id} className="list-item" onClick={() => onAbrirBaixa(p)}>
                <div>
                  <strong>{formatDate(p.data)}</strong>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {formatCurrency(Number(p.valorDevido ?? p.valor) - Number(p.valorPago || 0))} em aberto
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
          <div className="row">
            <button type="button" className="btn btn-ghost btn-block" onClick={onCancelarBaixa}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-block" onClick={onConfirmarBaixa}>Confirmar</button>
          </div>
        </div>
      )}

      <div className="card" style={{ background: "var(--bg)" }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Compras</h3>
        {g.pedidos.flatMap((p) => (p.itens?.length ? p.itens : [{ valor: p.valor, data: p.data }]).map((it, i) => (
          <div key={p.id + "_" + i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
            <span>{formatDate(it.data)}</span>
            <strong>{formatCurrency(it.valor)}</strong>
          </div>
        )))}
      </div>

      {g.pedidos.some((p) => p.formasPagamento?.some((f) => f.tipo === "cheque")) && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Cheques</h3>
          {g.pedidos.flatMap((p) => p.formasPagamento?.filter((f) => f.tipo === "cheque").flatMap((f, fi) =>
            (f.parcelas || []).map((parc) => (
              <div key={p.id + "_ch_" + fi + "_" + parc.numero} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <span>Folha {parc.numero} — {formatDate(parc.data)}</span>
                <strong>{formatCurrency(parc.valor)}</strong>
              </div>
            ))
          ) || [])}
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

function CardGrupo({ g, expandido, onToggle, children }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }} onClick={() => onToggle(g.chave)}>
        <div>
          <strong>{nomeExibicao(g)}</strong>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            {g.clientesNomes.size > 1 ? `${g.clientesNomes.size} CNPJs · ` : ""}
            {g.representante ? `Rep: ${g.representante} · ` : ""}
            {formatDate(g.dataMaisRecente)}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
            {formatCurrency(g.saldo)} em aberto · {g.percentual.toFixed(1)}%
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
  const [carregando, setCarregando] = useState(true);

  const [filtro, setFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState("data_desc");
  const [expandidos, setExpandidos] = useState(new Set());

  const [pedidoBaixa, setPedidoBaixa] = useState(null);
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix_ted");
  const [contaBaixa, setContaBaixa] = useState("");
  const [contaBaixaId, setContaBaixaId] = useState("");

  const [confirmando, setConfirmando] = useState(null);
  const [contaConfirmar, setContaConfirmar] = useState("");
  const [contaConfirmarId, setContaConfirmarId] = useState("");

  const [selecionadosComissao, setSelecionadosComissao] = useState(new Set());

  const [toast, setToast] = useState("");

  async function carregar() {
    setCarregando(true);
    const lista = await listarPedidos();
    setPedidos(lista);
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

  function aplicarFiltroOrdenacao(lista, campoNome, campoData, campoValor) {
    let out = lista;
    if (filtro.trim()) {
      const f = filtro.toLowerCase();
      out = out.filter((item) => campoNome(item).toLowerCase().includes(f));
    }
    const [campo, dir] = ordenacao.split("_");
    out = [...out].sort((a, b) => {
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

  const gruposVales = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidosVales),
    (g) => g.nomeGrupo || Array.from(g.clientesNomes).join(", "),
    (g) => g.dataMaisRecente,
    (g) => g.saldo
  );
  const gruposRecebidos = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidosRecebidos),
    (g) => g.nomeGrupo || Array.from(g.clientesNomes).join(", "),
    (g) => g.dataMaisRecente,
    (g) => g.totalPago
  );
  const comissoesFiltradas = aplicarFiltroOrdenacao(
    pedidosComissao,
    (p) => p.clienteNome,
    (p) => p.data,
    (p) => p.valor
  );

  function abrirBaixa(pedido) {
    const saldo = Number(pedido.valorDevido ?? pedido.valor) - Number(pedido.valorPago || 0);
    setPedidoBaixa(pedido);
    setValorBaixa(saldo.toFixed(2));
    setDataBaixa(todayISO());
    setFormaBaixa("pix_ted");
    setContaBaixa("");
    setContaBaixaId("");
  }

  async function confirmarBaixa() {
    if (!valorBaixa || Number(valorBaixa) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    await registrarBaixa(pedidoBaixa.id, pedidoBaixa, {
      valor: Number(valorBaixa),
      data: dataBaixa,
      formaPagamento: formaBaixa,
      conta: FORMAS_COM_CONTA.includes(formaBaixa) ? montarConta(contaBaixa, contaBaixaId) : null,
    });
    mostrarToast("Pagamento registrado!");
    setPedidoBaixa(null);
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
          <div className="field" style={{ marginBottom: 0, flex: "0 0 160px" }}>
            <select className="input" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)}>
              <option value="data_desc">Data (recente)</option>
              <option value="data_asc">Data (antiga)</option>
              <option value="valor_desc">Valor (maior)</option>
              <option value="valor_asc">Valor (menor)</option>
            </select>
          </div>
        </div>
      </div>

      {carregando && <div className="empty-state">Carregando...</div>}

      {!carregando && sub === "vales" && (
        gruposVales.length === 0 ? (
          <div className="empty-state">Nenhuma conta em aberto 🎉</div>
        ) : (
          <div className="lista-grid">
            {gruposVales.map((g) => (
              <CardGrupo key={g.chave} g={g} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido}>
                <DetalheExpandido
                  g={g}
                  pedidoBaixa={pedidoBaixa} onAbrirBaixa={abrirBaixa} onCancelarBaixa={() => setPedidoBaixa(null)} onConfirmarBaixa={confirmarBaixa}
                  valorBaixa={valorBaixa} setValorBaixa={setValorBaixa} dataBaixa={dataBaixa} setDataBaixa={setDataBaixa}
                  formaBaixa={formaBaixa} setFormaBaixa={setFormaBaixa}
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
              <CardGrupo key={g.chave} g={{ ...g, tag: { texto: "Pago", classe: "badge-pago" } }} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido}>
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
    </div>
  );
}
