import { useEffect, useRef, useState } from "react";
import "../components/ui.css";
import {
  buscarEmpresas,
  listarProspeccoes,
  salvarProspeccao,
  atualizarProspeccao,
  completarComBrasilApi,
  CNAES_SUGERIDOS,
  STATUS_PROSPECCAO,
} from "../lib/prospeccao";
import { listarClientes, salvarCliente } from "../lib/clientes";
import { ESTADOS_BR, formatCurrency } from "../lib/constants";

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
  const [amostraDebug, setAmostraDebug] = useState(null);
  const [proximaPagina, setProximaPagina] = useState(1);
  const [buscandoMais, setBuscandoMais] = useState(false);
  const [cnpjsAcumulados, setCnpjsAcumulados] = useState(new Set());
  const [completando, setCompletando] = useState(false);
  const [progressoCompletar, setProgressoCompletar] = useState(null);
  const pararCompletarRef = useRef(false);

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
    setTotalVarrido(0);
    try {
      const { empresas, municipioResolvido, totalVarrido, amostraDebug, proximaPagina } =
        await buscarEmpresas({ cidadeNome, uf, cnae, pagina: 1 });
      setResultados(empresas);
      setCnpjsAcumulados(new Set(empresas.map((e) => e.cnpj)));
      setMunicipioResolvido(municipioResolvido);
      setTotalVarrido(totalVarrido || 0);
      setAmostraDebug(amostraDebug || null);
      setProximaPagina(proximaPagina || 7);
    } catch (err) {
      setErroBusca(err.message);
    } finally {
      setBuscando(false);
    }
  }

  async function handleBuscarMais() {
    setBuscandoMais(true);
    setErroBusca("");
    try {
      const { empresas, totalVarrido, proximaPagina: prox } =
        await buscarEmpresas({ cidadeNome, uf, cnae, pagina: proximaPagina });
      const novas = empresas.filter((e) => !cnpjsAcumulados.has(e.cnpj));
      setResultados((atual) => [...(atual || []), ...novas]);
      setCnpjsAcumulados((atual) => new Set([...atual, ...novas.map((e) => e.cnpj)]));
      setTotalVarrido((atual) => atual + (totalVarrido || 0));
      setProximaPagina(prox || proximaPagina + 6);
      if (novas.length === 0) mostrarToast("Nenhuma empresa nova nesse próximo lote — tenta buscar mais uma vez");
    } catch (err) {
      setErroBusca(err.message);
    } finally {
      setBuscandoMais(false);
    }
  }

  async function handleCompletarDados() {
    setCompletando(true);
    pararCompletarRef.current = false;
    setProgressoCompletar({ feitos: 0, total: resultados.length });
    await completarComBrasilApi(resultados, {
      onItem: (index, empresaAtualizada) => {
        setResultados((atual) => {
          const copia = [...atual];
          copia[index] = empresaAtualizada;
          return copia;
        });
        setProgressoCompletar((p) => ({ feitos: (p?.feitos || 0) + 1, total: resultados.length }));
      },
      deveParar: () => pararCompletarRef.current,
    });
    setCompletando(false);
    setProgressoCompletar(null);
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
              <>
                <div className="empty-state">
                  Nenhuma empresa desse ramo encontrada nas {totalVarrido} empresas verificadas
                  {municipioResolvido ? ` em ${municipioResolvido.nome}` : ""}. Tente outro ramo, ou busque mais um lote.
                </div>
                <button className="btn btn-secondary btn-block" onClick={handleBuscarMais} disabled={buscandoMais}>
                  {buscandoMais ? "Buscando mais..." : "Buscar mais 600"}
                </button>
                {amostraDebug && (
                  <div className="card" style={{ fontSize: 11, color: "var(--ink-soft)", wordBreak: "break-all" }}>
                    <strong style={{ display: "block", marginBottom: 6, color: "var(--ink)" }}>
                      Diagnóstico técnico (manda um print disso pro Claude se o problema continuar):
                    </strong>
                    <div style={{ marginBottom: 6 }}>Campos disponíveis: {amostraDebug.camposDisponiveis.join(", ")}</div>
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>
                      {JSON.stringify(amostraDebug.primeiroRegistro, null, 2).slice(0, 1500)}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <>
                {municipioResolvido && (
                  <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 8 }}>
                    Buscando em: <strong>{municipioResolvido.nome}</strong> · verificamos {totalVarrido} empresas da cidade, {resultados.length} bateram com o ramo escolhido
                    {totalVarrido >= 600 && " (pode haver mais — a cidade tem muitas empresas cadastradas)"}
                  </div>
                )}

                {!completando ? (
                  <button className="btn btn-secondary btn-block" onClick={handleCompletarDados} style={{ marginBottom: 12 }}>
                    Completar razão social, capital social e telefone
                  </button>
                ) : (
                  <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                      Completando dados... {progressoCompletar ? `${progressoCompletar.feitos}/${progressoCompletar.total}` : ""}
                    </div>
                    <button className="btn btn-ghost" style={{ fontSize: 13, padding: "6px 12px" }}
                      onClick={() => { pararCompletarRef.current = true; }}>
                      Parar
                    </button>
                  </div>
                )}

                <div className="clientes-grid">
                {resultados.map((emp, i) => {
                  const jaCliente = cnpjsClientes.has(emp.cnpj?.replace(/\D/g, ""));
                  const ativa = (emp.situacaoCadastral || "").toUpperCase().includes("ATIVA");
                  return (
                    <div key={i} className="list-item" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong>{emp.nomeFantasia || emp.razaoSocial || "(sem nome)"}</strong>
                        {emp.situacaoCadastral && (
                          <span className={"badge " + (ativa ? "badge-pago" : "badge-atraso")} style={{ flexShrink: 0 }}>
                            {emp.situacaoCadastral}
                          </span>
                        )}
                      </div>
                      {emp.razaoSocial && emp.razaoSocial !== emp.nomeFantasia && (
                        <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{emp.razaoSocial}</div>
                      )}
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                        {emp.cnpj} · {emp.cidade}/{emp.estado}
                      </div>
                      {emp.telefone && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>📞 {emp.telefone}</div>}
                      {emp.capitalSocial != null && (
                        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Capital social: {formatCurrency(emp.capitalSocial)}</div>
                      )}
                      <div style={{ marginTop: 4 }}>
                        {jaCliente ? (
                          <span className="badge badge-pago">Já é cliente</span>
                        ) : (
                          <button className="btn btn-secondary" onClick={() => handleAdicionar(emp)}>+ Adicionar</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
                <button className="btn btn-secondary btn-block" onClick={handleBuscarMais} disabled={buscandoMais} style={{ marginTop: 12 }}>
                  {buscandoMais ? "Buscando mais..." : `Buscar mais 600 (verificadas até agora: ${totalVarrido})`}
                </button>
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
