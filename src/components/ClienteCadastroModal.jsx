import { useEffect, useState } from "react";
import {
  listarGruposUnicos, salvarCliente, consultarCnpj,
} from "../lib/clientes";
import { listarPedidos } from "../lib/pedidos";
import { ESTADOS_BR, formatCurrency, formatDate } from "../lib/constants";
import "./ClienteCadastroModal.css";

// Popup de cadastro de cliente/grupo, reutilizável em qualquer aba (Vales,
// Base de Dados, Análises...). Recebe a lista de clientes do grupo que foi
// clicado (1 item = cliente avulso, vários = grupo com múltiplos CNPJs).
//
// - 1 cliente (ou nenhum, ao criar do zero): abre direto no formulário.
// - vários clientes: abre numa lista do grupo; clicar num deles abre o
//   formulário; dá pra voltar pra lista e editar outro, ou adicionar um
//   novo CNPJ ao mesmo grupo, sem fechar o popup.
export default function ClienteCadastroModal({
  clientes, grupoNome, novo, grupoPadrao, onClose, onSaved,
}) {
  const [lista, setLista] = useState(clientes || []);
  const [editando, setEditando] = useState(() => {
    if (novo) return { grupo: grupoPadrao || "" };
    if ((clientes || []).length <= 1) return clientes?.[0] || { grupo: grupoPadrao || "" };
    return null;
  });
  const [grupos, setGrupos] = useState([]);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState("");
  const [historico, setHistorico] = useState(null); // { ultimaCompra }

  useEffect(() => { listarGruposUnicos().then(setGrupos); }, []);

  // Busca a última compra desse cliente sob demanda (só quando entra na
  // edição de um cliente já existente) — evita carregar pedidos à toa
  // enquanto o popup só está mostrando a lista do grupo.
  useEffect(() => {
    if (!editando?.id) { setHistorico(null); return; }
    let cancelado = false;
    listarPedidos().then((pedidos) => {
      if (cancelado) return;
      const doCliente = pedidos.filter((p) => p.clienteId === editando.id);
      const doSistema = doCliente.reduce((max, p) => (p.data && (!max || p.data > max) ? p.data : max), "");
      const daPlanilha = editando.ultimaCompraPlanilha;
      const ultima = doSistema && daPlanilha ? (doSistema > daPlanilha ? doSistema : daPlanilha) : (doSistema || daPlanilha);
      setHistorico({ ultimaCompra: ultima || "" });
    });
    return () => { cancelado = true; };
  }, [editando?.id]);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  async function handleConsultarCnpj() {
    if (!editando?.cnpj) return;
    setBuscandoCnpj(true);
    try {
      const dados = await consultarCnpj(editando.cnpj);
      setEditando((c) => ({
        ...c,
        razaoSocial: dados.razaoSocial || c.razaoSocial,
        cidade: dados.cidade || c.cidade,
        estado: dados.estado || c.estado,
        nome: c.nome || dados.nomeFantasia,
        infoExtra: dados.infoExtra,
      }));
      mostrarToast("Dados públicos do CNPJ preenchidos");
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
    setSalvando(true);
    const id = await salvarCliente(editando, editando.id || null);
    const salvo = { ...editando, id };
    setSalvando(false);
    mostrarToast("Cliente salvo!");
    onSaved?.(salvo);

    const eraNovo = !editando.id;
    if (lista.length <= 1 && !eraNovo) {
      // cliente avulso (não fazia parte de uma lista de grupo) — fecha normal
      onClose();
      return;
    }
    // dentro de um grupo (ou acabou de criar um novo CNPJ pro grupo):
    // atualiza a lista local e volta pra tela do grupo, sem fechar o popup
    setLista((atual) => {
      const existe = atual.some((c) => c.id === id);
      return existe ? atual.map((c) => (c.id === id ? salvo : c)) : [...atual, salvo];
    });
    setEditando(null);
  }

  const mostrandoLista = editando === null;
  const tituloGrupo = grupoNome || lista[0]?.grupo || "Grupo";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        {toast && <div className="toast" style={{ position: "absolute" }}>{toast}</div>}
        <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">×</button>

        {mostrandoLista ? (
          <>
            <h2 className="card-title">{tituloGrupo}</h2>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
              {lista.length} cadastro{lista.length === 1 ? "" : "s"} nesse grupo — clique num deles pra editar.
            </div>
            {lista.map((c) => (
              <div key={c.id} className="list-item" onClick={() => setEditando(c)}
                style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <strong>{c.nome}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  Cód {c.codigo} · {c.cidade || "—"}/{c.estado || "—"}
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }}
              onClick={() => setEditando({ grupo: tituloGrupo })}>
              + Adicionar novo CNPJ a este grupo
            </button>
          </>
        ) : (
          <form onSubmit={handleSalvar}>
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
              <div className="field">
                <label>Prazo de pagamento (dias)</label>
                <input className="input" type="number" min="0" value={editando.prazo || ""}
                  onChange={(e) => setEditando({ ...editando, prazo: e.target.value })}
                  placeholder="Ex: 30" />
              </div>
            </div>

            <div className="field">
              <label>Grupo de cliente</label>
              <input className="input" list="lista-grupos-modal" value={editando.grupo || ""}
                onChange={(e) => setEditando({ ...editando, grupo: e.target.value })}
                placeholder="Ex: Rede Bijoux Ltda (deixe em branco se for cliente único)" />
              <datalist id="lista-grupos-modal">
                {grupos.map((g) => <option key={g} value={g} />)}
              </datalist>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
                Clientes com o mesmo grupo têm as compras somadas juntas na aba Vales.
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>Telefone</label>
                <input className="input" value={(editando.telefones || [])[0] || ""}
                  onChange={(e) => {
                    const tels = [...(editando.telefones || [])];
                    tels[0] = e.target.value;
                    setEditando({ ...editando, telefones: tels });
                  }} />
              </div>
              <div className="field">
                <label>WhatsApp</label>
                <input className="input" value={editando.whatsapp || ""}
                  onChange={(e) => setEditando({ ...editando, whatsapp: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Telefone alternativo</label>
                <input className="input" value={(editando.telefones || [])[1] || ""}
                  onChange={(e) => {
                    const tels = [...(editando.telefones || [])];
                    tels[1] = e.target.value;
                    setEditando({ ...editando, telefones: tels });
                  }} />
              </div>
              <div className="field">
                <label>Pessoa de contato</label>
                <input className="input" value={editando.contato || ""}
                  onChange={(e) => setEditando({ ...editando, contato: e.target.value })} />
              </div>
            </div>

            <div className="field">
              <label>Observação</label>
              <textarea className="input" rows={3} value={editando.observacao || ""}
                onChange={(e) => setEditando({ ...editando, observacao: e.target.value })}
                placeholder="Anotações livres sobre esse cliente..." />
            </div>

            {editando.id && (
              <div className="field" style={{ background: "var(--bg)", borderRadius: 12, padding: 14 }}>
                <label style={{ marginBottom: 4 }}>Histórico</label>
                <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                  <div>
                    Última compra:{" "}
                    <strong>
                      {historico
                        ? (historico.ultimaCompra ? formatDate(historico.ultimaCompra) : "sem registro")
                        : "carregando..."}
                    </strong>
                  </div>
                  {editando.mediaCompra > 0 && (
                    <div>Média de compra: <strong>{formatCurrency(editando.mediaCompra)}</strong></div>
                  )}
                </div>
              </div>
            )}

            {editando.infoExtra && (
              <div className="field" style={{ background: "var(--bg)", borderRadius: 12, padding: 14 }}>
                <label style={{ marginBottom: 8 }}>Informações públicas (Receita Federal)</label>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}>
                  {editando.infoExtra.situacaoCadastral && <div>Situação cadastral: <strong style={{ color: "var(--ink)" }}>{editando.infoExtra.situacaoCadastral}</strong></div>}
                  {editando.infoExtra.telefones?.length > 0
                    ? editando.infoExtra.telefones.map((t, i) => (
                        <div key={i}>Telefone {i + 1}: <strong style={{ color: "var(--ink)" }}>{t}</strong></div>
                      ))
                    : <div>Telefone: <em>não consta na base pública</em></div>}
                  {editando.infoExtra.email && <div>E-mail: <strong style={{ color: "var(--ink)" }}>{editando.infoExtra.email}</strong></div>}
                  {editando.infoExtra.porte && <div>Porte: <strong style={{ color: "var(--ink)" }}>{editando.infoExtra.porte}</strong></div>}
                  {editando.infoExtra.capitalSocial != null && <div>Capital social: <strong style={{ color: "var(--ink)" }}>{formatCurrency(editando.infoExtra.capitalSocial)}</strong></div>}
                  {editando.infoExtra.atividadePrincipal && <div>Atividade principal: <strong style={{ color: "var(--ink)" }}>{editando.infoExtra.atividadePrincipal}</strong></div>}
                </div>
              </div>
            )}

            <div className="row">
              <button type="button" className="btn btn-ghost btn-block"
                onClick={() => (lista.length > 1 ? setEditando(null) : onClose())}>
                {lista.length > 1 ? "← Voltar" : "Cancelar"}
              </button>
              <button className="btn btn-primary btn-block" type="submit" disabled={salvando}>
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
