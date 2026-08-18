import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarClientes, salvarCliente, consultarCnpj } from "../lib/clientes";
import { ESTADOS_BR } from "../lib/constants";

export default function BaseDados() {
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(null); // objeto cliente sendo editado
  const [toast, setToast] = useState("");
  const [filtro, setFiltro] = useState("");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  async function carregar() {
    setCarregando(true);
    const lista = await listarClientes();
    setClientes(lista);
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleConsultarCnpj() {
    if (!editando?.cnpj) return;
    setBuscandoCnpj(true);
    try {
      const dados = await consultarCnpj(editando.cnpj);
      setEditando((c) => ({ ...c, ...dados }));
      mostrarToast("Dados do CNPJ preenchidos");
    } catch (e) {
      mostrarToast(e.message);
    } finally {
      setBuscandoCnpj(false);
    }
  }

  async function handleSalvar(e) {
    e.preventDefault();
    if (!editando.codigo || !editando.nome) {
      mostrarToast("Preencha ao menos código e nome");
      return;
    }
    await salvarCliente(editando, editando.id || null);
    mostrarToast("Cliente salvo!");
    setEditando(null);
    carregar();
  }

  const listaFiltrada = clientes.filter((c) =>
    !filtro ||
    c.nome?.toLowerCase().includes(filtro.toLowerCase()) ||
    c.codigo?.toLowerCase().includes(filtro.toLowerCase()) ||
    c.cnpjDigits?.includes(filtro.replace(/\D/g, ""))
  );

  if (editando) {
    return (
      <div>
        {toast && <div className="toast">{toast}</div>}
        <form className="card" onSubmit={handleSalvar}>
          <h2 className="card-title">{editando.id ? "Editar cliente" : "Novo cliente"}</h2>
          <div className="row">
            <div className="field">
              <label>Código *</label>
              <input className="input" value={editando.codigo || ""}
                onChange={(e) => setEditando({ ...editando, codigo: e.target.value })} />
            </div>
            <div className="field">
              <label>CNPJ</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" value={editando.cnpj || ""}
                  onChange={(e) => setEditando({ ...editando, cnpj: e.target.value })} />
                <button type="button" className="btn btn-secondary" onClick={handleConsultarCnpj} disabled={buscandoCnpj}>
                  {buscandoCnpj ? "..." : "Buscar"}
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <label>Nome / Fantasia *</label>
            <input className="input" value={editando.nome || ""}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value })} />
          </div>
          <div className="field">
            <label>Razão Social</label>
            <input className="input" value={editando.razaoSocial || ""}
              onChange={(e) => setEditando({ ...editando, razaoSocial: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label>Cidade</label>
              <input className="input" value={editando.cidade || ""}
                onChange={(e) => setEditando({ ...editando, cidade: e.target.value })} />
            </div>
            <div className="field">
              <label>Estado</label>
              <select className="input" value={editando.estado || ""}
                onChange={(e) => setEditando({ ...editando, estado: e.target.value })}>
                <option value="">--</option>
                {ESTADOS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Representante</label>
              <input className="input" value={editando.representante || ""}
                onChange={(e) => setEditando({ ...editando, representante: e.target.value })} />
            </div>
            <div className="field">
              <label>Desconto padrão</label>
              <input className="input" value={editando.descontoPadrao || ""}
                onChange={(e) => setEditando({ ...editando, descontoPadrao: e.target.value })}
                placeholder="Ex: 5% à vista" />
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setEditando(null)}>
              Cancelar
            </button>
            <button className="btn btn-primary btn-block" type="submit">Salvar</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}
      <div className="card">
        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          <input className="input" placeholder="Buscar por nome, código ou CNPJ"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }}
            onClick={() => setEditando({ codigo: "", nome: "" })}>
            + Novo
          </button>
        </div>
      </div>

      {carregando ? (
        <div className="empty-state">Carregando clientes...</div>
      ) : listaFiltrada.length === 0 ? (
        <div className="empty-state">Nenhum cliente cadastrado ainda.</div>
      ) : (
        listaFiltrada.map((c) => (
          <div key={c.id} className="list-item" onClick={() => setEditando(c)}>
            <div>
              <strong>{c.nome}</strong>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Cód {c.codigo} · {c.cidade || "—"}/{c.estado || "—"}
              </div>
            </div>
            <span>✎</span>
          </div>
        ))
      )}
    </div>
  );
}
