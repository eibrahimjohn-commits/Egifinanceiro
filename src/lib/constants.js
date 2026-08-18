export const FORMAS_PAGAMENTO = [
  { value: "vale", label: "Vale" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix_ted", label: "PIX/TED" },
  { value: "deposito", label: "Depósito" },
  { value: "conta_terceiros", label: "Conta de 3º" },
  { value: "cheque", label: "Cheque" },
  { value: "boleto", label: "Boleto" },
];

// Formas que são creditadas imediatamente como recebidas ao lançar o pedido.
// Todas as outras ficam em aberto (Vales) até serem conferidas/baixadas.
export const FORMAS_RECEBIMENTO_IMEDIATO = ["dinheiro"];

// Divide um valor total em N parcelas iguais, ajustando centavos na última parcela.
export function dividirValorIgualmente(valorTotal, numParcelas) {
  const total = Math.round(Number(valorTotal) * 100);
  const n = Math.max(1, Number(numParcelas) || 1);
  const base = Math.floor(total / n);
  const resto = total - base * n;
  const valores = Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
  return valores.map((v) => v / 100);
}

// Gera as datas das parcelas do cheque, igualmente espaçadas entre hoje e o prazo do último cheque.
export function calcularParcelasCheque(prazoUltimoCheque, numFolhas, valorTotal) {
  const n = Math.max(1, Number(numFolhas) || 1);
  const valores = dividirValorIgualmente(valorTotal, n);
  const hoje = new Date();
  const dataFinal = new Date(prazoUltimoCheque + "T00:00:00");
  const diffDias = Math.max(0, Math.round((dataFinal - hoje) / 86400000));
  const passo = n > 1 ? diffDias / (n - 1) : 0;

  return valores.map((valor, i) => {
    const dias = n > 1 ? Math.round(passo * i) : diffDias;
    const data = new Date(hoje.getTime() + dias * 86400000);
    return {
      numero: i + 1,
      valor,
      data: data.toISOString().slice(0, 10),
    };
  });
}

export const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

export function formatCurrency(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = typeof dateStr === "string" ? new Date(dateStr + "T00:00:00") : dateStr;
  return d.toLocaleDateString("pt-BR");
}

// Um pedido em aberto é considerado atrasado se tiver parcela(s) de cheque
// cuja data já passou (assumindo que ainda não foi baixado).
export function pedidoEstaAtrasado(pedido) {
  if (pedido.status !== "aberto") return false;
  const hoje = new Date();
  const formas = pedido.formasPagamento || [];
  return formas.some((f) => {
    if (f.tipo !== "cheque" || !f.parcelas) return false;
    return f.parcelas.some((p) => new Date(p.data + "T00:00:00") < hoje);
  });
}

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
