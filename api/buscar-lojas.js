// Busca LOJAS DE VERDADE pelo Google Places, em vez de CNPJs na base da Receita.
//
// Por que isso é melhor pra prospecção de varejo:
//  - só aparece quem existe de fato e está operando (o Google remove/marca
//    fechados), enquanto a base da Receita está cheia de CNPJ inativo e MEI
//    sem loja física;
//  - vem telefone e endereço já prontos pra abordagem;
//  - a busca é por termo livre ("bijuteria", "acessórios femininos"), então
//    não depende do lojista ter escolhido o CNAE "certo" no cadastro — que é
//    justamente onde a busca por CNAE falhava.
//
// Custo: o Text Search com telefone entra na faixa Enterprise do Google, que
// tem 1.000 chamadas grátis por mês. Cada chamada traz até 20 lojas, então dá
// aproximadamente 20 mil lojas/mês sem custo — muito acima do uso de vocês.
// Precisa de GOOGLE_MAPS_API_KEY nas variáveis de ambiente da Vercel.

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Só os campos necessários. Isso importa no bolso: o Google cobra pela faixa
// mais cara entre os campos pedidos, então nada de "rating" ou "reviews" aqui.
const CAMPOS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      erro: "A busca por lojas ainda não está configurada. Falta cadastrar GOOGLE_MAPS_API_KEY nas variáveis de ambiente da Vercel.",
    });
  }

  const { termo = "", cidade = "", uf = "", pageToken = "" } = req.query;

  if (!termo || !cidade) {
    return res.status(400).json({ erro: "Informe o que buscar e a cidade." });
  }

  const textQuery = `${termo} em ${cidade}${uf ? " - " + uf : ""}`;

  try {
    const corpo = { textQuery, languageCode: "pt-BR", regionCode: "BR" };
    // O pageToken traz as páginas seguintes da MESMA busca. O Google devolve
    // no máximo 60 resultados por consulta (3 páginas de 20) — por isso a tela
    // sugere variar o termo pra ampliar a cobertura.
    if (pageToken) corpo.pageToken = pageToken;

    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": CAMPOS,
      },
      body: JSON.stringify(corpo),
    });

    const texto = await r.text();
    let json;
    try {
      json = texto ? JSON.parse(texto) : {};
    } catch {
      return res.status(502).json({ erro: `Resposta inesperada do Google (HTTP ${r.status}).` });
    }

    if (!r.ok) {
      const msg = json?.error?.message || `Falha na busca (HTTP ${r.status}).`;
      let dica = "";
      if (r.status === 403) dica = " Verifique se a Places API (New) está ativada no projeto e se a chave tem permissão.";
      if (r.status === 429) dica = " Cota excedida — espere um pouco ou confira o limite no Google Cloud.";
      return res.status(502).json({ erro: "Google: " + msg + dica });
    }

    const lojas = (json.places || [])
      // Lojas marcadas como fechadas em definitivo não servem pra prospecção.
      .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
      .map((p) => ({
        placeId: p.id,
        nome: p.displayName?.text || "",
        endereco: p.formattedAddress || "",
        telefone: p.nationalPhoneNumber || "",
        site: p.websiteUri || "",
        categoria: p.primaryTypeDisplayName?.text || "",
        situacao: p.businessStatus === "OPERATIONAL" ? "Aberta" : (p.businessStatus || ""),
      }));

    return res.status(200).json({
      total: lojas.length,
      lojas,
      proximoPageToken: json.nextPageToken || null,
      consulta: textQuery,
    });
  } catch (err) {
    return res.status(502).json({ erro: "Erro ao buscar no Google: " + String(err.message || err) });
  }
}
