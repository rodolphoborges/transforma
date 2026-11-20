# Radar de Integridade Assistencial

Este repositório é público, mas **a apresentação não deve ser armazenada aqui em texto aberto**.

## Arquitetura de acesso

O site usa uma tela de desbloqueio que descriptografa `docs/payload.bin` **no navegador** com uma senha compartilhada. O conteúdo protegido deve ser cifrado **antes** de qualquer commit, usando o utilitário `tools/encrypt.py`.

**O arquivo `payload.bin` deve conter apenas conteúdo criptografado.** Não envie arquivos originais (`.html`, imagens, vídeos ou ZIP da V6) para este repositório, nem mesmo temporariamente, pois o GitHub mantém histórico de commits.

## Publicação

1. Baixe a versão V6 do Radar em seu computador e extraia a pasta `radar-web-lite`.
2. Execute `python tools/encrypt.py /caminho/para/radar-web-lite docs/payload.bin` em ambiente local seguro.
3. Insira a mesma senha forte que será compartilhada com a equipe. O programa a solicita localmente e **não grava a senha em arquivo**.
4. Envie **somente** o arquivo gerado `docs/payload.bin` ao repositório.
5. Configure o GitHub Pages para publicar a partir da pasta `docs` da branch `main` (caso não esteja disponível, use o workflow de Pages ou copie `docs/index.html` para a raiz).

Se você cadastrou o secret `RADAR_PASSWORD` no GitHub Actions, observe que **ele não está sendo usado pelo site**. Um secret de Actions não pode ser lido pelo navegador e não deve ser copiado para JavaScript. A senha utilizada pelo utilitário local é que desbloqueará o conteúdo.

**Limitações**: o endereço e o arquivo criptografado são públicos; terceiros podem tentar adivinhar a senha offline; pessoas autorizadas podem copiar o conteúdo já desbloqueado. Para autorização por pessoa, revogação e auditoria de acesso, prefira Cloudflare Access.

## Segurança

- Criptografia: AES-256-GCM.
- Derivação da chave: PBKDF2-HMAC-SHA-256 com 600.000 iterações, salt aleatório de 16 bytes.
- Nonce aleatório de 12 bytes por geração.
- Senha recomendada: 20+ caracteres aleatórios.
- O navegador baixa os bytes criptografados, valida a senha e carrega o documento descriptografado em memória.

> **Atenção**: não há mecanismo de recuperação de senha. Guarde-a em um gerenciador de senhas e, se for trocada, gere e publique um novo `payload.bin`.
