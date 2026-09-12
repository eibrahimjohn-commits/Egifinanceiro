import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarResumoProdutos, listarImportacoes } from "../lib/vendas";
import { formatCurrency } from "../lib/constants";
import SeletorPeriodo from "../components/SeletorPeriodo";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";

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
  const [carregando, setCarregando] = useState(true);
  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState("faturamento");

  async function carregar() {
    setCarregando(true);
    const [prods, imps] = await Promise.all([
      listarResumoProdutos(mesInicio, mesFim),
      listarImportacoes(),
    ]);
    setProdutos(prods);
    setImportacoes(imps);
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, [mesInicio, mesFim]);
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

  let listaFiltrada = comClasse.filter((p) => {
    if (categoriaFiltro && p.categoria !== categoriaFiltro) return false;
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
      <SeletorPeriodo
        mesInicio={mesInicio} mesFim={mesFim}
        anoMinimo={importacoes.length ? Math.min(...importacoes.flatMap((i) => i.meses || []).map((m) => Number(m.slice(0, 4)))) : undefined}
        onChange={(inicio, fim) => { setMesInicio(inicio); setMesFim(fim); }}
      />

      {carregando ? (
        <div className="empty-state">Carregando...</div>
      ) : produtos.length === 0 ? (
        <div className="empty-state">Nenhuma venda importada nesse período ainda. Importe pela aba Vendas.</div>
      ) : (
        <>
          {!temCategoria && (
            <div className="card" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              Nenhum produto desse período veio com categoria do Portal de Vendas — ou o código não bateu
              com o catálogo, ou a conexão com o Portal não respondeu no momento da importação.
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
              <input className="input" placeholder="Buscar produto ou código..." value={busca} onChange={(e) => setBusca(e.target.value)} />
              {categorias.length > 0 && (
                <select className="input" value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
                  <option value="">Todas as categorias</option>
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              <select className="input" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)}>
                <option value="faturamento">Ordenar por faturamento</option>
                <option value="qtd">Ordenar por quantidade</option>
              </select>
            </div>
            <div className="lista-grid">
              {listaFiltrada.slice(0, 100).map((p, i) => (
                <div key={p.codigoProduto || p.produto} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
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
            {listaFiltrada.length > 100 && (
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10 }}>
                Mostrando os 100 primeiros de {listaFiltrada.length}. Use a busca pra refinar.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
