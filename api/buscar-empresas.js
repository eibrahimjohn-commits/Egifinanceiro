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
  // Reduzido de 6 pra 3 páginas simultâneas: se a Base Empresarial estiver
  // limitando por taxa de requisições (rate limit), poucas chamadas ao mesmo
  // tempo reduzem a chance de disparar isso.
  // Buscamos em série (não em paralelo) com pausa entre as páginas. Três
  // chamadas simultâneas pesadas são um jeito clássico de derrubar uma API de
  // terceiro — e o erro que aparecia era justamente HTTP 500 (erro interno do
  // lado deles), não 401/403 de credencial.
  const MAX_PAGINAS = 8;
  const PER_PAGE = 100;
  const TIMEOUT_MS = 12000;
  const TENTATIVAS_POR_PAGINA = 3;

  const paginaInicial = Math.max(1, parseInt(pagina, 10) || 1);

  function montarUrl(pagina) {
    const params = new URLSearchParams();
    params.append("filter[city_ibge_code]", String(municipio.id));
    // Sem "sort": ordenar por data em cidades grandes obriga a API a varrer a
    // base inteira antes de responder, e é o suspeito nº1 do erro 500 —
    // Porto Alegre tem dezenas de milhares de empresas. A ordem não importa
    // aqui, já que filtramos por CNAE do nosso lado de qualquer jeito.
    params.append("per_page", String(PER_PAGE));
    params.append("page", String(pagina));
    return `https://app.baseempresarial.com.br/api/v1/establishments?${params.toString()}`;
  }

  function pausa(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Se existir uma chave de API configurada nas variáveis de ambiente da
  // Vercel, ela é enviada. A API pode ter passado a exigir autenticação.
  function montarHeaders() {
    const headers = { Accept: "application/json" };
    const token = process.env.BASE_EMPRESARIAL_TOKEN;
    if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    return headers;
  }

  async function buscarPagina(p) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PAGINA; tentativa++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const r = await fetch(montarUrl(p), { headers: montarHeaders(), signal: controller.signal });
        const textoBruto = await r.text();
        let json;
        try {
          json = textoBruto ? JSON.parse(textoBruto) : {};
        } catch {
          const erro = new Error(`Resposta não-JSON da Base Empresarial (status ${r.status}).`);
          erro.detalhe = { status: r.status, trechoResposta: textoBruto.slice(0, 300) };
          throw erro;
        }
        if (!r.ok) {
          const erro = new Error(`(HTTP ${r.status}) ` + (json?.message || `Falha na página ${p}`));
          erro.detalhe = { status: r.status, corpo: json };
          erro.status = r.status;
          throw erro;
        }
        return json;
      } catch (e) {
        ultimoErro = e;
        // 4xx é problema do pedido (credencial, filtro inválido) — repetir não
        // adianta. Só 5xx e timeout valem nova tentativa, com espera crescente.
        const status = e.status || 0;
        const valeRetentar = status === 0 || status >= 500 || status === 429;
        if (!valeRetentar || tentativa === TENTATIVAS_POR_PAGINA) break;
        await pausa(800 * tentativa);
      } finally {
        clearTimeout(timer);
      }
    }
    throw ultimoErro;
  }

  function cnaeBate(item, alvoDigitos) {
    return item.main_cnae && String(item.main_cnae).replace(/\D/g, "") === alvoDigitos;
  }

  // ------------------------------------------------------------------
  // PROVEDOR ALTERNATIVO (recomendado): API que filtra por CNAE no servidor.
  //
  // A Base Empresarial NÃO filtra por CNAE — ela só devolve "todas as empresas
  // da cidade", e o filtro de ramo é feito aqui no nosso código. Isso é o
  // problema de fundo: Porto Alegre tem mais de 200 mil empresas; varrer 800
  // por chamada e torcer pra alguma ser bijuteria é procurar agulha no palheiro.
  //
  // Com CNPJ_WS_TOKEN configurado nas variáveis de ambiente da Vercel, usamos
  // o CNPJ.ws, que aceita filtro de atividade + cidade direto na consulta —
  // então o que volta JÁ é só o ramo procurado.
  //
  // OBS: o formato exato do endpoint comercial precisa ser confirmado com a
  // documentação da conta (o filtro por CNAE é exclusivo do plano Premium).
  // Se a resposta vier diferente do esperado, o erro abaixo mostra o corpo
  // cru pra facilitar o ajuste.
  const tokenCnpjWs = process.env.CNPJ_WS_TOKEN;
  if (tokenCnpjWs && cnae) {
    try {
      const params = new URLSearchParams();
      params.append("token", tokenCnpjWs);
      params.append("atividade_principal", String(cnae).replace(/\D/g, ""));
      params.append("cidade_id", String(municipio.id));
      params.append("situacao_cadastral", "Ativa");
      params.append("limit", "50");
      const url = `https://comercial.cnpj.ws/estabelecimentos?${params.toString()}`;

      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const texto = await r.text();
      const json = texto ? JSON.parse(texto) : {};
      if (!r.ok) {
        return res.status(502).json({
          erro: `O CNPJ.ws recusou a consulta (HTTP ${r.status}). Confira se o token está correto e se o plano inclui busca por CNAE.`,
          detalhe: json,
        });
      }
      const lista = extrairLista(json);
      const empresas = lista.map((e) => ({
        cnpj: String(e.cnpj || "").replace(/\D/g, ""),
        razaoSocial: e.razao_social || e.nome_fantasia || "",
        nomeFantasia: e.nome_fantasia || "",
        cidade: e.cidade?.nome || municipio.nome,
        estado: e.estado?.sigla || uf || "",
        bairro: e.bairro || "",
        logradouro: [e.tipo_logradouro, e.logradouro, e.numero].filter(Boolean).join(" "),
        telefone: [e.ddd1, e.telefone1].filter(Boolean).join(" "),
        email: e.email || "",
        situacaoCadastral: e.situacao_cadastral || "",
        dataAbertura: e.data_inicio_atividade || "",
        cnae: cnae,
      })).filter((e) => e.cnpj);

      return res.status(200).json({
        total: empresas.length,
        provedor: "cnpj.ws",
        municipioResolvido: { id: municipio.id, nome: municipio.nome },
        totalVarrido: empresas.length,
        empresas,
      });
    } catch (e) {
      return res.status(502).json({
        erro: "Falha ao consultar o CNPJ.ws: " + String(e.message || e),
      });
    }
  }

  try {
    let brutos = [];
    let primeiraFalha = null;

    // Sequencial: se a primeira página já funciona, o resto é bônus. Assim uma
    // falha na página 2 não joga fora os resultados que a página 1 trouxe.
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const p = paginaInicial + i;
      try {
        const json = await buscarPagina(p);
        const lista = extrairLista(json);
        brutos = brutos.concat(lista);
        if (lista.length < PER_PAGE) break; // acabaram os resultados
        if (i < MAX_PAGINAS - 1) await pausa(300);
      } catch (e) {
        if (!primeiraFalha) primeiraFalha = e;
        break; // não insiste nas páginas seguintes se essa já falhou
      }
    }

    if (brutos.length === 0 && primeiraFalha) {
      const status = primeiraFalha.status || 0;
      let dica = "";
      if (status >= 500) {
        dica = " Esse é um erro interno do servidor da Base Empresarial (não do EGI Financeiro). Tente de novo em alguns minutos; se persistir, vale checar com eles se o serviço/assinatura está ativo.";
      } else if (status === 401 || status === 403) {
        dica = " A API recusou o acesso — provavelmente falta uma chave de API. Configure BASE_EMPRESARIAL_TOKEN nas variáveis de ambiente da Vercel.";
      } else if (status === 429) {
        dica = " Excesso de consultas em pouco tempo. Espere um pouco e tente de novo.";
      } else if (status === 0) {
        dica = " A consulta demorou demais e foi interrompida.";
      }
      return res.status(502).json({
        erro: "Erro ao consultar a Base Empresarial: " + String(primeiraFalha.message || primeiraFalha) + dica,
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
      proximaPagina: paginaInicial + MAX_PAGINAS,
      varreduraPorChamada: MAX_PAGINAS * PER_PAGE,
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
