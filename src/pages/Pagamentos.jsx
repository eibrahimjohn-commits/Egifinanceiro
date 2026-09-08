import { useEffect, useState } from "react";
import "../components/ui.css";
import { criarPagamentoSaida, listarPagamentosSaida } from "../lib/pagamentos";
import { formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO } from "../lib/constants";
import {
  listarRecorrentes, criarRecorrente, editarRecorrente, excluirRecorrente,
  marcarRecorrentePago, statusRecorrente,
} from "../lib/pagamentosRecorrentes";

const RECORRENTE_VAZIO = { nome: "", valor: "", diaVencimento: "5" };

function proximoVencimentoDoDia(dia) {
  const hoje = new Date();
  let venc = new Date(hoje.getFullYear(), hoje.getMonth(), Number(dia));
  if (venc < hoje) venc = new Date(hoje.getFullYear(), hoje.getMonth() + 1, Number(dia));
  return venc.toISOString().slice(0, 10);
}

const VAZIO = { destino: "", valor: "", data: todayISO(), formaPagamento: "" };

export default function Pagamentos() {
  const [form, setForm] = useState(VAZIO);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState("");

  const [recorrentes, setRecorrentes] = useState([]);
  const [carregandoRecorrentes, setCarregandoRecorrentes] = useState(true);
  const [mostrarTodosRecorrentes, setMostrarTodosRecorrentes] = useState(false);
  const [novoRecorrente, setNovoRecorrente] = useState(null); // form de "+ Novo" aberto
  const [editandoRecorrente, setEditandoRecorrente] = useState(null); // { id, nome, valor, diaVencimento }

  async function carregar() {
    setCarregando(true);
    setLista(await listarPagamentosSaida());
    setCarregando(false);
  }

  async function carregarRecorrentes() {
    setCarregandoRecorrentes(true);
    setRecorrentes(await listarRecorrentes());
    setCarregandoRecorrentes(false);
  }

  useEffect(() => { carregar(); carregarRecorrentes(); }, []);

  async function handleSalvarRecorrente(e) {
    e.preventDefault();
    if (!novoRecorrente.nome || !novoRecorrente.valor || !novoRecorrente.diaVencimento) {
      mostrarToast("Preencha nome, valor e dia do vencimento");
      return;
    }
    await criarRecorrente({
      nome: novoRecorrente.nome,
      valor: novoRecorrente.valor,
      diaVencimento: novoRecorrente.diaVencimento,
      proximoVencimento: proximoVencimentoDoDia(novoRecorrente.diaVencimento),
    });
    mostrarToast("Pagamento recorrente cadastrado!");
    setNovoRecorrente(null);
    carregarRecorrentes();
  }

  async function handleMarcarPago(item) {
    await marcarRecorrentePago(item.id, item);
    mostrarToast(`${item.nome} marcado como pago — próximo vencimento ajustado.`);
    carregarRecorrentes();
  }

  async function handleSalvarEdicaoRecorrente(e) {
    e.preventDefault();
    const { id, nome, valor, diaVencimento } = editandoRecorrente;
    await editarRecorrente(id, { nome, valor: Number(valor) || 0, diaVencimento: Number(diaVencimento) });
    mostrarToast("Atualizado!");
    setEditandoRecorrente(null);
    carregarRecorrentes();
  }

  async function handleExcluirRecorrente(id) {
    if (!window.confirm("Excluir esse pagamento recorrente?")) return;
    await excluirRecorrente(id);
    mostrarToast("Excluído.");
    carregarRecorrentes();
  }

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
    <div className="pagamentos-layout">
      {toast && <div className="toast">{toast}</div>}

      <div>
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
        <div className="lista-grid">
          {lista.map((p) => (
            <div key={p.id} className="list-item">
              <div>
                <strong>{p.destino}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {formatDate(p.data)}{p.formaPagamento ? ` · ${p.formaPagamento}` : ""}
                </div>
              </div>
              <span style={{ fontWeight: 700 }}>{formatCurrency(p.valor)}</span>
            </div>
          ))}
        </div>
      )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 className="card-title" style={{ marginBottom: 0 }}>Pagamentos recorrentes</h2>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
            onClick={() => setMostrarTodosRecorrentes((v) => !v)}>
            {mostrarTodosRecorrentes ? "Só pendentes" : "Ver todos"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
          Folha de pagamento, aluguel, impostos... o que se repete todo mês. Marque como pago
          quando quitar — o vencimento avança sozinho pro mês seguinte.
        </p>

        {carregandoRecorrentes ? (
          <div className="empty-state">Carregando...</div>
        ) : (
          <>
            {(() => {
              const visiveis = mostrarTodosRecorrentes
                ? recorrentes
                : recorrentes.filter((r) => statusRecorrente(r).label !== "Pago");
              if (visiveis.length === 0) {
                return <div className="empty-state" style={{ padding: 12 }}>
                  {mostrarTodosRecorrentes ? "Nenhum pagamento recorrente cadastrado." : "Nada pendente — tudo em dia. 🎉"}
                </div>;
              }
              return visiveis.map((item) => {
                const status = statusRecorrente(item);
                const editandoEsse = editandoRecorrente?.id === item.id;
                if (editandoEsse) {
                  return (
                    <form key={item.id} onSubmit={handleSalvarEdicaoRecorrente}
                      style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                      <div className="field" style={{ marginBottom: 6 }}>
                        <input className="input" style={{ padding: "6px 8px" }} value={editandoRecorrente.nome}
                          onChange={(e) => setEditandoRecorrente({ ...editandoRecorrente, nome: e.target.value })}
                          placeholder="Nome" />
                      </div>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <input className="input" style={{ padding: "6px 8px" }} type="number" step="0.01"
                          value={editandoRecorrente.valor}
                          onChange={(e) => setEditandoRecorrente({ ...editandoRecorrente, valor: e.target.value })}
                          placeholder="Valor" />
                        <input className="input" style={{ padding: "6px 8px" }} type="number" min="1" max="31"
                          value={editandoRecorrente.diaVencimento}
                          onChange={(e) => setEditandoRecorrente({ ...editandoRecorrente, diaVencimento: e.target.value })}
                          placeholder="Dia" />
                      </div>
                      <div className="row">
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
                          onClick={() => setEditandoRecorrente(null)}>Cancelar</button>
                        <button type="submit" className="btn btn-primary" style={{ fontSize: 12, padding: "6px 10px" }}>Salvar</button>
                      </div>
                    </form>
                  );
                }
                return (
                  <div key={item.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{item.nome}</strong>
                      <span className={"badge " + status.classe} style={{ flexShrink: 0 }}>{status.label}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      {formatCurrency(item.valor)} · vence dia {item.diaVencimento} ({formatDate(item.proximoVencimento)})
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {status.label !== "Pago" && (
                        <button type="button" className="btn btn-primary" style={{ fontSize: 12, padding: "6px 10px" }}
                          onClick={() => handleMarcarPago(item)}>OK — marcar pago</button>
                      )}
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
                        onClick={() => setEditandoRecorrente({ id: item.id, nome: item.nome, valor: item.valor, diaVencimento: item.diaVencimento })}>
                        Editar
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", color: "var(--red)" }}
                        onClick={() => handleExcluirRecorrente(item.id)}>
                        Excluir
                      </button>
                    </div>
                  </div>
                );
              });
            })()}
          </>
        )}

        {novoRecorrente ? (
          <form onSubmit={handleSalvarRecorrente} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, marginTop: 10 }}>
            <div className="field" style={{ marginBottom: 6 }}>
              <input className="input" style={{ padding: "6px 8px" }} value={novoRecorrente.nome}
                onChange={(e) => setNovoRecorrente({ ...novoRecorrente, nome: e.target.value })}
                placeholder="Ex: Folha de pagamento, Aluguel, Impostos..." autoFocus />
            </div>
            <div className="row" style={{ marginBottom: 6 }}>
              <input className="input" style={{ padding: "6px 8px" }} type="number" step="0.01"
                value={novoRecorrente.valor}
                onChange={(e) => setNovoRecorrente({ ...novoRecorrente, valor: e.target.value })}
                placeholder="Valor (R$)" />
              <input className="input" style={{ padding: "6px 8px" }} type="number" min="1" max="31"
                value={novoRecorrente.diaVencimento}
                onChange={(e) => setNovoRecorrente({ ...novoRecorrente, diaVencimento: e.target.value })}
                placeholder="Dia do vencimento" />
            </div>
            <div className="row">
              <button type="button" className="btn btn-ghost" onClick={() => setNovoRecorrente(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Cadastrar</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }}
            onClick={() => setNovoRecorrente({ ...RECORRENTE_VAZIO })}>
            + Novo pagamento recorrente
          </button>
        )}
      </div>
    </div>
  );
}
