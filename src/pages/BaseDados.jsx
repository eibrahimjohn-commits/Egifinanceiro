import { useEffect, useRef, useState } from "react";
import "../components/ui.css";
import { listarClientes, importarClientes, enriquecerClientesEmLote, analisarDuplicados, removerDuplicados } from "../lib/clientes";
import { listarPedidos } from "../lib/pedidos";
import { lerPlanilhaClientes } from "../lib/importarPlanilha";
import { ESTADOS_BR, formatDate } from "../lib/constants";
import ClienteCadastroModal from "../components/ClienteCadastroModal";

// Mesma chave usada em Vales e Recebidos: agrupa pelo campo "Grupo de
// cliente" (normalizado), e cai para um grupo de 1 (o próprio cliente)
// quando não tem grupo definido.
function chaveGrupoCliente(c) {
  return (c.grupo || "").trim().toLowerCase() || `cli_${c.id}`;
}

// Padrão de exibição idêntico ao de Vales e Recebidos: "Nome (Representante)",
// usando o nome do grupo quando existir, senão o nome do primeiro cliente.
function nomeExibicaoGrupo(g) {
  const nomeBase = g.nomeGrupo || g.clientes[0]?.nome || "";
  return g.representante ? `${nomeBase} (${g.representante})` : nomeBase;
}

// Card de um grupo de clientes — clique no cabeçalho expande e mostra os
// cadastros individuais (CNPJs) daquele grupo. Hoisted fora do corpo da
// página para não perder o estado ao re-renderizar a cada tecla do filtro.
function CardGrupoCliente({ g, expandido, onToggle, onAbrirGrupo, onAbrirCliente }) {
  const badge = g.situacaoAtiva
    ? { texto: "ATIVA", classe: "badge-pago" }
    : g.situacaoInativa
    ? { texto: "INATIVA", classe: "badge-atraso" }
    : null;

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => onToggle(g.chave)} onDoubleClick={() => onAbrirGrupo(g)}>
        <div>
          <strong>{nomeExibicaoGrupo(g)}</strong>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            {g.clientes.length > 1 ? `${g.clientes.length} CNPJs · ` : ""}
            {g.cidade ? `${g.cidade}/${g.estado || "—"}` : "cidade não informada"}
          </div>
          {g.telefone && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{g.telefone}</div>
          )}
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
            Última compra: {g.ultimaCompra ? formatDate(g.ultimaCompra) : "sem registro"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          {badge && <span className={"badge " + badge.classe}>{badge.texto}</span>}
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{expandido ? "▲" : "▼"}</span>
        </div>
      </div>
      {expandido && (
        <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
          {g.clientes.map((c) => {
            const situacao = c.infoExtra?.situacaoCadastral;
            const ativa = situacao?.toUpperCase().includes("ATIVA");
            return (
              <div key={c.id} className="list-item" onDoubleClick={() => onAbrirCliente(c)}
                style={{ flexDirection: "column", alignItems: "stretch", gap: 4, cursor: "default" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>{c.nome}</strong>
                  {situacao && (
                    <span className={"badge " + (ativa ? "badge-pago" : "badge-atraso")} style={{ flexShrink: 0 }}>
                      {situacao}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  Cód {c.codigo} · {c.cidade || "—"}/{c.estado || "—"}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>Duplo clique para editar</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BaseDados() {
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(null); // { clientes, grupoNome } | { novo: true, grupoPadrao }
  const [toast, setToast] = useState("");
  const [filtro, setFiltro] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [ordenacao, setOrdenacao] = useState("nome_asc");
  const [somenteAtivos, setSomenteAtivos] = useState(false);

  const [importando, setImportando] = useState(false);
  const [preview, setPreview] = useState(null); // { linhas, aba }
  const [progresso, setProgresso] = useState(null);
  const [ultimoPedidoPorCliente, setUltimoPedidoPorCliente] = useState({});
  const [enriquecendo, setEnriquecendo] = useState(false);
  const [progressoEnriq, setProgressoEnriq] = useState(null);
  const pararEnriqRef = useRef(false);
  const [analiseDup, setAnaliseDup] = useState(null);
  const [removendoDup, setRemovendoDup] = useState(false);
  const [gruposExpandidos, setGruposExpandidos] = useState(new Set());

  function toggleGrupoExpandido(chave) {
    setGruposExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  }

  function abrirGrupo(g) {
    setModalAberto({ clientes: g.clientes, grupoNome: nomeExibicaoGrupo(g) });
  }

  function abrirCliente(c) {
    setModalAberto({ clientes: [c] });
  }

  async function carregar() {
    setCarregando(true);
    const [lista, pedidos] = await Promise.all([listarClientes(), listarPedidos()]);
    setClientes(lista);

    const mapa = {};
    pedidos.forEach((ped) => {
      const atual = mapa[ped.clienteId];
      if (!atual || new Date(ped.data) > new Date(atual)) mapa[ped.clienteId] = ped.data;
    });
    setUltimoPedidoPorCliente(mapa);

    setCarregando(false);
  }

  function handleAnalisarDuplicados() {
    const resultado = analisarDuplicados(clientes);
    setAnaliseDup(resultado);
    if (resultado.paraRemover.length === 0) {
      mostrarToast("Nenhum cadastro duplicado encontrado.");
    }
  }

  async function handleRemoverDuplicados() {
    if (!analiseDup) return;
    setRemovendoDup(true);
    try {
      const n = await removerDuplicados(analiseDup.paraRemover);
      mostrarToast(`${n} cadastros duplicados removidos.`);
      setAnaliseDup(null);
      await carregar();
    } catch (err) {
      mostrarToast("Erro ao remover: " + err.message);
    } finally {
      setRemovendoDup(false);
    }
  }

  async function handleEnriquecerTodos() {
    setEnriquecendo(true);
    pararEnriqRef.current = false;
    setProgressoEnriq({ feitos: 0, total: 0, sucesso: 0, falhas: 0 });
    try {
      const resultado = await enriquecerClientesEmLote({
        clientes,
        onProgresso: setProgressoEnriq,
        deveParar: () => pararEnriqRef.current,
      });
      mostrarToast(`Concluído: ${resultado.sucesso} atualizados, ${resultado.falhas} sem retorno.`);
      carregar();
    } catch (err) {
      mostrarToast("Erro: " + err.message);
    } finally {
      setEnriquecendo(false);
      setProgressoEnriq(null);
    }
  }

  useEffect(() => { carregar(); }, []);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }


  async function handleArquivoSelecionado(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const resultado = await lerPlanilhaClientes(file);
      if (resultado.linhas.length === 0) {
        mostrarToast("Não encontrei nenhuma linha válida nessa planilha");
        return;
      }
      setPreview(resultado);
    } catch (err) {
      mostrarToast(err.message);
    }
  }

  async function confirmarImportacao() {
    if (!preview) return;
    setImportando(true);
    setProgresso({ feitos: 0, total: preview.linhas.length });
    const totalPlanilha = preview.linhas.length;
    try {
      await importarClientes(preview.linhas, (feitos, total) => setProgresso({ feitos, total }));
      setPreview(null);
      const lista = await listarClientes();
      setClientes(lista);
      if (lista.length < totalPlanilha) {
        mostrarToast(
          `${totalPlanilha} linhas enviadas, mas a base tem ${lista.length}. Alguns códigos podem se repetir entre importações.`
        );
      } else {
        mostrarToast(`${totalPlanilha} clientes importados. Base agora tem ${lista.length}.`);
      }
      carregar();
    } catch (err) {
      mostrarToast("Erro ao importar: " + err.message);
    } finally {
      setImportando(false);
      setProgresso(null);
    }
  }

  function ultimaCompraDe(c) {
    const doSistema = ultimoPedidoPorCliente[c.id];
    const daPlanilha = c.ultimaCompraPlanilha;
    if (doSistema && daPlanilha) return doSistema > daPlanilha ? doSistema : daPlanilha;
    return doSistema || daPlanilha || "";
  }

  const pendentesEnriquecimento = clientes.filter(
    (c) => (c.cnpj || "").replace(/\D/g, "").length === 14 && !c.infoExtra?.consultadoEm
  ).length;

  const estadosPresentes = Array.from(
    new Set(clientes.map((c) => (c.estado || "").trim().toUpperCase()).filter(Boolean))
  ).sort();

  function dataCadastroDe(c) {
    return c.createdAt?.seconds ? c.createdAt.seconds * 1000 : (c.updatedAt?.seconds ? c.updatedAt.seconds * 1000 : 0);
  }

  function clienteEstaAtivo(c) {
    return (c.infoExtra?.situacaoCadastral || "").toUpperCase().includes("ATIVA");
  }

  const clientesComSituacao = clientes.filter((c) => c.infoExtra?.situacaoCadastral).length;

  const listaFiltrada = clientes.filter((c) => {
    if (filtroEstado && (c.estado || "").toUpperCase() !== filtroEstado) return false;
    if (somenteAtivos && !clienteEstaAtivo(c)) return false;
    if (!filtro) return true;
    const termo = filtro.toLowerCase().trim();
    const digitos = filtro.replace(/\D/g, "");
    const telefones = [...(c.telefones || []), c.whatsapp || ""].join(" ");
    return (
      (c.nome || "").toLowerCase().includes(termo) ||
      (c.razaoSocial || "").toLowerCase().includes(termo) ||
      (c.codigo || "").toLowerCase().includes(termo) ||
      (c.cidade || "").toLowerCase().includes(termo) ||
      (c.representante || "").toLowerCase().includes(termo) ||
      (c.grupo || "").toLowerCase().includes(termo) ||
      (digitos.length >= 3 && (c.cnpjDigits || "").includes(digitos)) ||
      (digitos.length >= 4 && telefones.includes(digitos))
    );
  });

  // Agrupa os clientes já filtrados pelo campo "Grupo de cliente" — mesma
  // lógica usada em Vales e Recebidos. Cada grupo soma cidade/estado,
  // telefone, representante, situação cadastral (ativo se qualquer CNPJ do
  // grupo estiver ativo) e a última compra mais recente entre os CNPJs.
  function agruparClientes(lista) {
    const grupos = new Map();
    lista.forEach((c) => {
      const chave = chaveGrupoCliente(c);
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          chave,
          nomeGrupo: (c.grupo || "").trim(),
          clientes: [],
          representante: "",
          cidade: "",
          estado: "",
          telefone: "",
          situacaoAtiva: false,
          situacaoInativa: false,
          ultimaCompra: "",
          dataCadastro: 0,
        });
      }
      const g = grupos.get(chave);
      g.clientes.push(c);
      if (!g.representante && c.representante) g.representante = c.representante;
      if (!g.cidade && c.cidade) { g.cidade = c.cidade; g.estado = c.estado; }
      if (!g.telefone) g.telefone = c.whatsapp || c.telefones?.[0] || c.infoExtra?.telefone || "";
      const situacao = c.infoExtra?.situacaoCadastral;
      if (situacao) {
        if (situacao.toUpperCase().includes("ATIVA")) g.situacaoAtiva = true;
        else g.situacaoInativa = true;
      }
      const ultimoDesteCliente = ultimaCompraDe(c);
      if (ultimoDesteCliente && (!g.ultimaCompra || new Date(ultimoDesteCliente) > new Date(g.ultimaCompra))) {
        g.ultimaCompra = ultimoDesteCliente;
      }
      const dataCad = dataCadastroDe(c);
      if (dataCad > g.dataCadastro) g.dataCadastro = dataCad;
    });
    return Array.from(grupos.values());
  }

  const gruposFiltrados = agruparClientes(listaFiltrada).sort((a, b) => {
    const [campo, dir] = ordenacao.split("_");
    const mult = dir === "asc" ? 1 : -1;
    if (campo === "nome") return mult * nomeExibicaoGrupo(a).localeCompare(nomeExibicaoGrupo(b), "pt-BR");
    if (campo === "razaoSocial") {
      const ra = a.clientes[0]?.razaoSocial || "";
      const rb = b.clientes[0]?.razaoSocial || "";
      return mult * ra.localeCompare(rb, "pt-BR");
    }
    if (campo === "estado") return mult * (a.estado || "").localeCompare(b.estado || "", "pt-BR");
    if (campo === "cadastro") return mult * (a.dataCadastro - b.dataCadastro);
    if (campo === "ultimaCompra") {
      const da = new Date(a.ultimaCompra || 0).getTime();
      const db_ = new Date(b.ultimaCompra || 0).getTime();
      return mult * (da - db_);
    }
    return 0;
  });

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="ferramentas-grid">
      <div className={"card ferramenta-card" + (preview || importando ? " ferramenta-expandida" : "")}>
        <h2 className="card-title">Importar planilha</h2>
        {!preview ? (
          <>
            <p className="ferramenta-desc" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>
              Envie um .xlsx com colunas de código, nome, razão social, CNPJ, cidade e UF.
              Clientes com o mesmo código são atualizados, não duplicados.
            </p>
            <label className="btn btn-secondary btn-block" style={{ cursor: "pointer" }}>
              Escolher arquivo .xlsx
              <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={handleArquivoSelecionado} />
            </label>
          </>
        ) : importando ? (
          <div className="empty-state">
            Importando... {progresso ? `${progresso.feitos}/${progresso.total}` : ""}
          </div>
        ) : (
          <>
            <p style={{ fontSize: 14, marginBottom: 10 }}>
              Encontrei <strong>{preview.linhas.length}</strong> clientes na aba "{preview.aba}".
            </p>
            {preview.diagnostico && (
              <div style={{ background: "var(--bg)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.7 }}>
                <div>Linhas na planilha: <strong style={{ color: "var(--ink)" }}>{preview.diagnostico.totalLinhas}</strong></div>
                <div>Serão importadas: <strong style={{ color: "var(--ink)" }}>{preview.linhas.length}</strong></div>
                {preview.diagnostico.ignoradasVazias > 0 && (
                  <div>Linhas totalmente vazias ignoradas: {preview.diagnostico.ignoradasVazias}</div>
                )}
                <div style={{ marginTop: 6 }}>
                  CNPJ: {preview.diagnostico.cnpj} · CPF: {preview.diagnostico.cpf} · sem documento: {preview.diagnostico.semDocumento}
                </div>
                {preview.diagnostico.semCodigo > 0 && (
                  <div>Sem código (serão importados mesmo assim): {preview.diagnostico.semCodigo}</div>
                )}
                <div>
                  Com telefone/WhatsApp: <strong style={{ color: "var(--ink)" }}>{preview.diagnostico.comTelefone}</strong>
                  {" · "}Com data de última compra: <strong style={{ color: "var(--ink)" }}>{preview.diagnostico.comUltimaCompra}</strong>
                </div>
                {preview.diagnostico.zerosRecuperados > 0 && (
                  <div style={{ color: "var(--grape)", fontWeight: 600 }}>
                    {preview.diagnostico.zerosRecuperados} documentos tiveram zeros à esquerda recuperados
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>Prévia:</div>
            {preview.linhas.slice(0, 5).map((c, i) => (
              <div key={i} style={{ fontSize: 13, color: "var(--ink-soft)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                {c.codigo || "(sem cód)"} · {c.nome} · {c.cidade || "—"}/{c.estado || "—"}
              </div>
            ))}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setPreview(null)}>Cancelar</button>
              <button className="btn btn-primary btn-block" onClick={confirmarImportacao}>
                Importar {preview.linhas.length} clientes
              </button>
            </div>
          </>
        )}
      </div>

      <div className={"card ferramenta-card" + (analiseDup || removendoDup ? " ferramenta-expandida" : "")}>
        <h2 className="card-title">Limpar duplicados</h2>
        {!analiseDup ? (
          <>
            <p className="ferramenta-desc" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>
              Procura clientes repetidos (mesmo código, CNPJ ou nome) e mantém sempre o
              cadastro mais completo. Nada é apagado sem você confirmar.
            </p>
            <button className="btn btn-secondary btn-block" onClick={handleAnalisarDuplicados}>
              Procurar duplicados
            </button>
          </>
        ) : removendoDup ? (
          <div className="empty-state">Removendo duplicados...</div>
        ) : (
          <>
            <div style={{ background: "var(--bg)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}>
              <div>Cadastros hoje: <strong style={{ color: "var(--ink)" }}>{analiseDup.totalAtual}</strong></div>
              <div>Clientes com cópias: <strong style={{ color: "var(--ink)" }}>{analiseDup.gruposComDuplicata}</strong></div>
              <div style={{ color: "var(--red)" }}>Serão removidos: <strong>{analiseDup.paraRemover.length}</strong></div>
              <div>Ficará com: <strong style={{ color: "var(--green)" }}>{analiseDup.totalDepois}</strong> clientes</div>
            </div>
            {analiseDup.paraRemover.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>
                  Exemplos do que será removido:
                </div>
                {analiseDup.paraRemover.slice(0, 5).map((c) => (
                  <div key={c.id} style={{ fontSize: 12, color: "var(--ink-soft)", padding: "3px 0" }}>
                    {c.codigo || "(sem cód)"} · {c.nome}
                  </div>
                ))}
              </>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setAnaliseDup(null)}>Cancelar</button>
              {analiseDup.paraRemover.length > 0 && (
                <button className="btn btn-primary btn-block" onClick={handleRemoverDuplicados}>
                  Remover {analiseDup.paraRemover.length}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className={"card ferramenta-card" + (enriquecendo ? " ferramenta-expandida" : "")}>
        <h2 className="card-title">Dados públicos em lote</h2>
        {!enriquecendo ? (
          <>
            <p className="ferramenta-desc" style={{ color: "var(--ink-soft)", marginBottom: 12 }}>
              Consulta o CNPJ de cada cliente na base pública e preenche telefone, situação
              cadastral e atividade. Roda devagar (~1,5s por cliente) para respeitar o limite
              da API — pode deixar rodando em segundo plano e parar quando quiser.
              {" "}<strong>{pendentesEnriquecimento}</strong> clientes ainda sem esses dados.
            </p>
            <button className="btn btn-secondary btn-block" onClick={handleEnriquecerTodos}
              disabled={pendentesEnriquecimento === 0}>
              Buscar dados públicos dos clientes
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, marginBottom: 10 }}>
              {progressoEnriq
                ? `${progressoEnriq.feitos} de ${progressoEnriq.total} · ${progressoEnriq.sucesso} atualizados, ${progressoEnriq.falhas} sem retorno`
                : "Iniciando..."}
            </div>
            {progressoEnriq?.total > 0 && (
              <div style={{ background: "var(--pink-light)", borderRadius: 8, height: 10, marginBottom: 12 }}>
                <div style={{
                  width: `${(progressoEnriq.feitos / progressoEnriq.total) * 100}%`,
                  background: "linear-gradient(90deg, var(--pink), var(--grape))",
                  height: "100%", borderRadius: 8,
                }} />
              </div>
            )}
            <button className="btn btn-ghost btn-block" onClick={() => { pararEnriqRef.current = true; }}>
              Parar
            </button>
          </>
        )}
      </div>

      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="field" style={{ marginBottom: 0, flex: 2 }}>
          <input className="input" placeholder="Buscar por nome, grupo, razão social, código, CNPJ, cidade..."
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: "0 0 110px" }}>
            <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
              <option value="">Todos UF</option>
              {estadosPresentes.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, flex: "0 0 180px" }}>
            <select className="input" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)}>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="nome_desc">Nome (Z-A)</option>
              <option value="razaoSocial_asc">Razão social (A-Z)</option>
              <option value="estado_asc">Estado (A-Z)</option>
              <option value="cadastro_desc">Cadastro (recente)</option>
              <option value="cadastro_asc">Cadastro (antigo)</option>
              <option value="ultimaCompra_desc">Última compra (recente)</option>
              <option value="ultimaCompra_asc">Última compra (antiga)</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 0, fontSize: 13, whiteSpace: "nowrap", cursor: "pointer" }}>
            <input type="checkbox" checked={somenteAtivos} onChange={(e) => setSomenteAtivos(e.target.checked)} />
            Só CNPJ ativo
          </label>
          <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }}
            onClick={() => setModalAberto({ novo: true })}>
            + Novo
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          <strong>{clientes.length}</strong> clientes na base agrupados em <strong>{gruposFiltrados.length}</strong> cadastro{gruposFiltrados.length === 1 ? "" : "s"}
          {(filtro || filtroEstado || somenteAtivos) && ` · ${listaFiltrada.length} clientes correspondem ao filtro`}
        </div>
        {somenteAtivos && (
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
            Esse filtro só enxerga clientes que já tiveram a situação cadastral consultada
            (card "Dados públicos em lote" acima). {clientesComSituacao} de {clientes.length} já foram consultados.
          </div>
        )}
      </div>

      {carregando ? (
        <div className="empty-state">Carregando clientes...</div>
      ) : gruposFiltrados.length === 0 ? (
        <div className="empty-state">Nenhum cliente cadastrado ainda.</div>
      ) : (
        <div className="lista-grid">
          {gruposFiltrados.map((g) => (
            <CardGrupoCliente
              key={g.chave}
              g={g}
              expandido={gruposExpandidos.has(g.chave)}
              onToggle={toggleGrupoExpandido}
              onAbrirGrupo={abrirGrupo}
              onAbrirCliente={abrirCliente}
            />
          ))}
        </div>
      )}

      {modalAberto && (
        <ClienteCadastroModal
          clientes={modalAberto.clientes}
          grupoNome={modalAberto.grupoNome}
          novo={modalAberto.novo}
          onClose={() => setModalAberto(null)}
          onSaved={carregar}
        />
      )}
    </div>
  );
}
