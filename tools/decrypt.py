#!/usr/bin/env python3
"""Descriptografa docs/payload.bin (formato RDR1) para um index.html local.

Uso: python tools/decrypt.py docs/payload.bin SAIDA.html
"""
import getpass
import sys
from pathlib import Path
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Uso: python tools/decrypt.py docs/payload.bin SAIDA.html")
    data = Path(sys.argv[1]).read_bytes()
    if data[:4] != b"RDR1":
        raise SystemExit("Arquivo não está no formato RDR1.")
    salt, nonce, ciphertext = data[4:20], data[20:32], data[32:]
    secret = getpass.getpass("Senha de acesso: ")
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=600000).derive(secret.encode("utf-8"))
    try:
        html = AESGCM(key).decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise SystemExit("Senha incorreta (ou arquivo corrompido).")
    out = Path(sys.argv[2])
    out.write_bytes(html)
    print("Descriptografado:", out.resolve(), f"({len(html)} bytes)")


if __name__ == "__main__":
    main()
