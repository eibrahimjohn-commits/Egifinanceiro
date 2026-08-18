export const FORMAS_PAGAMENTO = [
  { value: "vale", label: "Vale" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "pix_terceiros", label: "PIX para terceiros" },
  { value: "cheque", label: "Cheque" },
  { value: "boleto", label: "Boleto" },
];

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

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
