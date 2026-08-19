import * as XLSX from "xlsx";

const ALIASES = {
  codigo: ["cód", "cod", "código", "codigo"],
  nome: ["nome", "nome fantasia", "fantasia"],
  razaoSocial: ["razão social", "razao social"],
  cnpj: ["cnpjcpf", "cnpj/cpf", "cnpj", "cpf"],
  cidade: ["cidade"],
  estado: ["uf", "estado"],
};

function normalizar(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function encontrarColuna(headers, aliases) {
  const idx = headers.findIndex((h) => aliases.includes(normalizar(h)));
  return idx;
}

// Lê um arquivo .xlsx (File do input) e retorna linhas de clientes já mapeadas.
export async function lerPlanilhaClientes(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  // Usa a aba "Report" se existir, senão a primeira aba
  const nomeAba = workbook.SheetNames.find((n) => normalizar(n) === "report") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[nomeAba];
  const linhasBrutas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (linhasBrutas.length < 2) return { linhas: [], aba: nomeAba };

  const headers = linhasBrutas[0].map(normalizar);
  const col = {
    codigo: encontrarColuna(headers, ALIASES.codigo),
    nome: encontrarColuna(headers, ALIASES.nome),
    razaoSocial: encontrarColuna(headers, ALIASES.razaoSocial),
    cnpj: encontrarColuna(headers, ALIASES.cnpj),
    cidade: encontrarColuna(headers, ALIASES.cidade),
    estado: encontrarColuna(headers, ALIASES.estado),
  };

  if (col.codigo === -1) {
    throw new Error('Não encontrei uma coluna de código (ex: "CÓD") na planilha.');
  }

  const linhas = [];
  for (let i = 1; i < linhasBrutas.length; i++) {
    const linha = linhasBrutas[i];
    const codigo = linha[col.codigo];
    if (codigo === "" || codigo === undefined || codigo === null) continue;

    const razaoSocial = col.razaoSocial >= 0 ? String(linha[col.razaoSocial] || "").trim() : "";
    const nome = (col.nome >= 0 ? String(linha[col.nome] || "").trim() : "") || razaoSocial || `Cliente ${codigo}`;

    linhas.push({
      codigo: String(codigo).trim(),
      nome,
      razaoSocial,
      cnpj: col.cnpj >= 0 ? String(linha[col.cnpj] || "").trim() : "",
      cidade: col.cidade >= 0 ? String(linha[col.cidade] || "").trim() : "",
      estado: col.estado >= 0 ? String(linha[col.estado] || "").trim() : "",
    });
  }

  return { linhas, aba: nomeAba };
}
