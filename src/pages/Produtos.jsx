import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarResumoProdutos, listarImportacoes, buscarDetalheProduto, enriquecerCategorias, gravarCategoriasNosResumos } from "../lib/vendas";
import { formatCurrency } from "../lib/constants";
import SeletorPeriodo from "../components/SeletorPeriodo";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import ModalProduto from "../components/ModalProduto";
import GraficosSalvosLista from "../components/GraficosSalvosLista";
import { chaveProdutos, buscarGraficoSalvo, salvarGraficoSalvo, graficoEstaDesatualizado } from "../lib/graficosSalvos";

function mesAtras(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
}

const CORES_CLASSE = { A: "var(--green)", B: "var(--yellow)", C: "var(--ink-soft)" };
const CHAVE_ESTADO = "egi-financeiro-produtos-estado";

function carregarEstadoSalvo() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_ESTADO));
    if (salvo?.mesInicio && salvo?.mesFim) return salvo;
  } catch {
    // segue com o padrão se não der pra ler
  }
  return { mesInicio: mesAtras(2), mesFim: mesAtras(0) };
}

export default function Produtos() {
  const estadoInicial = carregarEstadoSalvo();
  const [mesInicio, setMesInicio] = useState(estadoInicial.mesInicio);
  const [mesFim, setMesFim] = useState(estadoInicial.mesFim);
  const [importacoes, setImportacoes] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [graficoGerado, setGraficoGerado] = useState(false);
  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [subcategoriaFiltro, setSubcategoriaFiltro] = useState("");
  const [classesFiltro, setClassesFiltro] = useState(new Set()); // A / B / C
  const [limite, setLimite] = useState(100);
  function alternarClasse(c) {
    setClassesFiltro((atual) => {
      const novo = new Set(atual);
      if (novo.has(c)) novo.delete(c); else novo.add(c);
      return novo;
    });
    setLimite(100);
  }
  const [ordenacao, setOrdenacao] = useState("faturamento");
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const [aba, setAba] = useState("painel"); // painel | salvos

  async function carregar() {
    setCarregando(true);
    setGraficoGerado(true);
    const chave = chaveProdutos(mesInicio, mesFim);
    const [salvo, imps] = await Promise.all([buscarGraficoSalvo(chave), listarImportacoes()]);
    setImportacoes(imps);
    if (salvo && !graficoEstaDesatualizado(salvo, imps)) {
      const doCache = await enriquecerCategorias(salvo.produtos);
      setProdutos(doCache);
      setCarregando(false);
      // categoria que faltava e o Portal preencheu: grava no banco e no cache
      // pra não precisar cruzar de novo na próxima vez
      persistirCategorias(chave, salvo.produtos, doCache);
      return;
    }
    const brutos = await listarResumoProdutos(mesInicio, mesFim);
    const prods = await enriquecerCategorias(brutos);
    setProdutos(prods);
    setCarregando(false);
    salvarGraficoSalvo(chave, { tipo: "produtos", mesInicio, mesFim, produtos: prods });
    persistirCategorias(null, brutos, prods);
  }

  // Grava a categoria recém-descoberta: nos resumos do banco e, se veio do
  // cache, no próprio gráfico salvo. Roda em segundo plano — se falhar, a
  // tela já está correta e tenta de novo na próxima abertura.
  async function persistirCategorias(chaveCache, antes, depois, de = mesInicio, ate = mesFim) {
    const mudou = depois.some((p, i) => p.categoria && !antes[i]?.categoria);
    if (!mudou) return;
    try {
      await gravarCategoriasNosResumos(de, ate);
      if (chaveCache) await salvarGraficoSalvo(chaveCache, { tipo: "produtos", mesInicio: de, mesFim: ate, produtos: depois });
    } catch (e) {
      console.warn("Não consegui gravar as categorias agora — segue só na exibição.", e);
    }
  }

  function abrirGraficoSalvo(g) {
    // g já vem com os produtos prontos do cache — não precisa reler nada.
    setMesInicio(g.mesInicio);
    setMesFim(g.mesFim);
    setProdutos(g.produtos || []);
    enriquecerCategorias(g.produtos || []).then((lista) => {
      setProdutos(lista);
      persistirCategorias(chaveProdutos(g.mesInicio, g.mesFim), g.produtos || [], lista, g.mesInicio, g.mesFim);
    });
    setGraficoGerado(true);
    setAba("painel");
  }

  useEffect(() => {
    localStorage.setItem(CHAVE_ESTADO, JSON.stringify({ mesInicio, mesFim }));
  }, [mesInicio, mesFim]);

  // Curva ABC: ordena por faturamento desc, acumula % até 80% (A), até 95% (B), resto (C).
  // É a forma padrão de enxergar concentração — quais poucos produtos sustentam a maior
  // parte da receita, pra priorizar reposição de estoque e negociação com fornecedor.
  const totalFaturamento = produtos.reduce((s, p) => s + p.faturamento, 0);
  const ordenadosPorFaturamento = [...produtos].sort((a, b) => b.faturamento - a.faturamento);
  let acumulado = 0;
  const comClasse = ordenadosPorFaturamento.map((p) => {
    acumulado += p.faturamento;
    const percentAcumulado = totalFaturamento > 0 ? (acumulado / totalFaturamento) * 100 : 0;
    const classe = percentAcumulado <= 80 ? "A" : percentAcumulado <= 95 ? "B" : "C";
    return { ...p, percentAcumulado, classe };
  });
  const contagemClasse = { A: 0, B: 0, C: 0 };
  comClasse.forEach((p) => { contagemClasse[p.classe]++; });

  const categorias = Array.from(new Set(produtos.map((p) => p.categoria).filter(Boolean))).sort();
  // Subcategorias da categoria escolhida (ou de todas, se nenhuma escolhida).
  const subcategorias = Array.from(new Set(produtos
    .filter((p) => !categoriaFiltro || p.categoria === categoriaFiltro)
    .map((p) => p.subcategoria).filter(Boolean))).sort();

  let listaFiltrada = comClasse.filter((p) => {
    if (categoriaFiltro && p.categoria !== categoriaFiltro) return false;
    if (subcategoriaFiltro && p.subcategoria !== subcategoriaFiltro) return false;
    if (classesFiltro.size && !classesFiltro.has(p.classe)) return false;
    if (busca && !`${p.produto} ${p.codigoProduto}`.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });
  if (ordenacao === "qtd") listaFiltrada = [...listaFiltrada].sort((a, b) => b.qtd - a.qtd);

  // Faturamento por categoria, pra ver de cara qual linha de produto puxa mais receita.
  const porCategoria = new Map();
  produtos.forEach((p) => {
    const cat = p.categoria || "(sem categoria)";
    porCategoria.set(cat, (porCategoria.get(cat) || 0) + p.faturamento);
  });
  const dadosCategoria = Array.from(porCategoria.entries())
    .map(([categoria, faturamento]) => ({ categoria, faturamento }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 10);

  const temCategoria = produtos.some((p) => p.categoria);

  return (
    <div>
      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (aba === "painel" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setAba("painel")}>
          Painel
        </button>
        <button className={"btn " + (aba === "salvos" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setAba("salvos")}>
          Gráficos salvos
        </button>
      </div>

      {aba === "salvos" && <GraficosSalvosLista tipo="produtos" onAbrir={abrirGraficoSalvo} />}

      {aba === "painel" && (
      <>
      <SeletorPeriodo
        mesInicio={mesInicio} mesFim={mesFim}
        anoMinimo={importacoes.length ? Math.min(...importacoes.flatMap((i) => i.meses || []).map((m) => Number(m.slice(0, 4)))) : undefined}
        onChange={(inicio, fim) => { setMesInicio(inicio); setMesFim(fim); }}
      />

      <button className="btn btn-primary btn-block" style={{ marginBottom: 12 }} onClick={carregar} disabled={carregando}>
        {carregando ? "Gerando..." : graficoGerado ? "🔄 Atualizar" : "📊 Gerar gráfico"}
      </button>

      {!graficoGerado ? (
        <div className="empty-state">Escolha o período acima e clique em "Gerar gráfico".</div>
      ) : carregando ? (
        <div className="empty-state">Carregando...</div>
      ) : produtos.length === 0 ? (
        <div className="empty-state">Nenhuma venda importada nesse período ainda. Importe pela aba Vendas.</div>
      ) : (
        <>
          {!temCategoria && (
            <div className="card" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              Nenhum produto desse período tem categoria. O sistema tenta cruzar o código com o catálogo
              do Portal de Vendas ao abrir esta tela: ou os códigos não batem com o catálogo, ou o Portal
              não respondeu agora. Recarregue a tela pra tentar de novo.
            </div>
          )}

          <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Produtos vendidos</div>
              <strong style={{ fontSize: 22 }}>{produtos.length}</strong>
            </div>
            <div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Faturamento total</div>
              <strong style={{ fontSize: 22 }}>{formatCurrency(totalFaturamento)}</strong>
            </div>
            <div title="Classe A: produtos que somados chegam a 80% do faturamento. É neles que a reposição de estoque e a negociação com fornecedor importam mais.">
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Classe A (80% da receita) <span style={{ cursor: "help" }}>ⓘ</span></div>
              <strong style={{ fontSize: 22, color: "var(--green)" }}>{contagemClasse.A} produtos</strong>
            </div>
          </div>

          {dadosCategoria.length > 1 && (
            <div className="card">
              <h2 className="card-title">Faturamento por categoria</h2>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={dadosCategoria} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="categoria" tick={{ fontSize: 12 }} width={140} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Bar dataKey="faturamento" fill="var(--grape)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="card-title">Ranking de produtos</h2>
            <div className="row" style={{ marginBottom: 12 }}>
              <input className="input" placeholder="Buscar produto ou código..." value={busca}
                onChange={(e) => { setBusca(e.target.value); setLimite(100); }} />
              {categorias.length > 0 && (
                <select className="input" value={categoriaFiltro}
                  onChange={(e) => { setCategoriaFiltro(e.target.value); setSubcategoriaFiltro(""); setLimite(100); }}>
                  <option value="">Todas as categorias</option>
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {subcategorias.length > 0 && (
                <select className="input" value={subcategoriaFiltro}
                  onChange={(e) => { setSubcategoriaFiltro(e.target.value); setLimite(100); }}>
                  <option value="">Todas as subcategorias</option>
                  {subcategorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              <select className="input" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)}>
                <option value="faturamento">Ordenar por faturamento</option>
                <option value="qtd">Ordenar por quantidade</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Curva:</span>
              {["A", "B", "C"].map((c) => (
                <button key={c} type="button" className={"badge filtro-chip" + (classesFiltro.has(c) ? " filtro-ativo" : "")}
                  style={{ background: CORES_CLASSE[c], color: "white" }} onClick={() => alternarClasse(c)}>
                  {classesFiltro.has(c) ? "✓ " : ""}{c} ({contagemClasse[c]})
                </button>
              ))}
              {(classesFiltro.size > 0 || categoriaFiltro || subcategoriaFiltro) && (
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }}
                  onClick={() => { setClassesFiltro(new Set()); setCategoriaFiltro(""); setSubcategoriaFiltro(""); setLimite(100); }}>
                  Limpar filtros
                </button>
              )}
              <span style={{ fontSize: 12, color: "var(--ink-soft)", marginLeft: "auto" }}>
                {listaFiltrada.length} produto(s) · {formatCurrency(listaFiltrada.reduce((s2, p) => s2 + p.faturamento, 0))}
              </span>
            </div>
            <div className="lista-grid">
              {listaFiltrada.slice(0, limite).map((p, i) => (
                <div key={p.codigoProduto || p.produto} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, cursor: "pointer" }}
                  onClick={() => setProdutoSelecionado(p)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{i + 1}. {p.produto || "(sem nome)"}</strong>
                    <span className="badge" style={{ background: CORES_CLASSE[p.classe], color: "white", flexShrink: 0 }}>{p.classe}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    {p.codigoProduto} {p.categoria && `· ${p.categoria}`}{p.subcategoria && ` / ${p.subcategoria}`}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{p.qtd} un.</span>
                    <strong>{formatCurrency(p.faturamento)}</strong>
                  </div>
                </div>
              ))}
            </div>
            {listaFiltrada.length > limite && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  Mostrando {limite} de {listaFiltrada.length}.
                </span>
                <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }}
                  onClick={() => setLimite((l) => l + 100)}>
                  Carregar mais 100
                </button>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }}
                  onClick={() => setLimite(listaFiltrada.length)}>
                  Mostrar todos ({listaFiltrada.length})
                </button>
              </div>
            )}
          </div>
        </>
      )}
      </>
      )}

      {produtoSelecionado && (
        <ModalProduto produto={produtoSelecionado} onFechar={() => setProdutoSelecionado(null)} buscarDetalhe={buscarDetalheProduto} importacoes={importacoes} />
      )}
    </div>
  );
}
