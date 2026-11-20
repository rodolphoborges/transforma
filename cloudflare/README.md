# Radar Live — sincronização gerenciada pelo GitHub

Este diretório contém **somente o serviço de sincronização**, sem os slides, vídeos, notas ou senhas da apresentação.

## Arquitetura

- `docs/index.html`: entrada protegida por senha no GitHub Pages.
- `docs/payload.bin`: apresentação cifrada, gerada localmente, nunca em claro no repositório.
- `cloudflare/src/index.js`: Worker de sessões temporárias (WebSockets + Durable Object), com uma página pública de informações complementares para o celular.
- `.github/workflows/deploy-radar-live.yml`: publicação do Worker a cada mudança em `cloudflare/**`, ou manualmente pelo GitHub Actions.

## Configuração inicial — apenas uma vez

1. Na Cloudflare, crie um **API token** com a permissão de editar Workers Scripts e os recursos necessários ao Durable Objects, restrito à sua conta. Consulte a documentação oficial: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
2. Copie o **Account ID** da Cloudflare.
3. No GitHub, abra `Settings → Secrets and variables → Actions → New repository secret` e cadastre:
   - `CLOUDFLARE_API_TOKEN`: token da Cloudflare.
   - `CLOUDFLARE_ACCOUNT_ID`: identificador da conta Cloudflare.
4. Em `Actions → Deploy Radar Live Worker`, execute `Run workflow`. Nas próximas mudanças em `cloudflare/**`, o GitHub implantará automaticamente.
5. **Separadamente**, configure no Worker o secret `RADAR_LIVE_HOST_KEY` (uma chave aleatória de no mínimo 24 caracteres). Ele **não** é a senha de apresentação (`RADAR_PASSWORD`). Pode ser configurado no painel Cloudflare em Worker → Settings → Variables and Secrets ou com `npx wrangler secret put RADAR_LIVE_HOST_KEY` usando uma sessão local autenticada. Esta configuração precisa ser feita apenas na primeira implantação.
6. Valide a URL do Worker no endpoint `/health`. O retorno esperado é `{"ok":true,"name":"radar-live",...}`.

## Uso durante a apresentação

1. Abra o GitHub Pages e desbloqueie a apresentação V10.
2. Ative `Apresentador`, abra o telão e informe no painel Radar Live a URL do Worker e a chave do apresentador.
3. Inicie uma sessão e exiba o QR code no primeiro slide.
4. Os participantes entram na página vertical. Os dados de cada slide são transmitidos automaticamente, inclusive para quem entrar após o início.

## Segurança e limites

- O repositório é **público**. Nunca publique apresentação, vídeos, falas, senha ou `RADAR_LIVE_HOST_KEY` em código.
- O link do QR contém um convite de acesso à sessão: qualquer pessoa com esse link pode ver os dados complementares até a expiração. Não equivale a autenticação individual.
- O Worker guarda apenas os dados complementares do slide atual para visitantes atrasados, e a sessão expira em 4 horas.
- O envio das informações depende de o apresentador estar conectado à internet. A apresentação local funciona independentemente.
- Proteção da apresentação e autorização de audiência são controles separados.
- O GitHub Pages **não fornece WebSockets**; por isso o Worker continua necessário para sincronização, mas o deploy é gerenciado integralmente pelo GitHub.
