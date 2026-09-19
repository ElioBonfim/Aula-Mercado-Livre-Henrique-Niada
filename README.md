# Aula Mercado Livre - Henrique Niada

Dois programas que trabalham na mesma conta do Mercado Livre por caminhos opostos, e sobem juntos com **um comando só**, no seu computador, sem Docker:

| | **Painel** (raiz do repo) | **Scraper** (`scraper/`) |
|---|---|---|
| Como fala com o ML | API oficial + OAuth | navegador logado (Playwright) |
| Linguagem | Node.js | Python 3.12+ |
| Serve para | publicar, listar e editar **os seus** anúncios | ler dados **de qualquer** anúncio (ex.: posição na busca) |
| Endereço | `http://localhost:3100` | `127.0.0.1:8100` (só o painel usa) |
| Precisa de app no DevCenter | sim | não |

O `npm start` sobe o painel, o scraper e um **túnel HTTPS** automático — o endereço público que o Mercado Livre exige para devolver o login da conta e mandar notificações.

---

## Comece aqui

### Opção A — com o Claude Code (a da aula)

1. Faça um **fork** deste repositório na sua conta do GitHub.
2. Abra o Claude Code numa pasta vazia e cole o conteúdo de [`PRD-INSTALACAO.md`](PRD-INSTALACAO.md), trocando `SEU_USUARIO` pelo seu usuário do GitHub.
3. Ele instala o que faltar, sobe tudo e abre o painel no navegador. Siga a tela.

### Opção B — no terminal

```bash
git clone https://github.com/SEU_USUARIO/Aula-Mercado-Livre-Henrique-Niada.git
cd Aula-Mercado-Livre-Henrique-Niada
npm install
npm run setup
npm start
```

O navegador abre sozinho em `http://localhost:3100`. **Não existe arquivo para editar**: senha, App ID e chave secreta são cadastrados na própria tela.

Mudou o código? `Ctrl+C` e `npm start` de novo: painel e scraper reiniciam, e **a URL pública continua a mesma** (o túnel fica aberto). Para fechar tudo, túnel incluído: `npm run parar`.

---

# Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Como funciona](#2-como-funciona)
3. [Primeiro acesso](#3-primeiro-acesso)
4. [O túnel e a URL que muda](#4-o-túnel-e-a-url-que-muda)
5. [Scraper](#5-scraper)
6. [Estrutura do repositório](#6-estrutura-do-repositório)
7. [Referência de endpoints](#7-referência-de-endpoints)
8. [O que a API do ML deixa editar](#8-o-que-a-api-do-ml-deixa-editar)
9. [Análise por anúncio](#9-análise-por-anúncio)
10. [Banco de dados](#10-banco-de-dados)
11. [Testes](#11-testes)
12. [Quando der errado](#12-quando-der-errado)
13. [Segurança](#13-segurança)
14. [Créditos e licença](#14-créditos-e-licença)

---

## 1. Pré-requisitos

| Ferramenta | Versão | Quem instala |
|---|---|---|
| Node.js | **≥ 22.13** | você (ou o Claude Code, pelo PRD) — o painel usa `node:sqlite` nativo |
| Git | qualquer | você |
| uv | qualquer | `npm run setup` (instalador oficial da Astral) |
| Python 3.12 | — | `npm run setup` (o uv baixa sozinho) |
| Chromium | — | `npm run setup` (Playwright) |
| cloudflared | — | `npm install` (o pacote npm baixa o binário) |

```bash
node -v    # precisa mostrar v22.13 ou maior
```

Instalar o Node: macOS `brew install node` · Windows `winget install OpenJS.NodeJS.LTS` · ou [nodejs.org](https://nodejs.org).

O `npm run setup` pode ser rodado quantas vezes quiser: cada passo confere antes de fazer, e no fim roda os testes.

---

## 2. Como funciona

```
                 internet                       |            seu computador
                                                |
  Mercado Livre ────────┐                       |
  (login, notificações) ├─► https://xxxx.trycloudflare.com ──túnel──► 127.0.0.1:3101  porta PÚBLICA
  celular / outro PC ───┘                       |     /callback, /webhook e o painel online (com senha)
                                                |
                                                |   navegador ──► localhost:3100   PAINEL local
                                                |                      │
                                                |                      ▼
                                                |              127.0.0.1:8100   SCRAPER (Python)
                                                |              Chromium com a sua conta logada
```

- **Painel no computador e online.** No computador, `http://localhost:3100`. De qualquer lugar (celular, outro computador), pelo **endereço público** do túnel, com a mesma senha — ele aparece em **Configurações** e no terminal. Pela internet a senha **nunca é criada** (só no computador, para ninguém que ache a URL tomar o painel), o login tem limite de tentativas e o cookie é `Secure`. Quem preferir o painel só local: `PAINEL_ONLINE=0` no `.env` deixa o endereço público apenas com `/callback` (retorno do login) e `/webhook` (notificações).
- **O scraper sobe junto e volta sozinho.** Se o processo Python cair ou travar, o `npm start` reinicia com espera crescente (2 s, 5 s, 15 s…). O estado aparece em **Configurações**.
- **Portas ocupadas não travam.** Se a 3100 já estiver em uso por outro programa, o painel usa a próxima livre e avisa. Se o próprio painel já estiver rodando, um segundo `npm start` só abre o navegador nele.
- **A URL não muda ao reiniciar.** O túnel roda à parte do `npm start`: `Ctrl+C` encerra painel e scraper e deixa o túnel aberto; o próximo `npm start` o reaproveita, com a mesma URL. `npm run parar` fecha tudo.
- **Nada fica para trás.** `npm run parar` encerra painel, scraper e túnel. Se o terminal morrer sem encerrar, o próximo `npm start` acha os processos órfãos (conferindo a linha de comando antes) e os encerra.

---

## 3. Primeiro acesso

O painel guia pelos três passos numa tela só (**Configurações**, no menu do topo), com o progresso no topo.

**1. Criar a senha.** Na primeira visita o painel pede uma senha nova (mínimo de 8 caracteres). Ela fica no banco como hash `scrypt` com sal, e a tela de primeiro acesso some depois disso. Só quem está no próprio computador consegue criá-la (ver [Segurança](#13-segurança)).

**2. Criar o aplicativo no Mercado Livre.** A tela mostra as duas URLs, com botão de copiar:

| Campo no DevCenter | Valor |
|---|---|
| URIs de redirect | `https://<túnel>/callback` |
| URL de retornos de chamada de notificação | `https://<túnel>/webhook` |

No [DevCenter](https://developers.mercadolivre.com.br/devcenter):

1. **Criar aplicação**, e cole as duas URLs — exatamente como estão, sem barra no final.
2. Em **Fluxos OAuth**, marque **Authorization Code**, **Client Credentials** e **Refresh Token**.
3. Em **Permissões**, dê leitura e escrita ao menos em *Publicação e sincronização*.
4. Aceite os termos, resolva o reCAPTCHA e **salve**. Sem salvar, nada é gravado.

Depois cole o **App ID** e a **Chave secreta** na tela. Antes de gravar, o painel **confere com o Mercado Livre**: par errado é recusado na hora (`invalid_client`), e não na hora de conectar a conta. A chave secreta vai cifrada para o banco.

Com as credenciais salvas, o painel **lê o cadastro do seu aplicativo no próprio ML** e compara com o túnel atual — sem você precisar confirmar nada. Se faltar um fluxo OAuth ou sobrar uma barra no fim da URL, ele diz qual.

**3. Conectar a conta.** O botão abre a autorização do Mercado Livre no seu navegador; ao aceitar, você volta para as Configurações com a conta conectada. Cada passagem conecta **mais uma** conta; o seletor no topo das telas troca a conta ativa. Se a URI de redirect cadastrada não for a do túnel atual, o botão fica bloqueado com a explicação — em vez de mandar você para a tela de erro genérica do ML.

**Scraper.** Para medir posição na busca, o scraper precisa da sua conta logada no Chromium dele: aba **Navegador** → **Fazer login**. Você digita a senha e o código de verificação na própria tela do navegador; o programa só repassa cliques e teclas.

**Roupas e calçados: tabela de medidas.** Nessas categorias o ML exige uma tabela de medidas e o tamanho do anúncio (`SIZE_GRID_ID` e `SIZE_GRID_ROW_ID`). Na tela Publicar, depois de escolher Marca e Gênero, aparece o bloco **Tabela de medidas**: escolha uma tabela sua e o tamanho, ou crie a tabela ali mesmo (uma vez por marca e gênero), com tamanho, equivalência (P, M, G… — o painel sugere) e as medidas que o ML pede. Medido: o ML não oferece tabela pronta para as marcas testadas, e a busca devolve as tabelas da própria conta. As medidas aparecem para o comprador; tabela sem uso pode ser apagada, mas a exclusão leva até 24 h.

**Contas "User Products".** Contas com a marca `user_product_seller` publicam com `family_name` no lugar de `title` (o ML recusa os dois juntos); o painel lê isso da conta e monta o anúncio certo.

> Para testar sem sujar a conta real, crie um usuário de teste: `node criar-usuario-teste.js` (usa o App ID e a chave cadastrados no painel). A senha aparece **uma única vez**.

---

## 4. O túnel e a URL que muda

O OAuth do Mercado Livre exige redirect URI **HTTPS**, e o webhook precisa de URL pública. `localhost` não serve para nenhum dos dois. O `npm start` abre um túnel gratuito, sem conta e sem abrir porta no roteador.

**Provedores, medidos em 18/09/2026:**

| | cloudflared (padrão) | localtunnel (plano B) |
|---|---|---|
| Instalação | pacote npm baixa o binário | `npx`, só se o cloudflared falhar |
| URL em | ~8–12 s | < 1 s |
| Navegador no `/callback` | passa direto | cai numa página "Tunnel website ahead!" que pede o IP público (1× por IP a cada 7 dias) |
| Webhook | passa | passa |
| `npm audit` | 0 vulnerabilidades | 2 **HIGH** (axios 0.21, pacote parado desde 2023) |
| Mesma URL ao reiniciar o painel | **sim** — o túnel é mantido vivo entre reinícios | não (nem o subdomínio pedido volta se reconectar logo) |

Por isso o localtunnel **não** está no `package.json`: só é baixado se o cloudflared não abrir.

**A URL fica a mesma quando você reinicia o painel.** O `cloudflared` roda desacoplado do `npm start` (estado em `logs/tunel.json`): mudar o código, dar `Ctrl+C` e `npm start` de novo reaproveita o mesmo túnel, e o DevCenter continua certo. Medido: `Ctrl+C` + `npm start` e até terminal morto à força (`kill -9`) mantiveram a URL.

**Quando ela muda — e o painel acompanha.** Um túnel NOVO sempre tem URL nova: depois de `npm run parar`, de reiniciar o computador ou de o túnel cair. Cada URL fica gravada no SQLite (`urls_publicas`). Quando o túnel abre com um endereço novo:

- o terminal mostra um quadro **"A URL PÚBLICA MUDOU"** com as duas URLs novas e a anterior;
- todas as telas mostram um aviso vermelho no topo, com link para as Configurações;
- a tela Configurações diz exatamente o que o ML tem cadastrado hoje e o que precisa ficar.

Quando você atualiza no DevCenter e clica em **Verificar de novo**, o painel relê o cadastro no ML e o aviso some. Se o ML não deixar ler o cadastro (fluxo *Client Credentials* desmarcado), aparece o botão **Já atualizei no Mercado Livre** como plano B.

> O ML aceita **várias** URIs de redirect no mesmo app. Adicionar a nova sem apagar a velha já basta para o login; a URL de notificação é uma só e precisa ser trocada.

**Domínio fixo (opcional).** Quem tem um túnel nomeado da Cloudflare (ou outro domínio) apontando para a porta pública pode preencher `URL_PUBLICA=https://seu-dominio` no `.env`. Aí o túnel automático não abre e a URL deixa de mudar.

**Uma armadilha de DNS que o painel evita.** O `trycloudflare.com` não é curinga: um nome que ainda não existe recebe `NXDOMAIN` com TTL negativo de **30 minutos**. Perguntar pelo endereço novo cedo demais faz o computador (e às vezes o provedor de DNS) responder "não existe" por meia hora, e o retorno do login cairia em "site não encontrado". Medido: aconteceu na primeira versão, que testava o túnel no primeiro segundo. Agora a primeira pergunta vai direto aos servidores autoritativos da Cloudflare, que não guardam cache, e o painel só mostra a URL depois que ela existe.

---

## 5. Scraper

O `npm start` sobe o scraper sozinho (`uv run python -m uvicorn api:app --host 127.0.0.1 --port 8100`) e o reinicia se cair. Logs em `logs/scraper.log`.

### 5.1 Login da conta no scraper

Pela aba **Navegador** do painel (`/navegador.html`): o Chromium abre no seu computador e a tela dele aparece na aba (~5 quadros/s). Seus cliques, o que você digita, colagens e rolagem vão para o navegador. Ao terminar, **Terminei — verificar** mede listagem e produto. Se liberou, o navegador fecha; se ainda estiver bloqueado, ele fica aberto na página do bloqueio para você continuar.

- Enquanto o navegador está aberto, as rotas de raspagem respondem `423` na hora (não ficam presas no lock do perfil).
- Ele fecha sozinho após 10 min sem clique ou tecla, ou 30 min no total.
- O painel não digita senha nem resolve captcha: só repassa o que você faz.

A sessão fica em `scraper/.sessao_ml/`. **São cookies de sessão logada**: equivalem à sua senha. Não versione, não copie para outra máquina.

### 5.2 Linha de comando (opcional)

```bash
cd scraper && uv run python scrape_cli.py status
```

| Comando | O que faz |
|---|---|
| `login` | abre o navegador para você logar; salva a sessão |
| `status` | a sessão ainda passa? |
| `desbloquear` | abre o navegador para você resolver o reCAPTCHA |
| `url <url> ...` | raspa um ou mais produtos |
| `busca "termo" [--paginas N] [--max N]` | busca por termo e raspa os resultados |
| `posicao MLB123 "termo"` | onde o anúncio aparece na busca |
| `--html pagina.html` | parse offline, sem rede |
| `--self-check` | checagem interna |

A saída vai para `scraper/saida/`. Contrato completo da API HTTP, com latências medidas e o formato dos erros: [`scraper/API.md`](scraper/API.md). Exemplo de cliente: [`scraper/cliente_exemplo.py`](scraper/cliente_exemplo.py).

A API escuta **só em 127.0.0.1**, de propósito. Um perfil de navegador aceita um acesso por vez, então os pedidos são serializados — chamadas paralelas não aceleram nada.

---

## 6. Estrutura do repositório

```
.
├── iniciar.js               npm start: sobe painel + scraper + túnel (reaproveita o túnel aberto: mesma URL)
├── instalar.js              npm run setup: dependências, uv, Python, Chromium, .env, testes
├── parar.js                 npm run parar: fecha painel, scraper e túnel (a próxima URL será nova)
├── server.js                painel (localhost) e porta pública (/callback, /webhook)
├── db.js                    SQLite: contas (tokens cifrados), senha, sessões, URLs, produtos
├── app-ml.js                valida App ID/chave e lê o cadastro do app no DevCenter
├── tunel.js                 túnel HTTPS: cloudflared, com localtunnel de reserva
├── scraper-processo.js      supervisor do scraper Python (sobe, vigia, reinicia)
├── processos.js             portas livres e encerramento de árvore de processos (macOS/Linux/Windows)
├── ambiente.js              cria o .env na primeira vez, com chave de cifra aleatória
├── criar-usuario-teste.js   cria um usuário de teste do ML
├── test*.js                 testes (npm test)
├── PRD-INSTALACAO.md        o que colar no Claude Code para instalar tudo
├── public/
│   ├── index.html           publicar anúncio
│   ├── anuncios.html        listar, editar e analisar anúncios
│   ├── navegador.html       tela remota do Chromium do scraper (login, reCAPTCHA)
│   ├── configuracao.html    primeiro acesso: URLs, credenciais, conta, scraper
│   └── aviso.js             aviso no topo das telas (URL mudou, falta configurar)
└── scraper/
    ├── scrape_cli.py        scraper e CLI (Playwright + BeautifulSoup)
    ├── api.py               API HTTP local (FastAPI)
    ├── navegador.py         sessão interativa (login, 2FA, reCAPTCHA pelo painel)
    ├── cliente_exemplo.py   como consumir a API do scraper
    ├── test_api.py          testes da API sem tocar a rede
    └── API.md               contrato da API do scraper
```

Nunca entram no git (já no `.gitignore`): `.env`, `dados.sqlite*`, `logs/`, `node_modules/`, `scraper/.sessao_ml/`, `scraper/.venv/`, `scraper/saida/`.

---

## 7. Referência de endpoints

### 7.1 Painel (`localhost:3100`)

Na porta local, só atende pedidos com `Host` local; pela internet, ver 7.2. Tudo, menos `/primeiro-acesso`, `/login` e `/api/ping`, exige a sessão.

| Método | Rota | O que faz |
|---|---|---|
| GET/POST | `/primeiro-acesso` | cria a senha (só enquanto não existe nenhuma) |
| GET/POST | `/login` | tela e envio da senha |
| POST | `/sair` | encerra a sessão |
| GET | `/auth` | começa o OAuth (conecta mais uma conta); o retorno volta pelo túnel |
| GET | `/api/ping` | identifica o painel (usado para não subir duas cópias) |
| GET | `/api/config` | túnel, URLs, situação no ML, credenciais, scraper (`?forcar=1` relê o ML) |
| GET | `/api/config/resumo` | o que falta configurar (usado pelo aviso do topo) |
| POST | `/api/config/credenciais` | valida no ML e grava App ID + chave secreta |
| POST | `/api/config/confirmar-url` | "já atualizei" (quando o ML não deixa ler o cadastro) |
| POST | `/api/config/senha` | troca a senha (derruba as sessões) |
| POST | `/api/scraper/reiniciar` | reinicia o scraper |
| GET | `/api/status` | conta ativa |
| GET | `/api/accounts` | contas conectadas (nunca devolve token) |
| POST | `/api/accounts/active` | troca a conta ativa |
| POST | `/api/accounts/remove` | esquece o token de uma conta |
| GET | `/api/items` | lista anúncios (`status`, `q`, `sort`, `offset`, `limit`) |
| GET | `/api/items/:id` | anúncio completo + descrição + visitas |
| PUT | `/api/items/:id` | edita o anúncio |
| PUT | `/api/items/:id/description` | troca a descrição |
| GET | `/api/items/:id/analytics?dias=` | painel do anúncio numa janela (30/60/90/150 dias) |
| GET | `/api/items/:id/quality` | health e sugestões do ML |
| GET | `/api/items/:id/upgrades` | trocas de tipo de anúncio disponíveis |
| POST | `/api/items/:id/listing-type` | troca o tipo de anúncio |
| POST | `/api/items` | publica um anúncio novo |
| POST | `/api/pictures` | sobe uma foto (bytes crus no corpo) |
| GET | `/api/predict?q=` | sugere categoria pelo título |
| GET | `/api/category?id=` | ficha técnica + regras da categoria |
| GET | `/api/listing-types` | tipos de anúncio do site |
| GET | `/api/products` | espelho local dos anúncios |
| GET | `/api/notifications` | últimas notificações recebidas |
| GET | `/api/scraper` | o scraper está no ar e com sessão válida? |
| GET | `/api/navegador` · `/api/navegador/tela` | estado e JPEG do navegador interativo |
| POST | `/api/navegador/abrir` · `/acao` · `/concluir` · `/fechar` | sessão interativa (ver 5.1) |
| GET/POST | `/api/keywords` · POST `/api/keywords/remove` | termos acompanhados por anúncio |
| POST | `/api/posicao` | mede a posição agora e grava no histórico |
| GET | `/api/ads/status` · `/api/ads/advertising/*` | Mercado Ads (`api-version: 2`) |

### 7.2 Porta pública (`127.0.0.1:3101`, publicada pelo túnel)

| Método | Rota | O que faz |
|---|---|---|
| GET | `/callback` | retorno do OAuth; valida o `state` (uso único, 15 min) e grava a conta |
| GET/POST | `/webhook` | notificações do ML (sempre 200: erro faz o ML desativar a URL) |
| GET | `/saude` | autoteste do túnel |
| — | todo o resto | o **painel online** (mesmas rotas da 7.1), com as regras abaixo |

Regras do painel online: sem senha criada, qualquer página responde `403` mandando criar no computador; `POST` só vale com `Origin` igual ao endereço público; login com 5 erros bloqueia o IP por 15 min e 30 erros somados fecham o login online por 15 min (o do computador continua funcionando); cookie `Secure`. Com `PAINEL_ONLINE=0`, o resto dá `404` e `/` mostra uma página explicando o endereço.

### 7.3 Scraper (`127.0.0.1:8100`)

| Método | Rota | O que faz |
|---|---|---|
| GET | `/health` | a API está de pé (não toca no navegador) |
| GET | `/status` | a sessão do ML ainda passa? |
| GET | `/produto?url=&imagens=` | raspa um produto |
| POST | `/produtos` | raspa vários (máx. 50) |
| GET | `/busca?q=&paginas=&maximo=&imagens=` | busca por termo e raspa os resultados |
| GET | `/posicao?item=&q=&paginas=` | posição do anúncio na busca + vizinhos com preço e vendas |
| GET | `/navegador` · `/navegador/tela` | estado e JPEG da sessão interativa |
| POST | `/navegador/abrir` · `/acao` · `/concluir` · `/fechar` | sessão interativa; só o painel deve chamar |

Guardas de entrada: só `https` e só domínios do Mercado Livre — `file://`, `http://` e outros hosts recebem `400`.

| Código | Significa | O que fazer |
|---|---|---|
| 400 | URL fora do domínio permitido ou não-https | corrigir a URL |
| 404 | a página carregou mas não é um produto | conferir o ID; anúncio removido cai aqui |
| 422 | lote acima de 50 URLs | dividir |
| 423 | o navegador interativo está aberto | concluir ou fechar na aba Navegador |
| 503 | página não carregou (bloqueio ou timeout) | aba Navegador do painel |

---

## 8. O que a API do ML deixa editar

Testado campo a campo em dois anúncios reais, alterando **de verdade** e restaurando
depois. Um PUT com o mesmo valor não serve de teste: o ML aceita o no-op e recusa a
mudança real.

| Campo | `PUT /items` | Quando é recusado |
|---|---|---|
| `title` | aceita | **anúncio com `family_name`** — `You cannot modify the title if the item has a family_name` |
| `price` | aceita | **anúncio com variações** — o preço vive em cada variação |
| `available_quantity` | aceita | **anúncio com variações** — o estoque vive em cada variação |
| `condition` | aceita | |
| `warranty` | aceita | derivado de `sale_terms`; a tela não expõe |
| `pictures` | aceita | a ordem enviada vira a ordem no anúncio |
| `attributes` | aceita | 54 editáveis numa categoria de informática, não só os 6 obrigatórios |
| `shipping` | aceita | |
| `category_id` | aceita | |
| `video_id` | aceita | vazio remove o vídeo |
| `seller_custom_field` | aceita | é o SKU interno |
| `sale_terms` | aceita | garantia e condições de venda |
| `listing_type_id` | **nunca** | use `POST /items/{id}/listing_type` |

**Estar pausado não trava nada.** A mensagem de erro do ML diz `[status:paused,
has_bids:false]` mesmo quando a causa é outra — num anúncio pausado *sem* variações o
preço muda sem problema. Cair nessa pista falsa é fácil; por isso a tela não adivinha:
ela lê `family_name` e `variations` do próprio anúncio e mostra o motivo antes de você
tentar.

`buildEdicao()` em `server.js` é a lista fechada desses campos: o que estiver fora é
descartado antes de chegar ao ML. Cada aceitação e cada recusa tem teste em `test.js`.

### Ficha técnica: todos os campos, não só os obrigatórios

A Central de Vendedores mostra "Características principais" e "Características
secundárias". A API entrega as duas coisas na mesma chamada — o que separa é a tag:

```
/categories/MLB121405/attributes  →  123 atributos
  6    obrigatórios      (required / catalog_required)
  3    condicionais
  69   ocultos ou read-only  → não dá para editar
  54   EDITÁVEIS            → é o que a tela mostra agora
```

A primeira versão mostrava só os 6. Num anúncio real, 23 dos outros 48 estavam em
branco — e é exatamente isso que faz a ML avisar *"corrija as características principais
para recuperar sua exposição"*.

`GET /api/category` devolve os 54 com `obrigatorio`, `value_type`, `values`, `unidades`,
`unidade_padrao` e `dica`. Quem escolhe o que mostrar é a tela:

- **Publicar** usa só os obrigatórios — publicar não deveria exigir 54 campos.
- **Editar** mostra os obrigatórios em cima e o resto num bloco recolhido, com o contador
  de quantos estão em branco.

Um controle por tipo, medido na categoria de informática: 25 `string`, 11 `number_unit`,
11 `boolean`, 3 `list`, 3 `number`, 1 `picture_id`. O `number_unit` vira **campo + seletor
de unidade** (`27` + `"`), porque o ML espera `"16 GB"` num campo só e pedir isso digitado
é pedir erro.

### Garantia e condição

**Garantia é `sale_terms`, não atributo**, e é lista fechada:

| Termo | Tipo | Valores |
|---|---|---|
| `WARRANTY_TYPE` | `list` | Garantia do vendedor · Garantia de fábrica · Sem garantia |
| `WARRANTY_TIME` | `number_unit` | número + dias/meses/anos |

Não existe endpoint que liste as opções: `/sites/MLB/sale_terms` dá **404** e
`/categories/{id}/sale_terms` dá **403**. Os ids (`2230280`, `2230279`, `6150835`) foram
lidos dos anúncios reais da conta, e o valor que o anúncio já tem é unido à lista — se o
ML criar um termo novo, ele aparece mesmo sem estar no código.

⚠️ O campo `warranty` do item é **derivado**: `"Garantia de fábrica: 12 meses"` é a junção
dos dois acima. Editá-lo como texto livre briga com a estrutura, então a tela não o expõe.

**Condição** sai de `settings.item_conditions` da categoria, não de uma lista fixa.
Medido: `condition: "refurbished"` responde **400 Validation error** na categoria de
informática, enquanto `not_specified` passa. Onde o ML aceitar Recondicionado, a opção
aparece sozinha.

`ITEM_CONDITION` existe como atributo com os três valores, mas vem com `hidden: true` —
é informativo, não editável.

### A mensagem de erro do ML não fica num campo fixo

Às vezes o texto útil vem em `message`, às vezes em `error`, às vezes só dentro de
`cause[]` — e um dos dois costuma ser um código inútil (`BODY_INVALID_FIELDS`).
`mensagemDoML()` escolhe a mais descritiva, ignorando os códigos em maiúsculas. Sem isso
o usuário vê `BODY_INVALID_FIELDS` em vez de "você não pode mudar o título".

Outras regras medidas:

- **Fotos**: mínimo **500 px** no maior lado; o ideal é 1200×1200 para permitir zoom. A tela mede a imagem no navegador antes de gastar o upload.
- **Visitas**: `/visits/items` aceita **um** id por chamada — a listagem busca em paralelo.
- **Encerrar é definitivo**: o ML não reativa anúncio encerrado. Para tirar do ar temporariamente, use Pausar.
- **Ficha técnica**: o ML recusa a publicação sem os atributos obrigatórios da categoria. A tela busca em `/categories/{id}/attributes` e exige antes de enviar.

---

## 9. Análise por anúncio

O menu **⋮ → Análise do anúncio** abre um painel com tudo que a API entrega sobre um item.
`GET /api/items/:id/analytics` junta oito chamadas em paralelo; cada bloco falha sozinho,
então um endpoint fora do ar não derruba o resto.

| Bloco | De onde vem | Exemplo real |
|---|---|---|
| Visitas 30 dias + série diária | `/items/{id}/visits/time_window` | 484 visitas, pico de 69 num dia |
| Visitas desde sempre | `/visits/items` | 9.449 |
| Pedidos, unidades, faturamento, ticket | `/orders/search` filtrado pelo item | 50 pedidos · R$ 22.587,21 |
| **Conversão** | pedidos ÷ visitas | 10,3% |
| Taxa do ML e líquido | `/sites/{site}/listing_prices` | taxa R$ 82,61 (13,5%) · recebe R$ 529,30 |
| Avaliações e nota | `/reviews/item/{id}` | 65 avaliações · nota 5,0 |
| Perguntas e sem responder | `/questions/search` | 41 · 0 sem responder |
| Mercado Ads | `/advertising/product_ads/ads/{id}` | active · id da campanha |
| Tendências da categoria | `/trends/{site}/{categoria}` | o que as pessoas buscam |

`/orders/search?q=` é busca textual, não filtro: o servidor confere `order_items[].item.id`
antes de somar, senão pedido de outro produto entraria na conta.

### Até onde o histórico vai — medido

| Dado | Profundidade | Como |
|---|---|---|
| Visitas, série por dia | **máximo 150 dias** | `last=365` responde `400: invalid time window, should be smaller or equal to 150 days` |
| Visitas, total | **desde sempre** | `/visits/items` **ignora** `date_from`/`date_to` — devolve o total do anúncio em qualquer intervalo |
| Pedidos | **todo o histórico**, com filtro de data e paginação | `order.date_created.from/to` + `offset`; `paging.total` já é o número exato |
| Unidades vendidas | **desde sempre** | `sold_quantity` do item |

Não existe granularidade diária entre 150 dias e "sempre". Se quiser série mais longa,
grave as medições no banco — é o que o histórico de posições já faz.

Medido numa conta real: pedidos de 2023 e 2024 voltam `0`, e 2025 volta 3.377. A API não
promete profundidade ilimitada; confira antes de tratar um total como definitivo.

### Um erro que essa medição corrigiu

A primeira versão do analytics pegava os **50 pedidos mais recentes sem filtro de data** e
rotulava "Pedidos 30 dias". Num anúncio real esses 50 cobriam **cinco meses**, e a
conversão dividia esse número pelas visitas de 30 dias:

```
errado : 50 pedidos ÷ 523 visitas 30d = 9,6%
certo  : 11 pedidos ÷ 523 visitas 30d = 2,1%
```

Quase 5× inflado. Agora visitas, pedidos, faturamento e conversão usam **a mesma janela**,
escolhida no seletor da modal (30, 60, 90 ou 150 dias) — e a conversão fica estável entre
elas (2,1% / 2,2% / 2,3%), que é o sinal de que a conta fecha.

### Posição na listagem

A API oficial **não entrega**: `/sites/{site}/search` responde `403` mesmo com token do
vendedor. Quem mede é o scraper, a partir da **ordem que o próprio Mercado Livre declara**
no JSON da página de busca (`position`).

Como o número é calculado (desde 18/09/2026, medição "v2"):

- O `position` do ML começa em **0** e conta **banners** (ex.: `CART_INTERVENTION`) como
  casas da grade. O painel mostra o **número do card que o comprador vê**: a partir de 1, só
  anúncios, somando as páginas lidas.
- Cada anúncio vem de um objeto JSON **lido inteiro**. A v1 lia uma janela de 900 caracteres
  depois do `item_id`, maior que o objeto (~700), e pegava posição e preço do vizinho
  (medido: 11 de 59 com preço, e posições puladas).
- **Preço é o do card** (o que o comprador vê). Nos anúncios pagos o `price` do JSON é o
  total parcelado: card R$ 224,82 à vista contra JSON R$ 236,65 = 8× R$ 29,58.
  O preço sem desconto (`price_base`) aparece riscado.
- O mesmo anúncio pode aparecer **duas vezes** (pago e orgânico): os dois cards contam.
- As medições v1 ficam no banco (`versao = 1`) para auditoria, mas não entram na tela nem
  na variação ▲▼, porque comparar v1 com v2 mostraria um movimento que não aconteceu.
- **Não apareceu ≠ não mediu.** Se o anúncio não está nas posições lidas, a tela diz
  "fora das 60 primeiras posições" e oferece **Buscar em 3 páginas**. Junto, mostra os
  **outros anúncios seus** que apareceram na mesma busca (o painel pergunta ao ML, via
  `/items?ids=` em lotes de 20, quem é o vendedor de cada resultado). Isso importa: o ML
  costuma mostrar só um anúncio por vendedor para o mesmo produto. Medido numa conta real: para
  um dos termos acompanhados, o anúncio medido ficou de fora, e outros **9**
  anúncios da mesma conta ocupavam o 5º, 6º, 7º, 8º, 19º, 20º, 21º, 22º e 57º lugares.
- **A tabela tem todos os vendedores.** Cada medição guarda a busca inteira (coluna `lista`,
  ~25 KB). O resumo mostra os primeiros colocados, os vizinhos e os seus anúncios; cada
  "⋯ N anúncios de outros vendedores" abre ali mesmo, e **Ver todos** mostra os 60. Cada linha
  traz foto, título, vendedor, preço (com o sem desconto riscado) e quanto está acima ou
  abaixo do seu. Título, foto e vendedor vêm do card da página, porque a API devolve 403
  para anúncio de outro vendedor (medido): cobertura de 60/60 em título e foto e 52/60 em
  vendedor. O selo **SEU** vem da API (ela responde 200 só para os seus).
- **Lentidão não é bloqueio.** Se a página do ML não carrega em 45 s (medido com o Mac em
  load 74), o scraper responde `504 — tente de novo`; só um bloqueio de verdade vira `503`
  e pede a aba Navegador. Antes os dois viravam "bloqueio" e o painel guardava a sessão como
  bloqueada por 10 min.
- **Acompanhar termo já mede.** O termo novo entra medindo, com contador de segundos.
- O painel lembra por 10 min se a sessão do scraper está válida (`GET /api/scraper`;
  `?forcar=1` checa de novo). Antes, cada abertura da análise abria uma listagem de teste no
  ML: segurava o navegador por 5–10 s e somava acessos que aumentam o risco de reCAPTCHA.
  Medições e o desbloqueio atualizam esse estado.
- O ícone ao lado de cada anúncio abre a URL limpa do item
  (`produto.mercadolivre.com.br/MLB-…`), nunca o link do card: o dos pagos passa por
  `click1.mercadolivre` e conta um clique pago para o concorrente.

Na modal de análise, seção **Posição na listagem**: cadastre os termos que importam para
aquele produto e clique em **Medir agora**. Cada medição leva ~3 s e fica gravada, então a
próxima mostra se o anúncio **▲ subiu** ou **▼ caiu**.

A mesma página ainda entrega, de cada vizinho: **preço, unidades vendidas, pago ou
orgânico e frete grátis** — sem custo extra, é a mesma requisição.

Medido num anúncio real (v2; termo e IDs trocados por exemplos):

```
suporte de parede inox → 5º de 60 · 4 pagos acima
  2º  MLB1000000002  R$ 199,02            1000+  Pago
  3º  MLB1000000003  R$ 249,71            1000+  Pago
  4º  MLB1000000004  R$ 151,05 (de 159)   1000+  Pago
  5º  MLB1000000005  R$ 31,47 (de 49,90)  1000+  Orgânico   ← seu
  6º  MLB1000000006  R$ 35,90              500+  Orgânico
```

**Só funciona com painel e scraper na mesma máquina.** O painel chama `SCRAPER_URL`
(padrão `http://127.0.0.1:8100`). Não exponha essa porta pelo túnel: ela dirige um
navegador com a sua sessão logada. Se o scraper estiver fora do ar, a seção diz o motivo
e o resto da análise continua funcionando.

**A posição não é absoluta.** Varia por termo, região e personalização da sessão logada.
Serve para acompanhar a tendência do seu anúncio, não como número oficial.

Por que não usar o `/busca` que já existia: ele raspa **cada produto** (4 s × N). Para
posição basta a página de listagem. E o `links_de_busca` só enxerga os `<a href>` — numa
medição achou 35 links onde a página tinha 60 anúncios. O `resultados_da_busca` lê o JSON
e pega os 60.

### O que a API não entrega

- **Posição na listagem pela API oficial.** `/sites/{site}/search` responde **403**. Está
  resolvido pelo scraper (acima), não pela API.
- **Métricas do Mercado Ads** (impressões, cliques, ACOS, investimento). O único caminho
  que responde é `/advertising/product_ads/ads/{item_id}`, que devolve status, campanha e
  grupo — não os números. Todos os caminhos de campanha e de métrica testados deram 404.
  O repasse `GET /api/ads/advertising/*` continua aberto para quando o caminho certo for

---

## 10. Banco de dados

`dados.sqlite`, criado sozinho no primeiro boot (`node:sqlite`, nativo).

| Tabela | Guarda |
|---|---|
| `contas` | uma linha por conta ML: id, nickname, site, tokens **cifrados**, validade |
| `estado` | conta ativa, App ID, chave secreta (**cifrada**), hash da senha do painel, URL confirmada |
| `sessoes` | sessões do painel, só o **hash** do token, com validade de 7 dias |
| `urls_publicas` | cada endereço que o túnel já teve, com provedor e horário |
| `produtos` | cada anúncio publicado ou listado, com o payload, ligado à conta |
| `notificacoes` | tudo que chega no webhook, JSON válido ou não |
| `palavras`, `posicoes` | termos acompanhados e o histórico de posição na busca |

Tokens e chave secreta usam **AES-256-GCM** com chave derivada de `ML_DB_KEY`, que o `npm start` gera sozinho no `.env` na primeira vez. **Perder o `.env` = reconectar as contas** (os tokens ficam ilegíveis). Guardamos só id, nickname e site da conta: nada de CPF, e-mail ou endereço, que o `/users/me` devolve mas o sistema não usa.

---

## 11. Testes

```bash
npm test
```

| Arquivo | Cobre |
|---|---|
| `test.js` | montagem do payload de publicação e de edição |
| `test-db.js` | cifra, multi-conta, isolamento, senha (scrypt), sessões, histórico de URLs |
| `test-config.js` | a regra do aviso "a URL mudou": confere, mudou, barra no fim, fluxos, plano B |
| `test-servidor.js` | sobe os dois servidores e prova as fronteiras: senha nunca criada pela internet, limite de tentativas (por IP e somado), cookie `Secure` online, `PAINEL_ONLINE=0`, porta local só para localhost, site de fora não cria a senha, `state` do OAuth de uso único, sessão revogável, sem escapar de `public/` |

Todos usam banco temporário: rodar teste não toca no seu `dados.sqlite`. O scraper tem os dele:

```bash
cd scraper && uv run python test_api.py
```

---

## 12. Quando der errado

### O terminal diz "A URL PÚBLICA MUDOU"

Acontece depois de `npm run parar`, de reiniciar o computador ou de o túnel cair (um simples `Ctrl+C` + `npm start` mantém a URL). Abra **Configurações**, copie as duas URLs novas para o seu app no DevCenter, salve lá e clique em **Verificar de novo**.

### "Desculpe, não foi possível conectar o aplicativo à sua conta"

A tela de autorização do ML mostra isso para quatro causas diferentes. Elimine em ordem:

1. **`redirect_uri` não bate.** O painel já confere antes de mandar você para o ML — se passou, confira se salvou o app no DevCenter depois de colar.
2. **App ID de outro aplicativo.** Dois apps diferentes dão exatamente esse erro.
3. **Conta colaborador.** Operador/colaborador não consegue autorizar — use a conta principal (`invalid_operator_user_id`).
4. **Dados pendentes de validação.** Vendedor *ou* dono da aplicação com pendência em *Meu Perfil → Dados pessoais* e *Dados da conta*. Enquanto houver, o ML não concede novas autorizações.

### "Autorização expirada ou desconhecida" ao voltar do ML

O retorno não corresponde a um "Conectar conta" dos últimos 15 minutos — ou o painel foi reiniciado no meio. Volte às Configurações e clique em **Conectar conta** de novo.

### Aparece "Tunnel website ahead!"

O cloudflared não abriu e o painel caiu no plano B (localtunnel). Digite o IP que a própria página mostra e continue: ela aparece uma vez por IP a cada 7 dias. Veja o motivo da falha do cloudflared em `logs/tunel.log`.

### O túnel não abre

`logs/tunel.log` mostra o erro. Redes corporativas às vezes bloqueiam a porta 7844 (que o cloudflared usa); tente outra rede, ou use o celular como roteador. O painel continua funcionando localmente; só o login de conta nova e as notificações dependem do túnel.

### Scraper "reiniciando" sem parar

`logs/scraper.log` mostra o erro do Python. O mais comum é faltar o Chromium: rode `npm run setup` de novo.

### Scraper devolve 503 em tudo

reCAPTCHA ou sessão caída. Aba **Navegador** → **Resolver reCAPTCHA** (ou **Fazer login**).

### `curl` e navegador automatizado tomam 403 em `auth.mercadolivre.com.br`

É o WAF da Cloudflare do lado do ML. A tela de autorização só abre num navegador de verdade.

### "Node … é antigo demais"

O painel precisa do Node 22.13 ou mais novo (`node:sqlite`). Atualize e rode `npm run setup` de novo.

### Esqueci a senha do painel

Pare o painel e apague a linha da senha; na próxima visita a tela de primeiro acesso volta:

```bash
node -e "require('./ambiente').carregar();require('./db').db.prepare(\"DELETE FROM estado WHERE chave='painel_senha'\").run()"
```

---

## 13. Segurança

- **Painel online com senha, e a senha só nasce no computador.** Pelo endereço público o painel exige a sessão; sem senha criada, ele só manda criar no computador — quem descobrir a URL antes do aluno não toma o painel. Login online: 5 erros bloqueiam o IP por 15 min; 30 erros somados (troca de IP) fecham o login online por 15 min, sem afetar o login no computador. Cookie `HttpOnly`, `SameSite=Lax` e `Secure`. Use uma senha forte: ela é a única barreira pela internet. Para não expor o painel, `PAINEL_ONLINE=0`.
- **Só quem está no computador cria a senha.** O painel recusa `Host` que não seja local (barra *DNS rebinding*) e `POST` cuja origem seja outro site — então uma página aberta no navegador não consegue criar a senha antes de você no primeiro acesso.
- **O `state` do OAuth fica no servidor**, é de uso único e vence em 15 minutos. Com PKCE quando o app exige.
- **Segredos nunca em texto puro:** chave secreta e tokens cifrados no banco; senha como hash `scrypt`; sessão guardada só como hash. `.env`, `dados.sqlite*`, `logs/` e `scraper/.sessao_ml/` estão no `.gitignore`.
- **Secret exposto = secret queimado.** Se a chave do DevCenter aparecer num print, log ou vídeo, gere outra no DevCenter e cole no painel.
- **Não exponha a porta do scraper.** Ela dirige um navegador logado e não tem autenticação.
- **Contas pessoais não devem ser usadas para testes** (documentação do ML). Use `criar-usuario-teste.js`.

---

## 14. Créditos e licença

Projeto da **Aula Mercado Livre - Henrique Niada**.

O scraper começou a partir do projeto `alxmares/webscraping-MercadoLibre`, uma ferramenta em Tkinter para copiar dados de anúncios do Mercado Livre. A abordagem original — `requests` direto na página — parou de funcionar: o Mercado Livre bloqueia acesso anônimo à listagem e devolve parede de login ou reCAPTCHA. Este repositório troca isso por um navegador real com a sua sessão logada (Playwright, perfil persistente), e acrescenta CLI, API HTTP, sessão interativa pelo painel e testes. Nenhum arquivo do projeto original foi incluído: o repositório de origem **não declara licença**, então os direitos permanecem com o autor.

Licença **MIT** — ver [`LICENSE`](LICENSE). Pode usar, copiar, modificar e redistribuir, mantendo o aviso de copyright.

---

## Aviso

Ferramenta para fins educacionais. Respeite os termos de uso do Mercado Livre. Raspagem em volume, com conta logada, pode levar a bloqueio da conta — o scraper serializa os pedidos justamente para não parecer tráfego automatizado agressivo.
