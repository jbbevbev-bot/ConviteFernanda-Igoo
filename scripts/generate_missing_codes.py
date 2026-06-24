#!/usr/bin/env python3
"""Gera `inviteCode` e `passwords` para convites que estejam sem eles.

Uso: python scripts/generate_missing_codes.py
"""
import json
import random
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
INVITES = BASE / '_data' / 'invites.json'

def generate_code(existing):
    while True:
        code = ''.join(str(random.randint(0,9)) for _ in range(8))
        if code not in existing and not code.startswith('0'):
            return code

def generate_passwords(n):
    out = []
    seen = set()
    while len(out) < max(1, n):
        code = ''.join(str(random.randint(0,9)) for _ in range(5))
        if code in seen: continue
        seen.add(code)
        out.append({'label': f'Senha {str(len(out)+1).zfill(2)}', 'code': code})
    return out

if not INVITES.exists():
    print('invites.json não encontrado em', INVITES)
    raise SystemExit(1)

data = json.loads(INVITES.read_text(encoding='utf-8'))
existing_codes = {str(item.get('inviteCode')) for item in data if item.get('inviteCode')}
changed = 0
for item in data:
    pw = item.get('passwords')
    code = item.get('inviteCode')
    guestCount = int(item.get('guestCount') or 1)
    if not code:
        newc = generate_code(existing_codes)
        item['inviteCode'] = newc
        existing_codes.add(newc)
        changed += 1
    if not isinstance(pw, list) or len(pw) < 1:
        item['passwords'] = generate_passwords(guestCount)
        changed += 1

if changed:
    INVITES.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Gerados códigos/senhas para {changed} campos.')
else:
    print('Nenhuma alteração necessária.')
