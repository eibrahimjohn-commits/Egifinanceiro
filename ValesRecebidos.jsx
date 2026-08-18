import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, registrarBaixa } from "../lib/pedidos";
import { formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO } from "../lib/constants";

export default function ValesRecebidos() {
  const [sub, setSub] = useState("vales");
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [baixando, setBaixando] = useState(null); // pedido selecionado p/ baixa
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix");
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

  const vales = pedidos.filter((p) => p.status === "aberto");
  const recebidos = pedidos.filter((p) => p.status === "pago");

  function abrirBaixa(p) {
    setBaixando(p);
    setValorBaixa((Number(p.valor) - Number(p.valorPago || 0)).toFixed(2));
    setDataBaixa(todayISO());
    setFormaBaixa("pix");
  }

  async function confirmarBaixa() {
    if (!valorBaixa || Number(valorBaixa) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    await registrarBaixa(baixando.id, baixando, {
      valor: Number(valorBaixa),
      data: dataBaixa,
      formaPagamento: formaBaixa,
    });
    mostrarToast("Pagamento registrado!");
    setBaixando(null);
    carregar();
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

      {baixando && (
        <div className="card">
          <h2 className="card-title">Registrar pagamento — {baixando.clienteNome}</h2>
          <div className="field">
            <label>Saldo em aberto</label>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {formatCurrency(Number(baixando.valor) - Number(baixando.valorPago || 0))}
            </div>
          </div>
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
          <div className="row">
            <button className="btn btn-ghost btn-block" onClick={() => setBaixando(null)}>Cancelar</button>
            <button className="btn btn-primary btn-block" onClick={confirmarBaixa}>Confirmar</button>
          </div>
        </div>
      )}

      {!baixando && carregando && <div className="empty-state">Carregando...</div>}

      {!baixando && !carregando && sub === "vales" && (
        vales.length === 0 ? (
          <div className="empty-state">Nenhuma conta em aberto 🎉</div>
        ) : (
          vales.map((p) => {
            const saldo = Number(p.valor) - Number(p.valorPago || 0);
            const atrasado = p.formaPagamento?.tipo === "cheque" && p.formaPagamento?.prazoDias
              ? new Date(p.data) < new Date(Date.now() - p.formaPagamento.prazoDias * 86400000)
              : false;
            return (
              <div key={p.id} className="list-item" onClick={() => abrirBaixa(p)}>
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

      {!baixando && !carregando && sub === "recebidos" && (
        recebidos.length === 0 ? (
          <div className="empty-state">Nenhum recebimento ainda.</div>
        ) : (
          recebidos.map((p) => (
            <div key={p.id} className="list-item">
              <div>
                <strong>{p.clienteNome}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {formatDate(p.data)} · {formatCurrency(p.valor)}
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
