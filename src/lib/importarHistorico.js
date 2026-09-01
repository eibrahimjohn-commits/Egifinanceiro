import * as XLSX from "xlsx";

const SITUACOES_QUEBRADAS = ["#DIV/0!", "#REF!", "#N/A", "#VALUE!"];

function limparCampo(v) {
  if (SITUACOES_QUEBRADAS.includes(v)) return "";
  return v ?? "";
}

function ehData(v) {
  return v instanceof Date && !isNaN(v);
}

function dataISO(v) {
  return v.toISOString().slice(0, 10);
}

// Processa uma aba no formato Pranchteta/PAGOS:
// Cod | Cliente | UF | Representante | Veri | Situação | Em Aberto | PF | Total Pedidos |
// depois blocos repetidos de 3 colunas: Valor | tipo/conta | data
//   - Valor positivo = compra (nova adição ao pedido)
//   - Valor negativo = pagamento
//   - Coluna do meio: texto = conta que recebeu o pagamento; número positivo = outra
//     compra na mesma data
function processarAba(linhasBrutas, nomeAba) {
  const pedidos = [];
  const ignoradas = [];

  for (let r = 1; r < linhasBrutas.length; r++) {
    const linha = linhasBrutas[r];
    const cod = linha[0];
    const cliente = linha[1];
    const uf = limparCampo(linha[2]);
    const representante = limparCampo(linha[3]);
    const situacao = linha[5];
    const emAberto = linha[6];
    const totalPedidos = linha[8];

    if (cliente === null || cliente === undefined || cliente === 0 || cliente === "" || cliente === "0") {
      continue;
    }
    if (SITUACOES_QUEBRADAS.includes(situacao)) {
      ignoradas.push({ aba: nomeAba, linha: r + 1, cliente: String(cliente), motivo: `situação quebrada (${situacao})` });
      continue;
    }
    if (typeof totalPedidos !== "number" || typeof emAberto !== "number") {
      ignoradas.push({ aba: nomeAba, linha: r + 1, cliente: String(cliente), motivo: "valor não numérico" });
      continue;
    }

    const itens = [];
    const pagamentos = [];

    for (let col = 9; col + 2 < linha.length; col += 3) {
      const valor = linha[col];
      const tipo = linha[col + 1];
      const data = linha[col + 2];

      if (typeof valor !== "number" || valor === 0) continue;
      if (!ehData(data)) continue;

      const nota = typeof tipo === "string" && tipo.trim() ? tipo.trim() : null;

      if (valor > 0) {
        itens.push({ valor, data: dataISO(data) });
        if (typeof tipo === "number" && tipo > 0) {
          itens.push({ valor: tipo, data: dataISO(data) });
        }
      } else {
        pagamentos.push({ valor: -valor, data: dataISO(data), conta: nota });
      }
    }

    pedidos.push({
      aba: nomeAba,
      linha: r + 1,
      codigo: cod ? String(cod).trim() : "",
      nome: String(cliente).trim(),
      uf: uf ? String(uf).trim() : "",
      representante: representante ? String(representante).trim() : "",
      situacao: String(situacao || "").trim(),
      emAberto,
      totalPedidos,
      itens,
      pagamentos,
    });
  }

  return { pedidos, ignoradas };
}

// Lê o arquivo e processa as abas Pranchteta e PAGOS (contas em aberto + histórico de pagos)
export async function lerHistoricoPedidos(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const abasAlvo = workbook.SheetNames.filter((n) =>
    ["pranchteta", "pagos"].includes(n.toLowerCase().trim())
  );

  let pedidos = [];
  let ignoradas = [];

  for (const nomeAba of abasAlvo) {
    const sheet = workbook.Sheets[nomeAba];
    const linhasBrutas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const resultado = processarAba(linhasBrutas, nomeAba);
    pedidos = pedidos.concat(resultado.pedidos);
    ignoradas = ignoradas.concat(resultado.ignoradas);
  }

  return { pedidos, ignoradas, abasEncontradas: abasAlvo };
}
