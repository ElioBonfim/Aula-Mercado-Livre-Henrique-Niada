# Aula Mercado Livre - Henrique Niada

Responda em português do Brasil. Instalação do zero: siga `PRD-INSTALACAO.md`.

## Rodar

- `npm run setup` — instala tudo (uv, Python, Chromium) e roda os testes. Idempotente.
- `npm start` — sobe painel (`localhost:3100`), scraper Python (`127.0.0.1:8100`) e túnel
  HTTPS juntos. Processo longo: rode em segundo plano. `Ctrl+C` encerra os três.
- `npm test` — testes do painel. Scraper: `cd scraper && uv run python test_api.py`.
- Logs: `logs/scraper.log`, `logs/tunel.log`.

## Arquitetura (leia antes de mexer)

- `server.js` sobe **dois** servidores: o painel (só `127.0.0.1`, exige Host local e sessão)
  e a porta pública (`/callback`, `/webhook`, `/saude`), que é a única coisa que o túnel
  publica. Não coloque rota nova na porta pública sem necessidade real.
- Senha do painel, App ID e chave secreta ficam no SQLite (tabela `estado`), não no `.env`.
  O `.env` é criado sozinho e guarda só a `ML_DB_KEY` e portas.
- A URL do túnel muda a cada reinício; `app-ml.js#situacao` compara com o cadastro real do
  app no ML (lido via `client_credentials`). É isso que dispara o aviso "a URL mudou".
- Túnel: `tunel.js` (cloudflared; localtunnel via npx só como reserva). A primeira consulta
  DNS do endereço novo vai aos servidores autoritativos — não troque por `fetch` direto
  (NXDOMAIN com TTL negativo de 30 min; ver comentário no arquivo).
- Scraper: `scraper-processo.js` sobe e reinicia o Python; ele escuta só em `127.0.0.1`.

## Nunca

- Commitar `.env`, `dados.sqlite*`, `logs/`, `scraper/.sessao_ml/` (cookies da conta logada).
- Pedir App ID, chave secreta ou senha no chat: eles são digitados no painel.
- Usar `Referrer-Policy: no-referrer` no painel: o navegador passa a mandar `Origin: null`
  no POST do login e a checagem de origem recusa o próprio usuário.
- Expor a porta do scraper ou do painel pelo túnel.
