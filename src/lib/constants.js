export const FORMAS_PAGAMENTO = [
  { value: "vale", label: "Vale" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix_ted", label: "PIX/TED" },
  { value: "deposito", label: "Depósito" },
  { value: "conta_terceiros", label: "Conta de 3º" },
  { value: "cheque", label: "Cheque" },
  { value: "boleto", label: "Boleto" },
];

// Formas que são creditadas imediatamente como recebidas ao lançar o pedido
// (cheque conta como recebido pois já está fisicamente em mãos, mesmo com data
// futura; conta de 3º também, pois já entrou o dinheiro, só precisa saber de quem).
// PIX/TED e Depósito ficam de fora — precisam de conferência no extrato antes de
// contar como recebido, por isso sempre passam por Vales primeiro.
export const FORMAS_RECEBIMENTO_IMEDIATO = ["dinheiro", "cheque", "conta_terceiros"];

// Formas que precisam de confirmação futura (checar no extrato) antes de
// contar como realmente recebidas — nunca vão direto pra Recebidos.
export const FORMAS_QUE_PRECISAM_CONFIRMACAO = ["pix_ted", "deposito"];

// Um pedido recém-lançado pode ir direto pra Recebidos (sem passar por Vales)
// quando: sobrou 5% ou menos em aberto E nenhuma das formas de pagamento usadas
// é PIX/Depósito (essas sempre precisam de confirmação futura no extrato).
export function podeIrDireitoParaRecebidos(percentualAberto, formasPagamento) {
  const temFormaQuePrecisaConfirmar = formasPagamento.some((f) => FORMAS_QUE_PRECISAM_CONFIRMACAO.includes(f.tipo));
  return percentualAberto <= 5.0001 && !temFormaQuePrecisaConfirmar;
}

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
// Atraso agora é baseado no Prazo de pagamento do cliente (dias corridos a partir da
// data do pedido), não mais nas parcelas de cheque — cheque já conta como recebido
// (fica em Recebidos), então não deve ser motivo de "atraso".
export function pedidoEstaAtrasado(pedido) {
  if (pedido.status !== "aberto" || pedido.arquivado) return false;
  const prazoDias = Number(pedido.clientePrazo);
  if (!prazoDias || prazoDias <= 0) return false; // sem prazo definido, não dá pra avaliar
  const limite = new Date(new Date(pedido.data + "T00:00:00").getTime() + prazoDias * 86400000);
  return new Date() > limite;
}

// Extrai o percentual numérico de um texto livre de desconto, ex: "5% à vista" -> 5
export function parseDescontoPercent(texto) {
  if (!texto) return 0;
  const match = String(texto).match(/([\d]+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  return parseFloat(match[1].replace(",", "."));
}

// Valor efetivamente devido pelo cliente, já descontado o percentual de desconto (se houver).
export function calcularValorDevido(valorBruto, descontoTexto) {
  const percent = parseDescontoPercent(descontoTexto);
  return Number(valorBruto) * (1 - percent / 100);
}

// Opções fixas de prazo — o valor salvo continua sendo um número de dias
// (o "prazo final" da condição), pra não quebrar nada que já lê esse campo
// (atraso, previsão de recebimento em 30 dias etc.)
export const OPCOES_PRAZO = [
  { label: "À vista", dias: 0 },
  { label: "30 dias", dias: 30 },
  { label: "30 e 60 dias", dias: 60 },
  { label: "30, 60 e 90 dias", dias: 90 },
];

// O desconto sempre foi guardado como um texto livre (ex: "5% à vista" ou
// "5% fixo"), pra não quebrar o parser que já existe (parseDescontoPercent).
// Essas duas funções só separam a edição em dois campos (número + condição)
// e remontam esse mesmo formato de texto ao salvar.
export function parseDescontoCampos(texto) {
  const match = String(texto || "").match(/([\d]+(?:[.,]\d+)?)\s*%/);
  const numero = match ? match[1].replace(",", ".") : "";
  const condicao = /fixo/i.test(texto || "") ? "fixo" : "avista";
  return { numero, condicao };
}
export function montarDescontoTexto(numero, condicao) {
  if (!numero) return "";
  return `${numero}% ${condicao === "fixo" ? "fixo" : "à vista"}`;
}

// Dias limite pra uma condição "à vista" ainda dar direito ao desconto.
const PRAZO_MAXIMO_DESCONTO_AVISTA = 7;

// Decide se o desconto padrão do cliente vale PRA ESSE pedido específico:
// - condição "fixo" -> sempre vale.
// - condição "à vista" -> só vale se o prazo de pagamento usado nesse pedido
//   for de até 7 dias (ex: cliente escolheu "À vista" no prazo).
// Retorna o texto de desconto a gravar no pedido — vazio quando não se aplica,
// pra não gravar um desconto que na prática não valeu dessa vez.
export function descontoAplicavelAoPedido(descontoPadrao, prazoDias) {
  const { numero, condicao } = parseDescontoCampos(descontoPadrao);
  if (!numero) return "";
  if (condicao === "fixo") return descontoPadrao;
  return Number(prazoDias) <= PRAZO_MAXIMO_DESCONTO_AVISTA ? descontoPadrao : "";
}

// Fonte única de verdade pro "valor total" de um pedido: sempre a soma dos
// itens (compras) daquele pedido, com o desconto aplicado — nunca um campo
// solto que possa ficar desatualizado ou divergir do que está listado em
// "Compras". Pedidos sem itens (não deveria acontecer, mas por segurança)
// caem pro campo valor/valorDevido gravado.
export function valorDevidoDoPedido(p) {
  if (p.itens?.length > 0) {
    const bruto = p.itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
    return calcularValorDevido(bruto, p.desconto);
  }
  return Number(p.valorDevido ?? p.valor) || 0;
}

// Saldo em aberto de um pedido = valor total (soma das compras, já com
// desconto) - o que já foi pago.
export function saldoDoPedido(p) {
  return valorDevidoDoPedido(p) - (Number(p.valorPago) || 0);
}

export const CONTAS_PADRAO = [
  "Itaú - EGIJJ",
  "Bradesco - EGIJJ",
  "Bradesco - EGI",
  "Stone - EGIJJ",
  "Terceiros",
];

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

// Gera o link do WhatsApp com o número já formatado (adiciona 55 se faltar) e a
// mensagem de reengajamento pronta pro cliente inativo.
export function linkWhatsAppInativo(telefone, nomeCliente) {
  let digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length <= 11) digitos = "55" + digitos; // adiciona DDI Brasil se faltar
  const mensagem =
    `Olá ${nomeCliente}, tudo bem?\n` +
    `Percebi que faz um tempo que não compra com a gente, como foi a saída do último pedido? ` +
    `Posso estar enviando nosso novo catálogo com muitas novidades? 😁\n` +
    `Aguardo retorno`;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

// --- Lógica de status "resumo do cliente" na aba Vales ---------------------
// percentual em aberto = saldo em aberto / valor total devido, em %.
// Negativo = cliente pagou a mais (crédito).
export function calcularPercentualAberto(saldo, totalDevido) {
  if (!totalDevido || totalDevido === 0) return 0;
  return (saldo / totalDevido) * 100;
}

// Tag exibida no resumo do cliente, considerando o percentual em aberto:
// - saldo negativo (pagou a mais) -> "A ver"
// - percentual <= 1% -> "Pago" (mas só sai da lista quando movido manualmente)
// - percentual <= 10% (inclui atrasado) -> continua "Em aberto"/"Atrasado", mas já
//   libera o botão de mover pra recebidos
export function tagResumoCliente(saldo, percentual, atrasado) {
  if (saldo < -0.01) return { texto: "A ver", classe: "badge-aver" };
  if (percentual <= 1.0001) return { texto: "Pago", classe: "badge-pago" };
  if (atrasado) return { texto: "Atrasado", classe: "badge-atraso" };
  return { texto: "Em aberto", classe: "badge-aberto" };
}

// Pode mover manualmente pra Recebidos quando o percentual em aberto (ignorando
// sinal, já que crédito também conta como "resolvido") for <= 10%.
export function podeMoverParaRecebidos(percentual) {
  return percentual <= 10.0001;
}
