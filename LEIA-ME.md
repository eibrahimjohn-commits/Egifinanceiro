# EGI Financeiro

Sistema interno de gestão financeira da EGI: pedidos, vales e recebidos,
pagamentos, cheques devolvidos, análises, base de clientes, prospecção,
histórico, vendas e produtos.

## Stack
- React 19 + Vite 8, instalável como app (PWA) com botão de atualizar manual
- Firebase Firestore com cache offline (config em `src/lib/firebase.js`)
- Funções serverless da Vercel em `api/` (prospecção de empresas/lojas e casamento de CNPJ)

## Estrutura
- `src/App.jsx` controla as abas; cada aba é uma página em `src/pages/`
- `src/lib/` concentra as regras de negócio e o acesso ao Firestore
- `src/components/` guarda peças reutilizáveis (modais, seletores, layout)
- Senha de acesso ao painel: `src/sitePassword.js`

## Variáveis de ambiente (Vercel → Settings → Environment Variables)
- `BASE_EMPRESARIAL_TOKEN` e `CNPJ_WS_TOKEN` (usadas em `api/buscar-empresas.js`)
- `GOOGLE_MAPS_API_KEY` (usada em `api/buscar-lojas.js`)

## Rodando localmente
```
npm install
npm run dev
```
Observação: as rotas `/api/*` só funcionam publicadas na Vercel ou com `vercel dev`.

## Segurança (pendência conhecida)
A senha protege a tela, não o banco. As regras do Firestore estão abertas,
então os dados ficam acessíveis a quem chamar a API do Firebase diretamente.
O caminho definitivo é Firebase Authentication com regras restritas.
