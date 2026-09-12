// Quanto mais longo o período analisado, menos sentido faz ver dia a dia —
// vira uma serra ilegível. Essa escala decide o "tamanho do balde" com base
// na duração do período escolhido.
export function granularidadeParaPeriodo(mesInicio, mesFim) {
  const dias = diasNoPeriodo(mesInicio, mesFim);
  if (dias <= 31) return "dia";
  if (dias <= 183) return "quinzena"; // até ~6 meses
  if (dias <= 366) return "mes"; // até ~1 ano
  if (dias <= 1096) return "trimestre"; // até ~3 anos
  return "ano";
}

export function diasNoPeriodo(mesInicio, mesFim) {
  const [aIni, mIni] = mesInicio.split("-").map(Number);
  const [aFim, mFim] = mesFim.split("-").map(Number);
  const inicio = new Date(aIni, mIni - 1, 1);
  const fim = new Date(aFim, mFim, 0); // último dia do mês final
  return Math.round((fim - inicio) / 86400000) + 1;
}

function chaveBucket(dataISO, granularidade) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  if (granularidade === "dia") return dataISO;
  if (granularidade === "quinzena") return `${ano}-${String(mes).padStart(2, "0")}-${dia <= 15 ? "Q1" : "Q2"}`;
  if (granularidade === "mes") return `${ano}-${String(mes).padStart(2, "0")}`;
  if (granularidade === "trimestre") return `${ano}-T${Math.ceil(mes / 3)}`;
  return String(ano);
}

function labelBucket(chave, granularidade) {
  if (granularidade === "dia") {
    const [, mes, dia] = chave.split("-");
    return `${dia}/${mes}`;
  }
  if (granularidade === "quinzena") {
    const [ano, mes, q] = chave.split("-");
    return `${q === "Q1" ? "1-15" : "16-31"}/${mes}/${ano.slice(2)}`;
  }
  if (granularidade === "mes") {
    const [ano, mes] = chave.split("-");
    return `${mes}/${ano.slice(2)}`;
  }
  if (granularidade === "trimestre") {
    const [ano, t] = chave.split("-");
    return `${t}/${ano.slice(2)}`;
  }
  return chave; // ano
}

// Agrupa uma série diária (do listarResumoDiario) em baldes maiores, somando
// faturamento/pedidos, e devolve em ORDEM cronológica com um índice
// sequencial (0, 1, 2...) — esse índice é o que permite alinhar períodos
// diferentes lado a lado no mesmo gráfico (ver alinharSeries abaixo).
export function agruparPorGranularidade(resumoDiario, granularidade) {
  const buckets = new Map();
  resumoDiario.forEach((d) => {
    const chave = chaveBucket(d.data, granularidade);
    const atual = buckets.get(chave) || { chave, faturamento: 0, pedidos: 0 };
    atual.faturamento += d.faturamento;
    atual.pedidos += d.pedidos;
    buckets.set(chave, atual);
  });
  return Array.from(buckets.values())
    .sort((a, b) => a.chave.localeCompare(b.chave))
    .map((b, i) => ({ indice: i, chave: b.chave, label: labelBucket(b.chave, granularidade), faturamento: b.faturamento, pedidos: b.pedidos }));
}
