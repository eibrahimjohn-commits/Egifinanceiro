// Função serverless da Vercel (roda no servidor, não no navegador).
// Existe para contornar o CORS: o navegador não consegue chamar APIs de terceiros
// diretamente, mas o servidor consegue.
//
// A API Base Empresarial exige um filtro que restrinja o conjunto de resultados
// (confirmado por teste real): city_ibge_code, cod_cidade_ibge, full_cnpj ou cnpj_completo.
// Não aceita busca livre por nome de cidade. Por isso, primeiro resolvemos o nome da
// cidade digitada para o código do IBGE usando a API oficial e gratuita do IBGE.

function normalizar(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

async function resolverCidadeIbge(cidadeNome, uf) {
  const url = uf
    ? `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`
    : `https://servicodados.ibge.gov.br/api/v1/localidades/municipios`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Não consegui consultar a lista de municípios do IBGE.");
  const lista = await resp.json();

  const alvo = normalizar(cidadeNome);
  const exato = lista.find((m) => normalizar(m.nome) === alvo);
  if (exato) return exato;
  return lista.find((m) => normalizar(m.nome).includes(alvo)) || null;
}

function extrairLista(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.results || data?.items || data?.establishments || data?.companies || [];
}

function normalizarEmpresa(e, contexto) {
  const cnpj = String(e.full_cnpj || e.id || "").replace(/\D/g, "");

  const endereco = e.address
    ? [e.address.street_type, e.address.street].filter(Boolean).join(" ") +
      (e.address.number ? `, ${e.address.number}` : "")
    : "";

  return {
    cnpj,
    razaoSocial: e.trade_name || "",
    nomeFantasia: e.trade_name || "",
    cidade: contexto.cidade || "",
    estado: contexto.uf || "",
    bairro: e.address?.neighborhood || "",
    logradouro: endereco,
    telefone: e.contact?.phone_1 || e.contact?.phone_2 || "",
    email: e.contact?.email || "",
    situacaoCadastral: e.registration_status?.name || "",
    dataAbertura: e.activity_start_date || "",
    cnae: e.main_cnae || contexto.cnae || "",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { cidade = "", uf = "", cnae = "", pagina = "1" } = req.query;

  if (!cidade) {
    return res.status(400).json({ erro: "Informe a cidade." });
  }

  let municipio;
  try {
    municipio = await resolverCidadeIbge(cidade, uf);
  } catch (err) {
    return res.status(502).json({ erro: "Falha ao consultar o IBGE: " + err.message });
  }

  if (!municipio) {
    return res.status(404).json({
      erro: `Cidade "${cidade}" não encontrada no IBGE${uf ? ` para o estado ${uf}` : ""}. Confira a grafia, ou selecione o estado para ajudar a localizar.`,
    });
  }

  // A API só aceita filtrar por CNPJ ou localização (confirmado por teste real) —
  // não filtra por CNAE. Então buscamos várias páginas da cidade em paralelo e
  // filtramos o ramo de atividade aqui.
  const PAGINAS_PARALELAS = 6;
  const PER_PAGE = 100;

  function montarUrl(pagina) {
    const params = new URLSearchParams();
    params.append("filter[city_ibge_code]", String(municipio.id));
    params.append("sort", "-activity_start_date");
    params.append("per_page", String(PER_PAGE));
    params.append("page", String(pagina));
    return `https://app.baseempresarial.com.br/api/v1/establishments?${params.toString()}`;
  }

  function cnaeBate(item, alvoDigitos) {
    return item.main_cnae && String(item.main_cnae).replace(/\D/g, "") === alvoDigitos;
  }

  try {
    const paginas = Array.from({ length: PAGINAS_PARALELAS }, (_, i) => i + 1);
    const respostas = await Promise.allSettled(
      paginas.map(async (p) => {
        const r = await fetch(montarUrl(p), { headers: { Accept: "application/json" } });
        const json = await r.json();
        if (!r.ok) {
          const erro = new Error(json?.message || `Falha na página ${p} (${r.status})`);
          erro.detalhe = json;
          throw erro;
        }
        return json;
      })
    );

    let brutos = [];
    let primeiraFalha = null;
    respostas.forEach((r) => {
      if (r.status === "fulfilled") {
        brutos = brutos.concat(extrairLista(r.value));
      } else if (!primeiraFalha) {
        primeiraFalha = r.reason;
      }
    });

    if (brutos.length === 0 && primeiraFalha) {
      return res.status(502).json({
        erro: "Erro ao consultar a Base Empresarial: " + String(primeiraFalha.message || primeiraFalha),
        detalhe: primeiraFalha.detalhe,
      });
    }

    const cnaeDigitos = cnae ? String(cnae).replace(/\D/g, "") : null;
    const filtrados = cnaeDigitos ? brutos.filter((e) => cnaeBate(e, cnaeDigitos)) : brutos;

    const empresas = filtrados
      .slice(0, 50)
      .map((e) => normalizarEmpresa(e, { cidade: municipio.nome, uf: uf || municipio?.microrregiao?.mesorregiao?.UF?.sigla, cnae }))
      .filter((e) => e.cnpj);

    return res.status(200).json({
      total: empresas.length,
      municipioResolvido: { id: municipio.id, nome: municipio.nome },
      totalVarrido: brutos.length,
      empresas,
      ...(empresas.length === 0 && brutos.length > 0
        ? {
            amostraDebug: {
              camposDisponiveis: Object.keys(brutos[0]),
              primeiroRegistro: brutos[0],
            },
          }
        : {}),
    });
  } catch (err) {
    return res.status(502).json({ erro: "Erro ao consultar a Base Empresarial: " + String(err.message || err) });
  }
}
