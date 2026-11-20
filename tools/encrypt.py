#!/usr/bin/env python3
"""Encrypt a local Radar directory into the only file safe to publish in docs/."""
import base64
import getpass
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

def main():
    if len(sys.argv) != 3:
        raise SystemExit("Uso: python tools/encrypt.py PASTA_RADAR docs/payload.bin")
    source=Path(sys.argv[1]).expanduser().resolve()
    output=Path(sys.argv[2]).expanduser().resolve()
    html_path=source/"index.html"
    if not html_path.is_file() or not (source/"assets").is_dir():
        raise SystemExit("A pasta deve conter index.html e assets/.")
    html=html_path.read_text(encoding="utf-8")
    assets={}
    for file in sorted((source/"assets").rglob("*")):
        if not file.is_file():
            continue
        relative=file.relative_to(source).as_posix()
        mimetype=mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        assets[file.name]="data:"+mimetype+";base64,"+base64.b64encode(file.read_bytes()).decode("ascii")
        html=html.replace(relative,assets[file.name])
    # Some team portrait URLs are built dynamically by JavaScript.
    if "const A='assets/';" in html:
        html=html.replace("const A='assets/';","const ASSET_DATA="+json.dumps(assets,separators=(',',':'))+";const A='';")
        html=html.replace("A+p[0]","ASSET_DATA[p[0]]")
    # The presentation must not leak the viewer's IP to an external font service.
    html=re.sub(r"@import url\('https://fonts.googleapis.com/[^']+'\);","",html)
    if re.search(r"assets/[A-Za-z0-9_.-]+",html):
        raise SystemExit("Há referências a ativos não incorporados; não publique este arquivo.")
    secret=getpass.getpass("Senha de acesso (mín. 20 caracteres): ")
    if len(secret)<20:
        raise SystemExit("Use uma senha longa de ao menos 20 caracteres.")
    confirm=getpass.getpass("Confirme a senha: ")
    if secret!=confirm:
        raise SystemExit("As senhas não coincidem.")
    salt=os.urandom(16)
    nonce=os.urandom(12)
    kdf=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=600000)
    key=kdf.derive(secret.encode("utf-8"))
    encrypted=AESGCM(key).encrypt(nonce,html.encode("utf-8"),None)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(b"RDR1"+salt+nonce+encrypted)
    print("Arquivo criptografado:",output,"(",output.stat().st_size,"bytes )")
    print("ENVIE SOMENTE payload.bin. Nunca envie a pasta original ou a senha.")
if __name__=="__main__":
    main()
