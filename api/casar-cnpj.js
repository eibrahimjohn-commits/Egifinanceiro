// Tenta descobrir o CNPJ de uma loja encontrada no Google Maps, cruzando nome
// e endereço com a base de empresas da cidade.
//
// IMPORTANTE — por que isso devolve SUGESTÕES e não uma resposta definitiva:
// o nome que aparece no Maps é o nome comercial ("Bijoux da Ana"), enquanto na
// Receita a empresa costuma estar como razão social ("ANA MARIA SILVA
// 12345678900"). Nem sempre dá pra ligar os dois com certeza. Por isso aqui
// nunca gravamos nada automaticamente: devolvemos os candidatos com uma nota
// de confiança e quem decide é a pessoa. Um CNPJ errado num sistema financeiro
// é pior do que CNPJ nenhum.

function normalizar(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palavras que não ajudam a distinguir uma empresa da outra.
const RUIDO = new Set([
  "ltda", "me", "epp", "eireli", "sa", "s", "a", "comercio", "comercial",
  "de", "da", "do", "das", "dos", "e", "em", "loja", "lojas", "rua", "avenida",
  "av", "r", "n", "no", "numero", "brasil",
]);

function tokens(str) {
  return normalizar(str).split(" ").filter((t) => t.length > 2 && !RUIDO.has(t));
}

// Nota de 0 a 100. Endereço pesa mais que nome, porque endereço é objetivo e
// o nome comercial muda com frequência.
function pontuar(alvo, candidato) {
  const tokensNome = tokens(alvo.nome);
  const tokensCand = new Set([...tokens(candidato.razaoSocial), ...tokens(candidato.nomeFantasia)]);
  const nomeAcertos = tokensNome.filter((t) => tokensCand.has(t)).length;
  const notaNome = tokensNome.length ? (nomeAcertos / tokensNome.length) * 40 : 0;

  const enderecoAlvo = normalizar(alvo.endereco);
  const enderecoCand = normalizar(candidato.logradouro);
  let notaEndereco = 0;
  if (enderecoCand && enderecoAlvo) {
    const tokensEnd = tokens(candidato.logradouro);
    const acertos = tokensEnd.filter((t) => enderecoAlvo.includes(t)).length;
    if (tokensEnd.length) notaEndereco = (acertos / tokensEnd.length) * 40;
  }

  // Número da rua batendo é um sinal forte — vale um bônus próprio.
  const numAlvo = (alvo.endereco || "").match(/\b(\d{1,5})\b/);
  const numCand = (candidato.logradouro || "").match(/\b(\d{1,5})\b/);
  const bonusNumero = numAlvo && numCand && numAlvo[1] === numCand[1] ? 20 : 0;

  return Math.round(notaNome + notaEndereco + bonusNumero);
}

async function resolverCidadeIbge(cidadeNome, uf) {
  const url = uf
    ? `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`
    : `https://servicodados.ibge.gov.br/api/v1/localidades/municipios`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Não consegui consultar a lista de municípios do IBGE.");
  const lista = await resp.json();
  const alvo = normalizar(cidadeNome);
  return lista.find((m) => normalizar(m.nome) === alvo)
    || lista.find((m) => normalizar(m.nome).includes(alvo))
    || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { nome = "", endereco = "", cidade = "", uf = "" } = req.query;
  if (!nome || !cidade) {
    return res.status(400).json({ erro: "Informe ao menos o nome da loja e a cidade." });
  }

  let municipio;
  try {
    municipio = await resolverCidadeIbge(cidade, uf);
  } catch (e) {
    return res.status(502).json({ erro: "Falha ao consultar o IBGE: " + e.message });
  }
  if (!municipio) return res.status(404).json({ erro: `Cidade "${cidade}" não encontrada no IBGE.` });

  const alvo = { nome, endereco };
  const candidatos = [];

  // Varre a base de empresas da cidade procurando quem se parece com a loja.
  // Varremos mais páginas aqui do que na busca genérica porque agora existe um
  // alvo concreto — e paramos assim que aparece um candidato muito bom.
  const PER_PAGE = 100;
  const MAX_PAGINAS = 12;
  const LIMITE_OTIMO = 80;

  try {
    for (let p = 1; p <= MAX_PAGINAS; p++) {
      const params = new URLSearchParams();
      params.append("filter[city_ibge_code]", String(municipio.id));
      params.append("per_page", String(PER_PAGE));
      params.append("page", String(p));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      let json;
      try {
        const r = await fetch(`https://app.baseempresarial.com.br/api/v1/establishments?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const texto = await r.text();
        json = texto ? JSON.parse(texto) : {};
        if (!r.ok) throw new Error(json?.message || `HTTP ${r.status}`);
      } finally {
        clearTimeout(timer);
      }

      const lista = Array.isArray(json) ? json : (json?.data || json?.results || []);
      if (lista.length === 0) break;

      lista.forEach((e) => {
        const cand = {
          cnpj: String(e.full_cnpj || e.id || "").replace(/\D/g, ""),
          razaoSocial: e.trade_name || "",
          nomeFantasia: e.trade_name || "",
          logradouro: e.address
            ? [e.address.street_type, e.address.street, e.address.number].filter(Boolean).join(" ")
            : "",
          bairro: e.address?.neighborhood || "",
          situacaoCadastral: e.registration_status?.name || "",
        };
        if (!cand.cnpj) return;
        const nota = pontuar(alvo, cand);
        if (nota >= 30) candidatos.push({ ...cand, nota });
      });

      if (candidatos.some((c) => c.nota >= LIMITE_OTIMO)) break;
      if (lista.length < PER_PAGE) break;
    }
  } catch (e) {
    return res.status(502).json({
      erro: "Não consegui varrer a base de empresas dessa cidade: " + String(e.message || e),
      dica: "Essa etapa depende da Base Empresarial, que tem apresentado instabilidade. Você pode informar o CNPJ manualmente que o resto dos dados é preenchido automaticamente.",
    });
  }

  candidatos.sort((a, b) => b.nota - a.nota);

  return res.status(200).json({
    total: candidatos.length,
    candidatos: candidatos.slice(0, 5),
    municipioResolvido: municipio.nome,
  });
}
