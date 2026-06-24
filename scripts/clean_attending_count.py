#!/usr/bin/env python3
"""Remove todos os campos `attendingCount` de `_data/invites.json`.

Uso: python scripts/clean_attending_count.py
"""
from pathlib import Path
import json

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / '_data'
INVITES = DATA / 'invites.json'

if not INVITES.exists():
    print('Arquivo não encontrado:', INVITES)
    raise SystemExit(1)

try:
    data = json.loads(INVITES.read_text(encoding='utf-8'))
except Exception as e:
    print('Falha ao ler JSON:', e)
    raise SystemExit(2)

if not isinstance(data, list):
    print('Formato inesperado em invites.json')
    raise SystemExit(3)

changed = 0
for item in data:
    if isinstance(item, dict) and 'attendingCount' in item:
        del item['attendingCount']
        changed += 1

if changed:
    INVITES.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Removido `attendingCount` de {changed} registro(s).')
else:
    print('Nenhum campo `attendingCount` encontrado.')
