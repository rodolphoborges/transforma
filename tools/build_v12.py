#!/usr/bin/env python3
"""Gera docs/payload.bin a partir da pasta local da apresentação V12.3+ (index.html + assets/ + midia/).

Tudo (imagens, vídeos, narrações, roteiros/legendas) é embutido no HTML e então cifrado com AES-256-GCM
(PBKDF2-HMAC-SHA-256, 600.000 iterações) — o mesmo formato "RDR1" que docs/index.html descriptografa.
Nada em claro é escrito no repositório. A senha é pedida no terminal e não é gravada.

Uso:  python tools/build_v12.py PASTA_DA_APRESENTACAO docs/payload.bin [--incluir-vozes-geradas]
"""
import base64, getpass, json, mimetypes, os, sys
from pathlib import Path
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
         '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
         '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.js': 'text/javascript'}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        raise SystemExit(__doc__)
    src, out = Path(args[0]).expanduser().resolve(), Path(args[1]).expanduser().resolve()
    html_path = src / 'index.html'
    if not html_path.is_file() or not (src / 'assets').is_dir():
        raise SystemExit('A pasta deve conter index.html e assets/.')
    html = html_path.read_text(encoding='utf-8')
    if 'function R(p)' not in html or 'RADAR_EMBED' not in html:
        raise SystemExit('Este index.html não tem o resolvedor de mídia da V12.3.12+. Use tools/encrypt.py para versões antigas.')

    embed, total = {}, 0
    files = sorted((src / 'assets').rglob('*')) + (sorted((src / 'midia').rglob('*')) if (src / 'midia').is_dir() else [])
    for f in files:
        if not f.is_file() or f.suffix.lower() not in TYPES:
            continue                                   # LEIA-ME.txt etc. stay out
        rel = f.relative_to(src).as_posix()
        if rel.startswith('assets/narracao-') and '--incluir-vozes-geradas' not in sys.argv:
            continue                                   # old generated voices (VoxCPM): not used by default
        data = f.read_bytes(); total += len(data)
        embed[rel] = [TYPES[f.suffix.lower()], base64.b64encode(data).decode('ascii')]
        print(f'  + {rel:42} {len(data)/1e6:6.2f} MB')
    head = html.find('<head>')
    if head < 0:
        raise SystemExit('index.html sem <head>.')
    html = html[:head + 6] + '<script>window.RADAR_EMBED=' + json.dumps(embed, separators=(',', ':')) + ';</script>' + html[head + 6:]
    print(f'{len(embed)} arquivos embutidos ({total/1e6:.1f} MB) · documento final {len(html)/1e6:.1f} MB')

    secret = os.environ.get('RADAR_PAYLOAD_PASSWORD')          # only for automated local tests
    if not secret:
        secret = getpass.getpass('Senha de acesso (a mesma já distribuída; mín. 20 caracteres): ')
        if getpass.getpass('Confirme a senha: ') != secret:
            raise SystemExit('As senhas não coincidem.')
    if len(secret) < 20:
        raise SystemExit('Use uma senha longa de ao menos 20 caracteres.')
    salt, nonce = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=600000).derive(secret.encode('utf-8'))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(b'RDR1' + salt + nonce + AESGCM(key).encrypt(nonce, html.encode('utf-8'), None))
    print(f'Arquivo criptografado: {out} ({out.stat().st_size/1e6:.1f} MB)')
    print('ENVIE SOMENTE docs/payload.bin (e, se mudou, docs/index.html). Nunca envie a pasta original nem a senha.')

if __name__ == '__main__':
    main()
