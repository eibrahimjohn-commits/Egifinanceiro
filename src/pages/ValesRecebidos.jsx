import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, registrarBaixa } from "../lib/pedidos";
import { formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO, pedidoEstaAtrasado } from "../lib/constants";

const FORMAS_COM_CONTA = ["pix_ted", "deposito"];

function labelForma(tipo) {
  return FORMAS_PAGAMENTO.find((f) => f.value === tipo)?.label || tipo;
}

export default function ValesRecebidos() {
  const [sub, setSub] = useState("vales");
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const [filtro, setFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState("data_desc");

  const [detalhe, setDetalhe] = useState(null); // pedido selecionado para ver detalhes
  const [baixando, setBaixando] = useState(false); // dentro do detalhe, formulário de baixa aberto
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix_ted");
  const [contaBaixa, setContaBaixa] = useState("");
  const [toast, setToast] = useState("");

  async function carregar() {
    setCarregando(true);
    const lista = await listarPedidos();
    setPedidos(lista);
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function saldoAberto(p) {
    const devido = Number(p.valorDevido ?? p.valor);
    return devido - Number(p.valorPago || 0);
  }

  function aplicarFiltroOrdenacao(lista) {
    let out = lista;
    if (filtro.trim()) {
      const f = filtro.toLowerCase();
      out = out.filter((p) =>
        p.clienteNome?.toLowerCase().includes(f) || p.clienteCodigo?.toLowerCase().includes(f)
      );
    }
    const [campo, dir] = ordenacao.split("_");
    out = [...out].sort((a, b) => {
      let va, vb;
      if (campo === "data") { va = new Date(a.data); vb = new Date(b.data); }
      else { va = Number(a.valorDevido ?? a.valor); vb = Number(b.valorDevido ?? b.valor); }
      return dir === "asc" ? va - vb : vb - va;
    });
    return out;
  }

  const vales = aplicarFiltroOrdenacao(pedidos.filter((p) => p.status === "aberto"));
  const recebidos = aplicarFiltroOrdenacao(pedidos.filter((p) => p.status === "pago"));

  function abrirDetalhe(p) {
    setDetalhe(p);
    setBaixando(false);
  }

  function abrirBaixa() {
    setValorBaixa(saldoAberto(detalhe).toFixed(2));
    setDataBaixa(todayISO());
    setFormaBaixa("pix_ted");
    setContaBaixa("");
    setBaixando(true);
  }

  async function confirmarBaixa() {
    if (!valorBaixa || Number(valorBaixa) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    await registrarBaixa(detalhe.id, detalhe, {
      valor: Number(valorBaixa),
      data: dataBaixa,
      formaPagamento: formaBaixa,
      conta: FORMAS_COM_CONTA.includes(formaBaixa) ? contaBaixa : null,
    });
    mostrarToast("Pagamento registrado!");
    setDetalhe(null);
    setBaixando(false);
    carregar();
  }

  function FiltroOrdenacao() {
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <input className="input" placeholder="Buscar por cliente ou código"
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

  function DetalhePedido() {
    const devido = Number(detalhe.valorDevido ?? detalhe.valor);
    const saldo = devido - Number(detalhe.valorPago || 0);
    return (
      <div>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>{detalhe.clienteNome}</h2>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Cód {detalhe.clienteCodigo} · Lançado em {formatDate(detalhe.data)}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setDetalhe(null)}>Fechar</button>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Valor total do pedido</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(detalhe.valor)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Em aberto</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: saldo > 0.01 ? "var(--red)" : "var(--green)" }}>
                {formatCurrency(Math.max(saldo, 0))}
              </div>
            </div>
          </div>
          {detalhe.desconto && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>
              Desconto aplicado: {detalhe.desconto} · Valor devido: {formatCurrency(devido)}
            </div>
          )}
        </div>

        {detalhe.itens?.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Itens do pedido</h3>
            {detalhe.itens.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{formatDate(it.data)}</span>
                <strong>{formatCurrency(it.valor)}</strong>
              </div>
            ))}
          </div>
        )}

        {detalhe.formasPagamento?.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Forma(s) de pagamento combinadas</h3>
            {detalhe.formasPagamento.map((f, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span>{labelForma(f.tipo)}</span>
                  <strong>{formatCurrency(f.valor)}</strong>
                </div>
                {f.tipo === "cheque" && f.parcelas?.map((p) => (
                  <div key={p.numero} style={{ fontSize: 12, color: "var(--ink-soft)", paddingLeft: 12 }}>
                    Folha {p.numero}: {formatCurrency(p.valor)} em {formatDate(p.data)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {detalhe.pagamentos?.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pagamentos já registrados</h3>
            {detalhe.pagamentos.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{formatDate(p.data)} · {labelForma(p.formaPagamento)}{p.conta ? ` (${p.conta})` : ""}</span>
                <strong>{formatCurrency(p.valor)}</strong>
              </div>
            ))}
          </div>
        )}

        {saldo > 0.01 && !baixando && (
          <button className="btn btn-primary btn-block" onClick={abrirBaixa}>Registrar pagamento</button>
        )}

        {baixando && (
          <div className="card">
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Registrar pagamento</h3>
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
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setBaixando(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary btn-block" onClick={confirmarBaixa}>Confirmar</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (detalhe) {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <DetalhePedido />
      </div>
    );
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (sub === "vales" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setSub("vales")}>
          Vales ({vales.length})
        </button>
        <button className={"btn " + (sub === "recebidos" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setSub("recebidos")}>
          Recebidos ({recebidos.length})
        </button>
      </div>

      <FiltroOrdenacao />

      {carregando && <div className="empty-state">Carregando...</div>}

      {!carregando && sub === "vales" && (
        vales.length === 0 ? (
          <div className="empty-state">Nenhuma conta em aberto 🎉</div>
        ) : (
          vales.map((p) => {
            const saldo = saldoAberto(p);
            const atrasado = pedidoEstaAtrasado(p);
            return (
              <div key={p.id} className="list-item" onClick={() => abrirDetalhe(p)}>
                <div>
                  <strong>{p.clienteNome}</strong>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {formatDate(p.data)} · {formatCurrency(saldo)} em aberto
                  </div>
                </div>
                <span className={"badge " + (atrasado ? "badge-atraso" : "badge-aberto")}>
                  {atrasado ? "Atrasado" : "Em aberto"}
                </span>
              </div>
            );
          })
        )
      )}

      {!carregando && sub === "recebidos" && (
        recebidos.length === 0 ? (
          <div className="empty-state">Nenhum recebimento ainda.</div>
        ) : (
          recebidos.map((p) => (
            <div key={p.id} className="list-item" onClick={() => abrirDetalhe(p)}>
              <div>
                <strong>{p.clienteNome}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {formatDate(p.data)} · {formatCurrency(p.valorDevido ?? p.valor)}
                </div>
              </div>
              <span className="badge badge-pago">Pago</span>
            </div>
          ))
        )
      )}
    </div>
  );
}
