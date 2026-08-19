// Função serverless da Vercel (roda no servidor, não no navegador).
// Existe para contornar o CORS: o navegador não consegue chamar APIs de terceiros
// diretamente, mas o servidor consegue.

const FONTES = [
  {
    nome: "baseempresarial",
    montarUrl: ({ cnae, uf, cidade, pagina }) => {
      const p = new URLSearchParams();
      if (cnae) p.append("cnaes[]", cnae);
      if (uf) p.append("uf", uf);
      if (cidade) p.append("search", cidade);
      p.append("per_page", "50");
      p.append("page", String(pagina || 1));
      return `https://app.baseempresarial.com.br/api/v1/establishments?${p.toString()}`;
    },
  },
  {
    nome: "baseempresarial-companies",
    montarUrl: ({ cnae, uf, cidade, pagina }) => {
      const p = new URLSearchParams();
      if (cnae) p.append("cnaes[]", cnae);
      if (uf) p.append("uf", uf);
      if (cidade) p.append("q", cidade);
      p.append("per_page", "50");
      p.append("page", String(pagina || 1));
      return `https://app.baseempresarial.com.br/api/v1/companies/search?${p.toString()}`;
    },
  },
];

function extrairLista(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.results || data?.items || data?.establishments || data?.companies || [];
}

function normalizar(e, contexto) {
  const cnpjBruto =
    e.cnpj || e.cnpj_completo || e.cnpjCompleto || e.taxId || e.cnpj_basico || "";
  const cnpj = String(cnpjBruto).replace(/\D/g, "");

  const telefoneBruto =
    e.telefone || e.telefone_1 || e.ddd_telefone_1 || e.phone ||
    (e.ddd1 && e.telefone1 ? `${e.ddd1}${e.telefone1}` : "");

  return {
    cnpj,
    razaoSocial: e.razao_social || e.razaoSocial || e.corporate_name || e.nome || "",
    nomeFantasia: e.nome_fantasia || e.nomeFantasia || e.trade_name || e.fantasia || "",
    cidade: e.municipio || e.municipio_nome || e.city?.name || e.city || e.cidade || contexto.cidade || "",
    estado: e.uf || e.state || e.estado || contexto.uf || "",
    bairro: e.bairro || e.neighborhood || "",
    logradouro: e.logradouro || e.street || "",
    telefone: telefoneBruto ? String(telefoneBruto).replace(/\D/g, "") : "",
    email: e.email || e.correio_eletronico || "",
    situacaoCadastral:
      e.situacao_cadastral || e.descricao_situacao_cadastral ||
      e.registration_status || e.situacao || "",
    dataAbertura: e.data_inicio_atividade || e.data_abertura || e.founded || "",
    cnae: e.cnae_fiscal || e.cnae_principal?.codigo || e.cnae_principal || e.cnae || contexto.cnae || "",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { cidade = "", uf = "", cnae = "", pagina = "1", debug } = req.query;

  if (!cidade && !uf) {
    return res.status(400).json({ erro: "Informe ao menos cidade ou estado (uf)." });
  }

  const tentativas = [];

  for (const fonte of FONTES) {
    const url = fonte.montarUrl({ cnae, uf, cidade, pagina });
    try {
      const resposta = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "EGI-Financeiro/1.0" },
      });

      const texto = await resposta.text();
      let data;
      try {
        data = JSON.parse(texto);
      } catch {
        tentativas.push({ fonte: fonte.nome, status: resposta.status, erro: "resposta não é JSON", amostra: texto.slice(0, 300) });
        continue;
      }

      if (!resposta.ok) {
        tentativas.push({ fonte: fonte.nome, status: resposta.status, corpo: data });
        continue;
      }

      const lista = extrairLista(data);
      if (!Array.isArray(lista) || lista.length === 0) {
        tentativas.push({ fonte: fonte.nome, status: resposta.status, erro: "nenhum resultado", chaves: Object.keys(data || {}) });
        continue;
      }

      const empresas = lista
        .map((e) => normalizar(e, { cidade, uf, cnae }))
        .filter((e) => e.cnpj);

      // Filtra pela cidade digitada (a API pode devolver resultados amplos)
      const cidadeNorm = cidade
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
      const filtradas = cidadeNorm
        ? empresas.filter((e) =>
            (e.cidade || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .includes(cidadeNorm)
          )
        : empresas;

      return res.status(200).json({
        fonte: fonte.nome,
        total: filtradas.length,
        empresas: filtradas.length > 0 ? filtradas : empresas,
        ...(debug ? { amostraBruta: lista[0] } : {}),
      });
    } catch (err) {
      tentativas.push({ fonte: fonte.nome, erro: String(err.message || err) });
    }
  }

  return res.status(502).json({
    erro: "Nenhuma fonte de dados respondeu com resultados.",
    tentativas,
  });
}
