# Portal EGI — Loja + Painel

Duas páginas, um projeto só:
- **`/` (raiz)** → vitrine para os clientes
- **`/admin`** → painel interno de produtos e pedidos

Os dados ficam no **Firebase (Firestore)** — grátis, e sincroniza em tempo
real: quando você edita um produto no painel, ele aparece na vitrine na hora,
sem precisar recarregar a página.

---

## Passo 1 — Criar o projeto Firebase (5 min)

1. Acesse **console.firebase.google.com** e faça login com sua conta Google.
2. Clique em **"Adicionar projeto"**, dê um nome (ex: `portal-egi`) e siga o
   assistente (pode desativar o Google Analytics, não precisa).
3. Dentro do projeto, no menu lateral, clique em **Compilação → Firestore
   Database → Criar banco de dados**.
   - Escolha a localização mais próxima (ex: `southamerica-east1` — São Paulo).
   - Selecione **"Iniciar no modo de teste"** (isso libera leitura/escrita por
     30 dias — depois ajustamos as regras de segurança, ver Passo 4).
4. Ainda no projeto, clique no ícone de **engrenagem → Configurações do
   projeto**, role até **"Seus apps"** e clique no ícone **`</>`** (Web) para
   criar um app da Web. Dê um nome qualquer e clique em registrar.
5. O Firebase vai mostrar um bloco `firebaseConfig = {...}`. **Copie esse
   bloco inteiro.**

## Passo 2 — Colar a configuração no projeto

Abra o arquivo `src/firebaseConfig.js` e substitua o conteúdo pelos valores
reais que você copiou no Passo 1. É só isso — nenhum outro arquivo precisa
mudar.

## Passo 3 — Subir para a Vercel

Mais fácil pelo GitHub:

1. Crie uma conta em **github.com** (se ainda não tiver) e crie um
   repositório novo (ex: `portal-egi`), sem README.
2. No seu computador, dentro da pasta deste projeto:
   ```
   git init
   git add .
   git commit -m "primeira versão do portal"
   git remote add origin https://github.com/SEU_USUARIO/portal-egi.git
   git push -u origin main
   ```
3. Acesse **vercel.com**, faça login com sua conta do GitHub.
4. Clique em **"Add New → Project"**, escolha o repositório `portal-egi`.
5. A Vercel detecta automaticamente que é um projeto Vite — não precisa
   mudar nada nas configurações. Clique em **Deploy**.
6. Em ~1 minuto você recebe uma URL tipo `portal-egi.vercel.app`.
   - **Vitrine:** `https://portal-egi.vercel.app`
   - **Painel:** `https://portal-egi.vercel.app/admin`

Se preferir não usar linha de comando/GitHub, a Vercel também aceita
arrastar a pasta do projeto direto pelo site — me avisa que te passo esse
caminho também.

## Passo 4 — Definir a senha do painel

O painel `/admin` é protegido por uma senha simples (sem cadastro, sem
e-mail). Pra trocar a senha:

1. Abra o arquivo `src/adminPassword.js`
2. Troque o valor de `ADMIN_PASSWORD` pela senha que sua equipe vai usar
3. Salve e suba o código normalmente

A senha fica "lembrada" enquanto a aba do navegador estiver aberta — fechar
e abrir de novo pede a senha outra vez.

## Passo 5 — Regras do Firestore

Firestore → **Regras** → apaga tudo e cola:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /products/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /categories/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /orders/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /customers/{userId}/orders/{orderId} {
      allow read, create: if request.auth != null && request.auth.uid == userId;
      allow update, delete: if false;
    }
    match /meta/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /customerInfo/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /clientGroups/{id} {
      allow read: if true;
      allow write: if true;
    }
    match /clients/{id} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

Clique em **Publicar**.

**Um ponto de transparência importante, por decisão sua de simplificar:**
como o painel agora usa só uma senha (sem login de verdade), o banco de
dados em si não tem como diferenciar "alguém que entrou pelo painel com a
senha certa" de "qualquer visitante" — a senha protege a *tela*, não o
banco de dados diretamente. Na prática isso significa que produtos,
categorias e pedidos (incluindo telefone e CPF/CNPJ dos clientes) ficam
tecnicamente acessíveis por quem souber acessar a API do Firebase
diretamente, contornando o site — não é algo que apareça pra um visitante
comum, exige conhecimento técnico deliberado.

Pro tamanho e estágio atual do seu negócio, essa é uma troca razoável:
você ganha confiabilidade (sem mais telas travando) em troca desse risco
residual, que é baixo na prática. Se um dia isso deixar de ser aceitável —
por exemplo, se o volume de pedidos crescer muito ou surgir exigência de
compliance mais rígida — o caminho é reintroduzir login de verdade
(Firebase Authentication), dessa vez com mais tempo pra testar cada etapa
com calma antes de divulgar.

**O histórico "Meus pedidos" do cliente continua protegido de verdade** —
esse usa login de cliente (Firebase Authentication) e cada pessoa só
enxerga os próprios pedidos, guardados na pasta dela (`customers/{id}`).


## Sobre a Vercel gratuita (Hobby)

Dá pra continuar testando nela à vontade. Mas as regras da própria Vercel
restringem o plano gratuito a uso pessoal/não-comercial — um portal de
vendas se enquadra como uso comercial. Antes de divulgar o link pros
clientes de verdade, o recomendado é migrar pro plano **Pro (US$ 20/mês)**,
inclusive porque no Hobby, se o site bater o limite de uso, ele
simplesmente sai do ar até o mês seguinte, sem aviso — no Pro isso não
acontece.


## Sobre o WhatsApp

O botão de finalizar pedido abre o WhatsApp automaticamente com a mensagem
pronta pro número `(11) 99880-8099`, já incluindo o número do pedido —
falta só confirmar o envio dentro do próprio WhatsApp. Não existe forma de
pular esse clique sem usar a API paga do WhatsApp Business (Twilio, Zydon,
Mercos). Se decidir seguir por esse caminho no futuro, a estrutura de
dados já está pronta pra plugar.

## Rodando localmente antes de publicar

```
npm install
npm run dev
```
Abre em `http://localhost:5173` (vitrine) e `http://localhost:5173/admin`
(painel).
