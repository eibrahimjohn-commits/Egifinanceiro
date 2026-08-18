import { useEffect, useState } from "react";
import "../components/ui.css";
import { criarPagamentoSaida, listarPagamentosSaida } from "../lib/pagamentos";
import { formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO } from "../lib/constants";

const VAZIO = { destino: "", valor: "", data: todayISO(), formaPagamento: "" };

export default function Pagamentos() {
  const [form, setForm] = useState(VAZIO);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState("");

  async function carregar() {
    setCarregando(true);
    setLista(await listarPagamentosSaida());
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleSalvar(e) {
    e.preventDefault();
    if (!form.destino || !form.valor) {
      mostrarToast("Preencha destino e valor");
      return;
    }
    setSalvando(true);
    await criarPagamentoSaida({ ...form, valor: Number(form.valor) });
    mostrarToast("Pagamento registrado!");
    setForm(VAZIO);
    setSalvando(false);
    carregar();
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <form className="card" onSubmit={handleSalvar}>
        <h2 className="card-title">Registrar pagamento (saída)</h2>
        <div className="field">
          <label>Destino</label>
          <input className="input" value={form.destino}
            onChange={(e) => setForm({ ...form, destino: e.target.value })}
            placeholder="Ex: Fornecedor XYZ, aluguel, funcionário..." />
        </div>
        <div className="row">
          <div className="field">
            <label>Valor (R$)</label>
            <input className="input" type="number" step="0.01" value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </div>
          <div className="field">
            <label>Data</label>
            <input className="input" type="date" value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Forma de pagamento (opcional)</label>
          <select className="input" value={form.formaPagamento}
            onChange={(e) => setForm({ ...form, formaPagamento: e.target.value })}>
            <option value="">--</option>
            {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={salvando}>
          {salvando ? "Salvando..." : "Registrar pagamento"}
        </button>
      </form>

      <h3 style={{ margin: "20px 0 12px" }}>Histórico</h3>
      {carregando ? (
        <div className="empty-state">Carregando...</div>
      ) : lista.length === 0 ? (
        <div className="empty-state">Nenhum pagamento registrado ainda.</div>
      ) : (
        lista.map((p) => (
          <div key={p.id} className="list-item">
            <div>
              <strong>{p.destino}</strong>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {formatDate(p.data)}{p.formaPagamento ? ` · ${p.formaPagamento}` : ""}
              </div>
            </div>
            <span style={{ fontWeight: 700 }}>{formatCurrency(p.valor)}</span>
          </div>
        ))
      )}
    </div>
  );
}
