import { useEffect, useRef, useState } from "react";
import "../components/ui.css";
import { listarClientes, salvarCliente, consultarCnpj, importarClientes, listarGruposUnicos, enriquecerClientesEmLote, analisarDuplicados, removerDuplicados } from "../lib/clientes";
import { listarPedidos } from "../lib/pedidos";
import { lerPlanilhaClientes } from "../lib/importarPlanilha";
import { ESTADOS_BR, formatCurrency, formatDate } from "../lib/constants";

export default function BaseDados() {
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(null); // objeto cliente sendo editado
  const [toast, setToast] = useState("");
  const [filtro, setFiltro] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [ordenacao, setOrdenacao] = useState("nome_asc");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  const [importando, setImportando] = useState(false);
  const [preview, setPreview] = useState(null); // { linhas, aba }
  const [progresso, setProgresso] = useState(null);
  const [grupos, setGrupos] = useState([]);
  const [ultimoPedidoPorCliente, setUltimoPedidoPorCliente] = useState({});
  const [enriquecendo, setEnriquecendo] = useState(false);
  const [progressoEnriq, setProgressoEnriq] = useState(null);
  const pararEnriqRef = useRef(false);
  const [analiseDup, setAnaliseDup] = useState(null);
  const [removendoDup, setRemovendoDup] = useState(false);

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

  useEffect(() => { carregar(); listarGruposUnicos().then(setGrupos); }, []);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
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

  const listaFiltrada = clientes
    .filter((c) => {
      if (filtroEstado && (c.estado || "").toUpperCase() !== filtroEstado) return false;
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
        (digitos.length >= 3 && (c.cnpjDigits || "").includes(digitos)) ||
        (digitos.length >= 4 && telefones.includes(digitos))
      );
    })
    .sort((a, b) => {
      const [campo, dir] = ordenacao.split("_");
      const mult = dir === "asc" ? 1 : -1;
      if (campo === "nome") return mult * (a.nome || "").localeCompare(b.nome || "", "pt-BR");
      if (campo === "razaoSocial") return mult * (a.razaoSocial || "").localeCompare(b.razaoSocial || "", "pt-BR");
      if (campo === "estado") return mult * (a.estado || "").localeCompare(b.estado || "", "pt-BR");
      if (campo === "cadastro") return mult * (dataCadastroDe(a) - dataCadastroDe(b));
      if (campo === "ultimaCompra") {
        const da = new Date(ultimaCompraDe(a) || 0).getTime();
        const db_ = new Date(ultimaCompraDe(b) || 0).getTime();
        return mult * (da - db_);
      }
      return 0;
    });

  if (editando) {
    const info = editando.infoExtra;
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

          <div className="field">
            <label>Grupo de cliente</label>
            <input className="input" list="lista-grupos" value={editando.grupo || ""}
              onChange={(e) => setEditando({ ...editando, grupo: e.target.value })}
              placeholder="Ex: Rede Bijoux Ltda (deixe em branco se for cliente único)" />
            <datalist id="lista-grupos">
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
                    {ultimaCompraDe(editando) ? formatDate(ultimaCompraDe(editando)) : "sem registro"}
                  </strong>
                </div>
                {editando.mediaCompra > 0 && (
                  <div>Média de compra: <strong>{formatCurrency(editando.mediaCompra)}</strong></div>
                )}
              </div>
            </div>
          )}

          {info && (
            <div className="field" style={{ background: "var(--bg)", borderRadius: 12, padding: 14 }}>
              <label style={{ marginBottom: 8 }}>Informações públicas (Receita Federal)</label>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}>
                {info.situacaoCadastral && <div>Situação cadastral: <strong style={{ color: "var(--ink)" }}>{info.situacaoCadastral}</strong></div>}
                {info.telefones?.length > 0
                  ? info.telefones.map((t, i) => (
                      <div key={i}>Telefone {i + 1}: <strong style={{ color: "var(--ink)" }}>{t}</strong></div>
                    ))
                  : <div>Telefone: <em>não consta na base pública</em></div>}
                {info.email && <div>E-mail: <strong style={{ color: "var(--ink)" }}>{info.email}</strong></div>}
                {info.porte && <div>Porte: <strong style={{ color: "var(--ink)" }}>{info.porte}</strong></div>}
                {info.capitalSocial != null && <div>Capital social: <strong style={{ color: "var(--ink)" }}>{formatCurrency(info.capitalSocial)}</strong></div>}
                {info.atividadePrincipal && <div>Atividade principal: <strong style={{ color: "var(--ink)" }}>{info.atividadePrincipal}</strong></div>}
                {info.consultadoEm && <div style={{ marginTop: 6, fontSize: 11 }}>Consultado em {formatDate(info.consultadoEm.slice(0, 10))}</div>}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 8, fontStyle: "italic" }}>
                Faturamento não é uma informação pública no Brasil (sigilo fiscal), por isso não aparece aqui.
              </div>
            </div>
          )}

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

      <div className="ferramentas-grid">
      <div className="card ferramenta-card">
        <h2 className="card-title" style={{ fontSize: 15 }}>Importar planilha</h2>
        {!preview ? (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
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

      <div className="card ferramenta-card">
        <h2 className="card-title" style={{ fontSize: 15 }}>Limpar duplicados</h2>
        {!analiseDup ? (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
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

      <div className="card ferramenta-card">
        <h2 className="card-title" style={{ fontSize: 15 }}>Dados públicos em lote</h2>
        {!enriquecendo ? (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
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
          <input className="input" placeholder="Buscar por nome, razão social, código, CNPJ, cidade..."
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
          <button className="btn btn-primary" style={{ whiteSpace: "nowrap" }}
            onClick={() => setEditando({ codigo: "", nome: "" })}>
            + Novo
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
          <strong>{clientes.length}</strong> clientes na base
          {(filtro || filtroEstado) && ` · ${listaFiltrada.length} correspondem ao filtro`}
        </div>
      </div>

      {carregando ? (
        <div className="empty-state">Carregando clientes...</div>
      ) : listaFiltrada.length === 0 ? (
        <div className="empty-state">Nenhum cliente cadastrado ainda.</div>
      ) : (
        <div className="clientes-grid">
        {listaFiltrada.map((c) => {
          const situacao = c.infoExtra?.situacaoCadastral;
          const ativa = situacao?.toUpperCase().includes("ATIVA");
          const ultimoPedido = ultimaCompraDe(c);
          return (
            <div key={c.id} className="list-item" onClick={() => setEditando(c)}
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{c.nome}</strong>
                {situacao && (
                  <span className={"badge " + (ativa ? "badge-pago" : "badge-atraso")}
                    style={{ flexShrink: 0 }}>
                    {situacao}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Cód {c.codigo} · {c.cidade || "—"}/{c.estado || "—"}
              </div>
              {(c.telefones?.[0] || c.whatsapp || c.infoExtra?.telefone) && (
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {c.whatsapp ? `WhatsApp ${c.whatsapp}` : c.telefones?.[0] || c.infoExtra?.telefone}
                </div>
              )}
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Última compra: {ultimoPedido ? formatDate(ultimoPedido) : "sem registro"}
              </div>
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
