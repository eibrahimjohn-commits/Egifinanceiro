import { useEffect, useState } from "react";
import "../components/ui.css";
import {
  buscarEmpresas,
  listarProspeccoes,
  salvarProspeccao,
  atualizarProspeccao,
  CNAES_SUGERIDOS,
  STATUS_PROSPECCAO,
} from "../lib/prospeccao";
import { listarClientes, salvarCliente } from "../lib/clientes";
import { ESTADOS_BR } from "../lib/constants";

export default function Prospeccao() {
  const [aba, setAba] = useState("buscar"); // buscar | salvos

  const [cidadeNome, setCidadeNome] = useState("");
  const [uf, setUf] = useState("");
  const [cnae, setCnae] = useState(CNAES_SUGERIDOS[0].codigo);
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState("");
  const [municipioResolvido, setMunicipioResolvido] = useState(null);
  const [totalVarrido, setTotalVarrido] = useState(0);

  const [cnpjsClientes, setCnpjsClientes] = useState(new Set());
  const [prospeccoes, setProspeccoes] = useState([]);
  const [carregandoSalvos, setCarregandoSalvos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [toast, setToast] = useState("");

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function carregarSalvos() {
    setCarregandoSalvos(true);
    const [lista, clientes] = await Promise.all([listarProspeccoes(), listarClientes()]);
    setProspeccoes(lista);
    setCnpjsClientes(new Set(clientes.map((c) => c.cnpjDigits).filter(Boolean)));
    setCarregandoSalvos(false);
  }

  useEffect(() => { carregarSalvos(); }, []);

  async function handleBuscar(e) {
    e.preventDefault();
    setBuscando(true);
    setErroBusca("");
    setResultados(null);
    setMunicipioResolvido(null);
    try {
      const { empresas, municipioResolvido, totalVarrido } = await buscarEmpresas({ cidadeNome, uf, cnae });
      setResultados(empresas);
      setMunicipioResolvido(municipioResolvido);
      setTotalVarrido(totalVarrido || 0);
    } catch (err) {
      setErroBusca(err.message);
    } finally {
      setBuscando(false);
    }
  }

  async function handleAdicionar(empresa) {
    await salvarProspeccao(empresa);
    mostrarToast(`${empresa.razaoSocial || empresa.cnpj} adicionado à prospecção`);
    carregarSalvos();
  }

  async function handleMudarStatus(p, status) {
    await atualizarProspeccao(p.id, { status });
    mostrarToast("Status atualizado");
    carregarSalvos();
  }

  async function handleVirarCliente(p) {
    await salvarCliente({
      codigo: "",
      nome: p.nomeFantasia || p.razaoSocial,
      razaoSocial: p.razaoSocial,
      cnpj: p.cnpj,
      cidade: p.cidade,
      estado: p.estado,
    });
    await atualizarProspeccao(p.id, { status: "convertido" });
    mostrarToast("Cliente cadastrado na Base de Dados!");
    carregarSalvos();
  }

  const prospeccoesFiltradas = prospeccoes.filter(
    (p) => filtroStatus === "todos" || p.status === filtroStatus
  );

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (aba === "buscar" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setAba("buscar")}>
          Buscar empresas
        </button>
        <button className={"btn " + (aba === "salvos" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setAba("salvos")}>
          Prospecções salvas ({prospeccoes.length})
        </button>
      </div>

      {aba === "buscar" && (
        <>
          <form className="card" onSubmit={handleBuscar}>
            <h2 className="card-title">Buscar empresas por cidade e ramo</h2>
            <div className="row">
              <div className="field">
                <label>Cidade</label>
                <input className="input" value={cidadeNome} onChange={(e) => setCidadeNome(e.target.value)}
                  placeholder="Ex: Uberlândia" required />
              </div>
              <div className="field" style={{ flex: "0 0 110px" }}>
                <label>Estado</label>
                <select className="input" value={uf} onChange={(e) => setUf(e.target.value)}>
                  <option value="">--</option>
                  {ESTADOS_BR.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Ramo de atividade (CNAE)</label>
                <select className="input" value={cnae} onChange={(e) => setCnae(e.target.value)}>
                  {CNAES_SUGERIDOS.map((c) => <option key={c.codigo} value={c.codigo}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={buscando}>
              {buscando ? "Buscando..." : "Buscar"}
            </button>
          </form>

          {erroBusca && (
            <div className="card" style={{ color: "var(--red)", fontSize: 14 }}>{erroBusca}</div>
          )}

          {resultados && (
            resultados.length === 0 ? (
              <div className="empty-state">
                Nenhuma empresa desse ramo encontrada nas {totalVarrido} empresas verificadas
                {municipioResolvido ? ` em ${municipioResolvido.nome}` : ""}. Tente outro ramo ou confira se a cidade tem poucas empresas cadastradas nessa base.
              </div>
            ) : (
              <>
                {municipioResolvido && (
                  <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 8 }}>
                    Buscando em: <strong>{municipioResolvido.nome}</strong> · verificamos {totalVarrido} empresas da cidade, {resultados.length} bateram com o ramo escolhido
                    {totalVarrido >= 600 && " (pode haver mais — a cidade tem muitas empresas cadastradas)"}
                  </div>
                )}
                <div className="clientes-grid">
                {resultados.map((emp, i) => {
                  const jaCliente = cnpjsClientes.has(emp.cnpj?.replace(/\D/g, ""));
                  return (
                    <div key={i} className="list-item" style={{ cursor: "default" }}>
                      <div>
                        <strong>{emp.nomeFantasia || emp.razaoSocial || "(sem nome)"}</strong>
                        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                          {emp.cnpj} · {emp.cidade}/{emp.estado}
                        </div>
                        {emp.telefone && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{emp.telefone}</div>}
                      </div>
                      {jaCliente ? (
                        <span className="badge badge-pago">Já é cliente</span>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => handleAdicionar(emp)}>+ Adicionar</button>
                      )}
                    </div>
                  );
                })}
                </div>
              </>
            )
          )}
        </>
      )}

      {aba === "salvos" && (
        <>
          <div className="card" style={{ padding: 12 }}>
            <select className="input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
              <option value="todos">Todos os status</option>
              {STATUS_PROSPECCAO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {carregandoSalvos ? (
            <div className="empty-state">Carregando...</div>
          ) : prospeccoesFiltradas.length === 0 ? (
            <div className="empty-state">Nenhuma prospecção salva ainda.</div>
          ) : (
            <div className="clientes-grid">
              {prospeccoesFiltradas.map((p) => {
                const statusInfo = STATUS_PROSPECCAO.find((s) => s.value === p.status) || STATUS_PROSPECCAO[0];
                return (
                  <div key={p.id} className="card" style={{ padding: 14 }}>
                    <strong>{p.nomeFantasia || p.razaoSocial}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 8 }}>
                      {p.cnpj} · {p.cidade}/{p.estado}{p.telefone ? ` · ${p.telefone}` : ""}
                    </div>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <select className="input" value={p.status}
                        onChange={(e) => handleMudarStatus(p, e.target.value)}
                        style={{ color: statusInfo.color, fontWeight: 700 }}>
                        {STATUS_PROSPECCAO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    {p.status !== "convertido" && (
                      <button className="btn btn-secondary btn-block" onClick={() => handleVirarCliente(p)}>
                        Virar cliente
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
