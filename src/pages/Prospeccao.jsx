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
  TERMOS_SUGERIDOS,
  buscarLojas,
  listarDescartados,
  descartarLoja,
  procurarCnpjDaLoja,
} from "../lib/prospeccao";
import { listarClientes, salvarCliente, consultarCnpj } from "../lib/clientes";
import { ESTADOS_BR, formatCurrency } from "../lib/constants";

export default function Prospeccao() {
  const [aba, setAba] = useState("lojas"); // lojas | buscar | salvos

  // --- Busca de lojas pelo Google Maps ---
  const [termoLoja, setTermoLoja] = useState(TERMOS_SUGERIDOS[0]);
  const [cidadeLoja, setCidadeLoja] = useState("");
  const [ufLoja, setUfLoja] = useState("");
  const [lojas, setLojas] = useState(null);
  const [buscandoLojas, setBuscandoLojas] = useState(false);
  const [erroLojas, setErroLojas] = useState("");
  const [tokenLojas, setTokenLojas] = useState(null);
  const [descartados, setDescartados] = useState(new Set());
  const [dadosCnpj, setDadosCnpj] = useState({}); // placeId -> { estado, candidatos, escolhido }

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

  useEffect(() => { listarDescartados().then(setDescartados).catch(() => {}); }, []);

  async function handleBuscarLojas(continuar = false) {
    if (!cidadeLoja.trim()) { setErroLojas("Informe a cidade."); return; }
    setBuscandoLojas(true);
    setErroLojas("");
    try {
      const r = await buscarLojas({
        termo: termoLoja, cidade: cidadeLoja, uf: ufLoja,
        pageToken: continuar ? tokenLojas : "",
      });
      // Filtra as que você já descartou antes — o ponto do descarte é
      // justamente não revisitar o que já foi avaliado.
      const novas = r.lojas.filter((l) => !descartados.has(l.placeId));
      setLojas((atual) => (continuar && atual ? [...atual, ...novas] : novas));
      setTokenLojas(r.proximoPageToken);
    } catch (err) {
      setErroLojas(err.message);
    } finally {
      setBuscandoLojas(false);
    }
  }

  async function handleProcurarCnpj(loja) {
    setDadosCnpj((a) => ({ ...a, [loja.placeId]: { estado: "buscando" } }));
    try {
      const candidatos = await procurarCnpjDaLoja({
        nome: loja.nome, endereco: loja.endereco, cidade: cidadeLoja, uf: ufLoja,
      });
      setDadosCnpj((a) => ({
        ...a,
        [loja.placeId]: candidatos.length ? { estado: "escolher", candidatos } : { estado: "vazio" },
      }));
    } catch (err) {
      setDadosCnpj((a) => ({ ...a, [loja.placeId]: { estado: "erro", mensagem: err.message } }));
    }
  }

  // Depois que a pessoa confirma qual CNPJ é, aí sim buscamos os dados
  // completos (capital social, situação, porte...) na base pública — essa
  // parte é confiável, porque a partir do CNPJ não há ambiguidade.
  async function handleConfirmarCnpj(loja, cnpj) {
    setDadosCnpj((a) => ({ ...a, [loja.placeId]: { estado: "buscando" } }));
    try {
      const dados = await consultarCnpj(cnpj);
      setDadosCnpj((a) => ({ ...a, [loja.placeId]: { estado: "pronto", cnpj, dados } }));
    } catch (err) {
      setDadosCnpj((a) => ({ ...a, [loja.placeId]: { estado: "erro", mensagem: err.message } }));
    }
  }

  async function handleDescartar(loja) {
    await descartarLoja(loja);
    setDescartados((atual) => new Set(atual).add(loja.placeId));
    setLojas((atual) => (atual || []).filter((l) => l.placeId !== loja.placeId));
  }

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
        <button className={"btn " + (aba === "lojas" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setAba("lojas")}>
          Buscar lojas (Maps)
        </button>
        <button className={"btn " + (aba === "buscar" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setAba("buscar")}>
          Por CNAE
        </button>
        <button className={"btn " + (aba === "salvos" ? "btn-primary" : "btn-ghost")}
          style={{ flex: 1 }} onClick={() => setAba("salvos")}>
          Prospecções salvas ({prospeccoes.length})
        </button>
      </div>

      {aba === "lojas" && (
        <>
          <div className="card">
            <h2 className="card-title">Buscar lojas no Google Maps</h2>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
              Traz lojas que existem de fato, com telefone e endereço. Diferente da busca por
              CNAE, aqui não depende do lojista ter registrado a atividade "certa" na Receita.
            </p>
            <div className="row">
              <div className="field">
                <label>O que buscar</label>
                <input className="input" list="termos-sugeridos" value={termoLoja}
                  onChange={(e) => setTermoLoja(e.target.value)} placeholder="Ex: bijuteria" />
                <datalist id="termos-sugeridos">
                  {TERMOS_SUGERIDOS.map((t) => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div className="field">
                <label>Cidade</label>
                <input className="input" value={cidadeLoja}
                  onChange={(e) => setCidadeLoja(e.target.value)} placeholder="Ex: Porto Alegre" />
              </div>
              <div className="field" style={{ flex: "0 0 110px" }}>
                <label>Estado</label>
                <select className="input" value={ufLoja} onChange={(e) => setUfLoja(e.target.value)}>
                  <option value="">--</option>
                  {ESTADOS_BR.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => handleBuscarLojas(false)} disabled={buscandoLojas}>
              {buscandoLojas ? "Buscando..." : "Buscar"}
            </button>
            {descartados.size > 0 && (
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>
                {descartados.size} loja(s) já descartada(s) — elas não voltam a aparecer nas buscas.
              </div>
            )}
          </div>

          {erroLojas && <div className="card" style={{ color: "var(--red)", fontSize: 14 }}>{erroLojas}</div>}

          {lojas && lojas.length === 0 && !buscandoLojas && (
            <div className="empty-state">Nenhuma loja nova encontrada. Tente outro termo ou outra cidade.</div>
          )}

          {lojas && lojas.length > 0 && (
            <>
              <div className="lista-grid">
                {lojas.map((l) => (
                  <div key={l.placeId} className="card" style={{ padding: 14 }}>
                    <strong>{l.nome}</strong>
                    {l.categoria && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{l.categoria}</div>}
                    <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>{l.endereco}</div>
                    {l.telefone && <div style={{ fontSize: 13, marginTop: 4 }}>📞 {l.telefone}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {l.telefone && (
                        <a className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 10px" }}
                          href={`https://wa.me/55${l.telefone.replace(/\D/g, "")}`}
                          target="_blank" rel="noopener noreferrer">WhatsApp</a>
                      )}
                      {l.site && (
                        <a className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
                          href={l.site} target="_blank" rel="noopener noreferrer">Site</a>
                      )}
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", color: "var(--red)" }}
                        onClick={() => handleDescartar(l)}>Descartar</button>
                    </div>

                    {(() => {
                      const info = dadosCnpj[l.placeId];
                      if (!info) return (
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px", marginTop: 6 }}
                          onClick={() => handleProcurarCnpj(l)}>Procurar CNPJ</button>
                      );
                      if (info.estado === "buscando") return <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>Procurando...</div>;
                      if (info.estado === "vazio") return <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>Nenhum CNPJ parecido encontrado nessa cidade.</div>;
                      if (info.estado === "erro") return <div style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{info.mensagem}</div>;
                      if (info.estado === "escolher") return (
                        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
                            Possíveis CNPJs — confirme qual é o correto:
                          </div>
                          {info.candidatos.map((c) => (
                            <div key={c.cnpj} style={{ fontSize: 12, marginBottom: 6 }}>
                              <div><strong>{c.razaoSocial || "(sem nome)"}</strong> · {c.nota}% de semelhança</div>
                              <div style={{ color: "var(--ink-soft)" }}>{c.logradouro} {c.bairro && "· " + c.bairro}</div>
                              <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 8px", marginTop: 3 }}
                                onClick={() => handleConfirmarCnpj(l, c.cnpj)}>É esse ({c.cnpj})</button>
                            </div>
                          ))}
                        </div>
                      );
                      if (info.estado === "pronto") return (
                        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 12, lineHeight: 1.7 }}>
                          <div>CNPJ: <strong>{info.cnpj}</strong></div>
                          <div>Razão social: <strong>{info.dados.razaoSocial}</strong></div>
                          {info.dados.infoExtra?.situacaoCadastral && <div>Situação: <strong>{info.dados.infoExtra.situacaoCadastral}</strong></div>}
                          {info.dados.infoExtra?.capitalSocial != null && <div>Capital social: <strong>{formatCurrency(info.dados.infoExtra.capitalSocial)}</strong></div>}
                          {info.dados.infoExtra?.porte && <div>Porte: <strong>{info.dados.infoExtra.porte}</strong></div>}
                          {info.dados.infoExtra?.atividadePrincipal && <div>Atividade: {info.dados.infoExtra.atividadePrincipal}</div>}
                        </div>
                      );
                      return null;
                    })()}
                  </div>
                ))}
              </div>
              {tokenLojas && (
                <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }}
                  onClick={() => handleBuscarLojas(true)} disabled={buscandoLojas}>
                  {buscandoLojas ? "Buscando..." : "Buscar mais resultados"}
                </button>
              )}
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10 }}>
                O Google devolve no máximo 60 resultados por termo. Para ampliar a cobertura,
                repita a busca variando o termo (ex: "bijuteria", depois "acessórios femininos",
                depois "loja de presentes") ou busque por bairro.
              </div>
            </>
          )}
        </>
      )}

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
                    {totalVarrido >= 800 && " — cidades grandes têm dezenas de milhares de empresas cadastradas, então use \"Buscar mais\" algumas vezes para aumentar a cobertura"}
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
                  {buscandoMais ? "Buscando mais..." : `Buscar mais 800 (verificadas até agora: ${totalVarrido})`}
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
