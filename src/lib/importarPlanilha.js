import * as XLSX from "xlsx";

const ALIASES = {
  codigo: ["cód", "cod", "código", "codigo"],
  nome: ["nome", "nome fantasia", "fantasia"],
  razaoSocial: ["razão social", "razao social"],
  cnpj: ["cnpjcpf", "cnpj/cpf", "cnpj", "cpf", "cnpj cpf", "documento"],
  cidade: ["cidade", "municipio", "município"],
  estado: ["uf", "estado"],
  representante: ["representante", "rep", "vendedor"],
  ultimaCompra: ["ultm compra", "ultima compra", "última compra", "ult compra", "data ultima compra"],
  mediaCompra: ["media de comp", "média de comp", "media compra", "média compra", "ticket medio"],
  contato: ["contato"],
  fone: ["fone", "telefone"],
  cel: ["cel", "celular"],
  foneOutro: ["fone outro", "outro fone", "telefone 2", "fone 2"],
  whatsapp: ["whatsapp", "whats", "zap"],
  cep: ["cep"],
};

// Normaliza telefone brasileiro para só dígitos, ex: "(11)97466-1318" -> "11974661318"
export function limparTelefone(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d;
}

// Converte a data vinda do Excel (Date, serial numérico ou texto) para "AAAA-MM-DD"
export function normalizarData(valor) {
  if (!valor && valor !== 0) return "";
  if (valor instanceof Date && !isNaN(valor)) {
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === "number") {
    // serial do Excel: dias desde 30/12/1899
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? "" : d.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  if (!texto) return "";
  // dd/mm/aaaa
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(texto);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

function normalizar(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function encontrarColuna(headers, aliases) {
  return headers.findIndex((h) => aliases.includes(normalizar(h)));
}

// O Excel guarda CNPJ/CPF como número e come os zeros à esquerda.
// Ex: 05099855000152 vira 5099855000152. Aqui recuperamos os zeros.
export function corrigirDocumento(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.length > 14) return digitos.slice(0, 14);
  if (digitos.length === 14 || digitos.length === 11) return digitos;
  // 12 a 13 dígitos -> provavelmente um CNPJ que perdeu zeros
  if (digitos.length >= 12) return digitos.padStart(14, "0");
  // 9 a 11 dígitos -> provavelmente um CPF que perdeu zeros
  if (digitos.length >= 9) return digitos.padStart(11, "0");
  // muito curto: devolve como está, sem inventar
  return digitos;
}

// Lê um .xlsx e devolve as linhas de clientes. Nenhum campo é obrigatório:
// linhas sem código, sem nome ou sem documento também são importadas.
export async function lerPlanilhaClientes(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const nomeAba =
    workbook.SheetNames.find((n) => normalizar(n) === "report") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[nomeAba];
  const linhasBrutas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (linhasBrutas.length < 2) {
    return { linhas: [], aba: nomeAba, diagnostico: { totalLinhas: 0, ignoradasVazias: 0, semCodigo: 0, cpf: 0, cnpj: 0, semDocumento: 0, zerosRecuperados: 0 } };
  }

  const headers = linhasBrutas[0].map(normalizar);
  const col = {
    codigo: encontrarColuna(headers, ALIASES.codigo),
    nome: encontrarColuna(headers, ALIASES.nome),
    razaoSocial: encontrarColuna(headers, ALIASES.razaoSocial),
    cnpj: encontrarColuna(headers, ALIASES.cnpj),
    cidade: encontrarColuna(headers, ALIASES.cidade),
    estado: encontrarColuna(headers, ALIASES.estado),
    representante: encontrarColuna(headers, ALIASES.representante),
    ultimaCompra: encontrarColuna(headers, ALIASES.ultimaCompra),
    mediaCompra: encontrarColuna(headers, ALIASES.mediaCompra),
    contato: encontrarColuna(headers, ALIASES.contato),
    fone: encontrarColuna(headers, ALIASES.fone),
    cel: encontrarColuna(headers, ALIASES.cel),
    foneOutro: encontrarColuna(headers, ALIASES.foneOutro),
    whatsapp: encontrarColuna(headers, ALIASES.whatsapp),
    cep: encontrarColuna(headers, ALIASES.cep),
  };

  const linhas = [];
  const diagnostico = {
    totalLinhas: linhasBrutas.length - 1,
    ignoradasVazias: 0,
    semCodigo: 0,
    cpf: 0,
    cnpj: 0,
    semDocumento: 0,
    zerosRecuperados: 0,
    comTelefone: 0,
    comUltimaCompra: 0,
  };

  const pega = (linha, idx) => (idx >= 0 ? String(linha[idx] ?? "").trim() : "");

  for (let i = 1; i < linhasBrutas.length; i++) {
    const linha = linhasBrutas[i];

    // só ignora se a linha inteira estiver vazia
    const temAlgumaCoisa = linha.some((v) => String(v ?? "").trim() !== "");
    if (!temAlgumaCoisa) {
      diagnostico.ignoradasVazias++;
      continue;
    }

    const codigoBruto = pega(linha, col.codigo);
    const docBruto = pega(linha, col.cnpj);
    const documento = corrigirDocumento(docBruto);

    const digitosOriginais = docBruto.replace(/\D/g, "");
    if (documento && digitosOriginais && documento.length > digitosOriginais.length) {
      diagnostico.zerosRecuperados++;
    }
    if (!documento) diagnostico.semDocumento++;
    else if (documento.length === 11) diagnostico.cpf++;
    else if (documento.length === 14) diagnostico.cnpj++;

    if (!codigoBruto) diagnostico.semCodigo++;

    const razaoSocial = pega(linha, col.razaoSocial);
    const nomeCol = pega(linha, col.nome);
    const nome = nomeCol || razaoSocial || (codigoBruto ? `Cliente ${codigoBruto}` : "Sem nome");

    // chave estável: código, senão documento, senão a posição da linha
    const chave = codigoBruto || documento || `linha${i}`;

    const bruto = (idx) => (idx >= 0 ? linha[idx] : "");

    const telefones = [
      limparTelefone(pega(linha, col.fone)),
      limparTelefone(pega(linha, col.cel)),
      limparTelefone(pega(linha, col.foneOutro)),
    ].filter((t) => t.length >= 8);
    const whatsapp = limparTelefone(pega(linha, col.whatsapp));
    const ultimaCompra = normalizarData(bruto(col.ultimaCompra));

    if (telefones.length > 0 || whatsapp) diagnostico.comTelefone++;
    if (ultimaCompra) diagnostico.comUltimaCompra++;

    const mediaTexto = pega(linha, col.mediaCompra).replace(/[^\d,.-]/g, "").replace(",", ".");
    const mediaCompra = mediaTexto ? Number(mediaTexto) || 0 : 0;

    linhas.push({
      codigo: codigoBruto,
      chave,
      nome,
      razaoSocial,
      cnpj: documento,
      cidade: pega(linha, col.cidade),
      estado: pega(linha, col.estado),
      representante: pega(linha, col.representante),
      cep: pega(linha, col.cep),
      contato: pega(linha, col.contato),
      telefones,
      whatsapp,
      ultimaCompra,
      mediaCompra,
    });
  }

  return { linhas, aba: nomeAba, diagnostico };
}
