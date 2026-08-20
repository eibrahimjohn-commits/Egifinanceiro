import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, registrarBaixa, confirmarFormaPagamento } from "../lib/pedidos";
import { formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO, pedidoEstaAtrasado } from "../lib/constants";

const FORMAS_COM_CONTA = ["pix_ted", "deposito"];
const FORMAS_COM_CONFIRMAR = ["pix_ted", "deposito"];

function labelForma(tipo) {
  return FORMAS_PAGAMENTO.find((f) => f.value === tipo)?.label || tipo;
}

function saldoAberto(p) {
  const devido = Number(p.valorDevido ?? p.valor);
  return devido - Number(p.valorPago || 0);
}

// Agrupa pedidos por "Grupo de cliente" (quando definido) ou por cliente individual.
function agruparPorCliente(pedidosDoStatus) {
  const grupos = new Map();
  pedidosDoStatus.forEach((p) => {
    const chave = (p.clienteGrupo || "").trim().toLowerCase() || `cli_${p.clienteId}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        nomeGrupo: (p.clienteGrupo || "").trim(),
        clientesNomes: new Set(),
        pedidos: [],
        saldoTotal: 0,
        valorTotal: 0,
        dataMaisRecente: p.data,
        atrasado: false,
      });
    }
    const g = grupos.get(chave);
    g.pedidos.push(p);
    g.clientesNomes.add(p.clienteNome);
    g.saldoTotal += saldoAberto(p);
    g.valorTotal += Number(p.valor);
    if (new Date(p.data) > new Date(g.dataMaisRecente)) g.dataMaisRecente = p.data;
    if (pedidoEstaAtrasado(p)) g.atrasado = true;
  });
  return Array.from(grupos.values());
}

export default function ValesRecebidos() {
  const [sub, setSub] = useState("vales");
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [filtro, setFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState("data_desc");

  const [clienteAberto, setClienteAberto] = useState(null); // grupo (1+ pedidos) aberto na tela de detalhe

  const [pedidoBaixa, setPedidoBaixa] = useState(null); // qual pedido do grupo está recebendo a baixa manual
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix_ted");
  const [contaBaixa, setContaBaixa] = useState("");

  const [confirmando, setConfirmando] = useState(null); // { pedido, formaIndex }
  const [contaConfirmar, setContaConfirmar] = useState("");

  const [toast, setToast] = useState("");

  async function carregar() {
    setCarregando(true);
    const lista = await listarPedidos();
    setPedidos(lista);
    setCarregando(false);
    return lista;
  }

  useEffect(() => { carregar(); }, []);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
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

  const gruposVales = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidos.filter((p) => p.status === "aberto")),
    (g) => g.nomeGrupo || Array.from(g.clientesNomes).join(", "),
    (g) => g.dataMaisRecente,
    (g) => g.saldoTotal
  );
  const gruposRecebidos = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidos.filter((p) => p.status === "pago")),
    (g) => g.nomeGrupo || Array.from(g.clientesNomes).join(", "),
    (g) => g.dataMaisRecente,
    (g) => g.valorTotal
  );

  // Reabre o mesmo grupo com dados atualizados após qualquer ação
  async function recarregarEManterAberto(chaveGrupo, statusAlvo) {
    const lista = await carregar();
    const grupos = agruparPorCliente(lista.filter((p) => p.status === statusAlvo));
    const atualizado = grupos.find((g) => g.chave === chaveGrupo);
    setClienteAberto(atualizado || null);
    if (!atualizado) {
      // o grupo pode ter mudado de aba (ex: virou "pago") — tenta achar na outra lista
      const outros = agruparPorCliente(lista.filter((p) => p.status !== statusAlvo));
      const outroGrupo = outros.find((g) => g.chave === chaveGrupo);
      if (outroGrupo) { setClienteAberto(outroGrupo); setSub(statusAlvo === "aberto" ? "recebidos" : "vales"); }
    }
  }

  function abrirBaixa(pedido) {
    setPedidoBaixa(pedido);
    setValorBaixa(saldoAberto(pedido).toFixed(2));
    setDataBaixa(todayISO());
    setFormaBaixa("pix_ted");
    setContaBaixa("");
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
      conta: FORMAS_COM_CONTA.includes(formaBaixa) ? contaBaixa : null,
    });
    mostrarToast("Pagamento registrado!");
    setPedidoBaixa(null);
    recarregarEManterAberto(clienteAberto.chave, "aberto");
  }

  function abrirConfirmar(pedido, formaIndex) {
    setConfirmando({ pedido, formaIndex });
    setContaConfirmar("");
  }

  async function confirmarPixDeposito() {
    const { pedido, formaIndex } = confirmando;
    await confirmarFormaPagamento(pedido.id, pedido, formaIndex, contaConfirmar);
    mostrarToast("Pagamento confirmado e baixado!");
    setConfirmando(null);
    recarregarEManterAberto(clienteAberto.chave, "aberto");
  }

  function FiltroOrdenacao() {
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <input className="input" placeholder="Buscar por cliente ou grupo"
              value={filtro} onChange={(e) => setFiltro(e.target.value)} />
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
    );
  }

  // ------- Tela única de detalhe do cliente/grupo: tudo visível de uma vez -------
  function DetalheCliente() {
    const g = clienteAberto;
    const totalDevido = g.pedidos.reduce((s, p) => s + Number(p.valorDevido ?? p.valor), 0);
    const totalPago = g.pedidos.reduce((s, p) => s + Number(p.valorPago || 0), 0);
    const saldo = totalDevido - totalPago;

    // histórico combinado de todos os pedidos do grupo, mais recente primeiro
    const historico = g.pedidos
      .flatMap((p) => (p.pagamentos || []).map((pg) => ({ ...pg, pedidoData: p.data })))
      .sort((a, b) => new Date(b.data) - new Date(a.data));

    const pedidosAbertos = g.pedidos.filter((p) => saldoAberto(p) > 0.01);

    return (
      <div>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>
                {g.nomeGrupo || Array.from(g.clientesNomes)[0]}
              </h2>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {g.clientesNomes.size > 1
                  ? `${g.clientesNomes.size} CNPJs: ${Array.from(g.clientesNomes).join(", ")}`
                  : "Cliente único"}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setClienteAberto(null)}>Voltar</button>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Valor total devido</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(totalDevido)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Em aberto</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: saldo > 0.01 ? "var(--red)" : "var(--green)" }}>
                {formatCurrency(Math.max(saldo, 0))}
              </div>
            </div>
          </div>
        </div>

        {/* Registrar pagamento — direto aqui, sem navegar */}
        {pedidosAbertos.length > 0 && !pedidoBaixa && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Registrar pagamento</h3>
            {pedidosAbertos.length === 1 ? (
              <button className="btn btn-primary btn-block" onClick={() => abrirBaixa(pedidosAbertos[0])}>
                Registrar pagamento de {formatCurrency(saldoAberto(pedidosAbertos[0]))}
              </button>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>
                  Esse cliente tem {pedidosAbertos.length} pedidos em aberto — escolha em qual registrar:
                </div>
                {pedidosAbertos.map((p) => (
                  <div key={p.id} className="list-item" onClick={() => abrirBaixa(p)}>
                    <div>
                      <strong>{formatDate(p.data)}</strong>
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{formatCurrency(saldoAberto(p))} em aberto</div>
                    </div>
                    <span>→</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {pedidoBaixa && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>
              Registrar pagamento — pedido de {formatDate(pedidoBaixa.data)}
            </h3>
            <div className="row">
              <div className="field">
                <label>Valor recebido</label>
                <input className="input" type="number" step="0.01" value={valorBaixa}
                  onChange={(e) => setValorBaixa(e.target.value)} />
              </div>
              <div className="field">
                <label>Data</label>
                <input className="input" type="date" value={dataBaixa}
                  onChange={(e) => setDataBaixa(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Forma de pagamento</label>
              <select className="input" value={formaBaixa} onChange={(e) => setFormaBaixa(e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            {FORMAS_COM_CONTA.includes(formaBaixa) && (
              <div className="field">
                <label>Conta</label>
                <input className="input" value={contaBaixa} onChange={(e) => setContaBaixa(e.target.value)}
                  placeholder="Ex: Banco do Brasil, Nubank..." />
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setPedidoBaixa(null)}>Cancelar</button>
              <button type="button" className="btn btn-primary btn-block" onClick={confirmarBaixa}>Confirmar</button>
            </div>
          </div>
        )}

        {/* Pedidos e formas de pagamento — tudo já visível, sem clicar de novo */}
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>
            {g.pedidos.length > 1 ? `${g.pedidos.length} pedidos` : "Pedido"}
          </h3>
          {g.pedidos.map((p) => (
            <div key={p.id} style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong style={{ fontSize: 14 }}>
                  {formatDate(p.data)} · {formatCurrency(p.valor)}
                  {p.desconto ? ` (desc. ${p.desconto})` : ""}
                </strong>
                <span className={"badge " + (saldoAberto(p) > 0.01 ? (pedidoEstaAtrasado(p) ? "badge-atraso" : "badge-aberto") : "badge-pago")}>
                  {saldoAberto(p) > 0.01 ? (pedidoEstaAtrasado(p) ? "Atrasado" : "Em aberto") : "Pago"}
                </span>
              </div>

              {p.formasPagamento?.map((f, i) => (
                <div key={i} style={{ marginBottom: 6, marginLeft: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                    <span>
                      {labelForma(f.tipo)}
                      {f.confirmado && <span style={{ color: "var(--green)", fontWeight: 700 }}> ✓ confirmado</span>}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>{formatCurrency(f.valor)}</strong>
                      {FORMAS_COM_CONFIRMAR.includes(f.tipo) && !f.confirmado && (
                        <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => abrirConfirmar(p, i)}>
                          Confirmar
                        </button>
                      )}
                    </div>
                  </div>
                  {f.tipo === "cheque" && f.parcelas?.map((parc) => (
                    <div key={parc.numero} style={{ fontSize: 12, color: "var(--ink-soft)", paddingLeft: 12 }}>
                      Folha {parc.numero}: {formatCurrency(parc.valor)} em {formatDate(parc.data)}
                    </div>
                  ))}

                  {confirmando?.pedido.id === p.id && confirmando?.formaIndex === i && (
                    <div style={{ background: "var(--bg)", borderRadius: 10, padding: 10, marginTop: 6 }}>
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>Conta que recebeu</label>
                        <input className="input" value={contaConfirmar} onChange={(e) => setContaConfirmar(e.target.value)}
                          placeholder="Ex: Banco do Brasil, Nubank..." />
                      </div>
                      <div className="row" style={{ margin: 0 }}>
                        <button type="button" className="btn btn-ghost btn-block" style={{ padding: "6px 10px", fontSize: 13 }}
                          onClick={() => setConfirmando(null)}>Cancelar</button>
                        <button type="button" className="btn btn-primary btn-block" style={{ padding: "6px 10px", fontSize: 13 }}
                          onClick={confirmarPixDeposito}>Confirmar recebimento</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {historico.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pagamentos já registrados</h3>
            {historico.map((pg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{formatDate(pg.data)} · {labelForma(pg.formaPagamento)}{pg.conta ? ` (${pg.conta})` : ""}</span>
                <strong>{formatCurrency(pg.valor)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (clienteAberto) {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <DetalheCliente />
      </div>
    );
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (sub === "vales" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setSub("vales")}>
          Vales ({gruposVales.length})
        </button>
        <button className={"btn " + (sub === "recebidos" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setSub("recebidos")}>
          Recebidos ({gruposRecebidos.length})
        </button>
      </div>

      <FiltroOrdenacao />

      {carregando && <div className="empty-state">Carregando...</div>}

      {!carregando && sub === "vales" && (
        gruposVales.length === 0 ? (
          <div className="empty-state">Nenhuma conta em aberto 🎉</div>
        ) : (
          <div className="lista-grid">
          {gruposVales.map((g) => (
            <div key={g.chave} className="list-item" onClick={() => setClienteAberto(g)}>
              <div>
                <strong>{g.nomeGrupo || Array.from(g.clientesNomes)[0]}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {g.clientesNomes.size > 1 ? `${g.clientesNomes.size} CNPJs · ` : ""}
                  {formatDate(g.dataMaisRecente)} · {formatCurrency(g.saldoTotal)} em aberto
                </div>
              </div>
              <span className={"badge " + (g.atrasado ? "badge-atraso" : "badge-aberto")}>
                {g.atrasado ? "Atrasado" : "Em aberto"}
              </span>
            </div>
          ))}
          </div>
        )
      )}

      {!carregando && sub === "recebidos" && (
        gruposRecebidos.length === 0 ? (
          <div className="empty-state">Nenhum recebimento ainda.</div>
        ) : (
          <div className="lista-grid">
          {gruposRecebidos.map((g) => (
            <div key={g.chave} className="list-item" onClick={() => setClienteAberto(g)}>
              <div>
                <strong>{g.nomeGrupo || Array.from(g.clientesNomes)[0]}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {g.clientesNomes.size > 1 ? `${g.clientesNomes.size} CNPJs · ` : ""}
                  {formatDate(g.dataMaisRecente)} · {formatCurrency(g.valorTotal)}
                </div>
              </div>
              <span className="badge badge-pago">Pago</span>
            </div>
          ))}
          </div>
        )
      )}
    </div>
  );
}
