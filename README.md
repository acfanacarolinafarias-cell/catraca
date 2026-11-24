# Catraca · Ingressos

Site de venda de ingressos e gestão de eventos. Ele roda no GitHub Pages, e o login e os dados ficam no [Supabase](https://supabase.com) (plano gratuito).

## Quem faz o quê

| Papel | Como vira esse papel | O que pode fazer |
|---|---|---|
| **Administração** | Conta marcada como `admin` no banco (passo 4 abaixo) | Cria eventos e os vincula a organizadores, cadastra organizadores (PF ou PJ), define a cobrança da plataforma (padrão e por evento) e vê tudo. |
| **Organizador** | A administração cadastra a pessoa pelo e-mail. Quando ela cria a conta no site com esse e-mail e confirma, recebe o acesso. | Cria os próprios eventos e gerencia **só os eventos vinculados a ela**: informações, publicação, lotes e preços, financeiro (vendas, comissão, repasse, despesas), pedidos (com exportação CSV) e validação de entrada. Também atualiza o próprio PIX e os dados bancários. |
| **Portaria** | O organizador cadastra a pessoa (nome e e-mail) em **Meus eventos → Equipe de portaria** e marca os eventos liberados. Ela cria a conta com esse e-mail. | Só lê o QR Code e valida ingressos dos eventos liberados, sempre do mesmo organizador. Não vê vendas, valores, despesas nem e-mails de compradores, e não altera nada. |
| **Comprador** | Qualquer pessoa que cria conta | Compra ingressos (inteira e meia-entrada) e vê os próprios códigos em "Meus ingressos". |

Quem não está logado vê a programação, mas precisa entrar para comprar.

### Fluxo para vincular um evento a um organizador

1. **Administração → Organizadores → Novo organizador**: escolha PF ou PJ e preencha nome ou razão social, CPF ou CNPJ (o dígito verificador é conferido) e o e-mail de acesso.
2. **Administração → Eventos → Criar evento**: já dá para escolher o organizador no formulário, ou deixar sem organizador e vincular depois.
3. Para vincular ou trocar depois, use a coluna "Organizador" na lista de eventos, ou a página do organizador (**Vincular evento** / **Desvincular**).
4. O organizador cria a conta em **Entrar → Criar conta** com o mesmo e-mail e confirma pelo link. Os eventos dele aparecem em **Meus eventos**.

As regras de permissão ficam no próprio banco (Row Level Security). Assim, mesmo que alguém mexa no código do navegador, um organizador não lê nem altera o evento de outro, e um comprador não vê pedidos alheios.

### Atualizar o banco depois de uma nova versão

Quando o arquivo `supabase/schema.sql` mudar, rode-o inteiro de novo no **SQL Editor**. Ele não apaga dados: só cria o que falta e recria regras e funções.

## Como colocar no ar

### 1. Criar o banco no Supabase

1. Crie uma conta e um projeto em [supabase.com](https://supabase.com). A região `South America (São Paulo)` deixa o site mais rápido no Brasil.
2. No projeto, abra **SQL Editor → New query**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.

### 2. Configurar login e endereços

Em **Authentication → URL Configuration**:

- **Site URL**: `https://acfanacarolinafarias-cell.github.io/catraca/`
- **Redirect URLs**: adicione `https://acfanacarolinafarias-cell.github.io/catraca/**`

Em **Authentication → Sign In / Providers → Email**, deixe **Confirm email** ligado. Isso impede que alguém crie uma conta com o e-mail de um organizador sem ter acesso a esse e-mail.

> O e-mail de confirmação padrão do Supabase tem limite baixo de envios por hora. Para uso real, configure um SMTP próprio em **Authentication → Emails → SMTP Settings** (ex.: Resend, Brevo, Amazon SES).

### 3. Ligar o site ao banco

Em **Project Settings → API** (ou **Data API**), copie:

- **Project URL**
- **anon / publishable key**

Cole os dois em [`assets/config.js`](assets/config.js) e faça commit. A chave *anon* é feita para ficar pública: quem protege os dados são as regras do passo 1. **Nunca** coloque a chave `service_role` / `secret` no site.

### 4. Tornar-se administradora

1. Abra o site e crie sua conta em **Entrar → Criar conta**. Confirme o e-mail.
2. No Supabase, em **SQL Editor**, rode (trocando pelo seu e-mail):

   ```sql
   update public.profiles set role = 'admin' where email = 'seu-email@exemplo.com';
   ```

3. Saia e entre de novo no site. O menu **Administração** aparece.

### 5. GitHub Pages

O site é estático (HTML, CSS e JavaScript, sem etapa de build). Em **Settings → Pages** do repositório, a fonte é **Deploy from a branch → `main` / `(root)`**. Cada commit na `main` atualiza o site em 1 ou 2 minutos.

## Pagamento online (Asaas, com divisão automática)

- O comprador escolhe **Pix** ou **cartão**. A tarifa do meio de pagamento é **somada ao total dele** (valores em Administração → Configurações).
- As vagas ficam reservadas por alguns minutos (padrão 15) enquanto ele paga. Sem pagamento, voltam para a venda.
- Quando o Asaas avisa que o pagamento caiu, o pedido é confirmado e os ingressos com QR Code aparecem.
- A parte do organizador (vendas − cobrança da plataforma − taxa de split) vai **direto para a carteira Asaas dele** (split). O restante fica na conta da plataforma.
- Cada organizador informa o **Wallet ID** do Asaas em "Dados cadastrais e de recebimento". Sem ele, o evento não vende online.
- Pagamento que chega depois do prazo, com ingressos esgotados, aparece em Administração para devolução.

### Peças

```
supabase/functions/checkout          cria a cobrança (chamado pelo site)
supabase/functions/payment-webhook   recebe o aviso de pagamento do Asaas
supabase/functions/_shared/providers  um arquivo por meio de pagamento (asaas.ts)
.github/workflows/deploy-functions.yml publica as funções no Supabase a cada mudança
```

**Trocar de meio de pagamento no futuro:** crie `supabase/functions/_shared/providers/<nome>.ts` implementando a interface de `types.ts`, registre em `index.ts` e altere `payment_provider` na tabela `settings`. O resto do sistema (reservas, ingressos, financeiro) não muda.

### Segredos no Supabase (Edge Functions → Secrets)

| Nome | Valor |
|---|---|
| `ASAAS_API_KEY` | chave de API da conta da plataforma no Asaas |
| `ASAAS_ENV` | `sandbox` para testes, `production` para valer |
| `ASAAS_WEBHOOK_TOKEN` | código secreto (32+ caracteres) que você também cadastra no webhook do Asaas |

Webhook no Asaas (Integrações → Webhooks): URL `https://xfrbybveoschauaaxmbk.supabase.co/functions/v1/payment-webhook?provider=asaas`, eventos de **cobrança** (PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED).

## Cupons de desconto

O organizador (ou a administração) cria cupons em **Gerenciar evento → Cupons**. Quem cria escolhe o tipo (% ou R$ fixo por ingresso), os lotes (nenhum = todos), se vale para meia-entrada, o limite de usos, se é uma vez por pessoa e a validade.

- O desconto sai **só da parte do organizador**. A taxa de serviço e a cobrança da plataforma continuam sobre o preço cheio.
- O banco recusa um cupom que deixaria a parte do organizador abaixo da cobrança da plataforma (ex.: 100%).
- Reserva que expira sem pagamento devolve o uso do cupom.

## Dinheiro: como os valores são calculados

- **Preço da meia-entrada** = metade da inteira; ela usa a mesma lotação do lote.
- **Taxa de serviço** (% por evento) é somada ao total pago pelo comprador e fica com a plataforma.
- **Cobrança da plataforma**, por evento: **percentual** sobre as vendas (padrão) **ou valor fixo em R$ por ingresso vendido** (inteira e meia contam igual).
- Taxa de serviço e cobrança da plataforma **só a administração altera**. O padrão fica em **Administração → Configurações** e é aplicado aos eventos que os organizadores criam.
- **Repasse previsto** = vendas − cobrança da plataforma.
- **Resultado** = repasse − despesas lançadas pelo organizador.

Os preços são recalculados no banco na hora da compra (função `buy_tickets`). O navegador não consegue alterar o valor, e a lotação é travada para dois compradores não levarem a última vaga ao mesmo tempo.

## O que ainda não faz

- **Parcelamento no cartão**: por enquanto só à vista.
- **QR Code**: a validação na porta é feita digitando o código do ingresso.

## Estrutura

```
index.html            página única (rotas com #/)
assets/app.js         telas e regras da interface
assets/style.css      visual (claro e escuro automáticos)
assets/config.js      URL e chave pública do Supabase
supabase/schema.sql   tabelas, regras de acesso e funções de compra/entrada
```
