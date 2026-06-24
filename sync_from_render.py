#!/usr/bin/env python3
"""
Sincronizador: baixa o estado administrativo e os assets do servidor online (Render)
e aplica no diretório local, fazendo backups antes de sobrescrever.

Uso:
  python sync_from_render.py --url https://meu-app.onrender.com --admin-password SUA_SENHA

O script realiza (1) backup de `_data` e `uploads`, (2) baixa `/api/admin/state`
e grava os arquivos JSON em `_data`, e (3) baixa `/api/admin/gallery/download` e
extrai os arquivos para `uploads/`.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / '_data'
UPLOADS_DIR = BASE_DIR / 'uploads'
BACKUPS_DIR = BASE_DIR / 'backups'


def now_ts() -> str:
    return datetime.now().strftime('%Y%m%d_%H%M%S')


def backup_path(name: str) -> Path:
    return BACKUPS_DIR / f"{name}_backup_{now_ts()}"


def safe_copytree(src: Path, dest: Path) -> None:
    """Copia recursivamente ignorando arquivos problemáticos.

    Faz cópia arquivo-a-arquivo e continua em caso de erro para evitar
    falhas por nomes de arquivo muito longos ou arquivos com permissões.
    """
    if not src.exists():
        print(f'Skipping backup: source not found: {src}')
        return
    dest.mkdir(parents=True, exist_ok=True)
    errors = []
    for root, dirs, files in os.walk(src):
        rel = Path(root).relative_to(src)
        target_dir = dest / rel
        target_dir.mkdir(parents=True, exist_ok=True)
        for name in files:
            s = Path(root) / name
            d = target_dir / name
            try:
                # tentar copiar mantendo metadados quando possível
                shutil.copy2(str(s), str(d))
            except Exception as e:
                errors.append((s, e))
                print(f'Warning: não foi possível copiar {s}: {e}')
    if errors:
        print(f'Backup concluído com {len(errors)} erro(s). Verifique avisos acima.')
    else:
        print(f'Backup criado: {dest}')


def atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)


def fetch_admin_state(base_url: str, admin_password: str) -> dict | None:
    url = base_url.rstrip('/') + '/api/admin/state'
    req = Request(url, headers={'X-Admin-Password': admin_password})
    try:
        with urlopen(req, timeout=30) as resp:
            charset = resp.headers.get_content_charset('utf-8')
            text = resp.read().decode(charset)
            return json.loads(text)
    except HTTPError as e:
        print(f'HTTP error while fetching state: {e.code} {e.reason}')
    except URLError as e:
        print('Network error while fetching state:', e)
    except Exception as e:
        print('Erro inesperado ao baixar estado:', e)
    return None


def download_gallery_zip(base_url: str, admin_password: str) -> bytes | None:
    url = base_url.rstrip('/') + '/api/admin/gallery/download'
    req = Request(url, headers={'X-Admin-Password': admin_password})
    try:
        with urlopen(req, timeout=60) as resp:
            return resp.read()
    except HTTPError as e:
        print(f'HTTP error while downloading gallery zip: {e.code} {e.reason}')
    except URLError as e:
        print('Network error while downloading gallery zip:', e)
    except Exception as e:
        print('Erro inesperado ao baixar galeria:', e)
    return None


def extract_zip_to_uploads(data: bytes) -> None:
    if not data:
        print('Nenhum conteúdo ZIP recebido.')
        return
    try:
        zbuf = io.BytesIO(data)
        with zipfile.ZipFile(zbuf) as zf:
            zf.extractall(path=UPLOADS_DIR)
        print(f'Arquivos extraídos para: {UPLOADS_DIR}')
    except zipfile.BadZipFile:
        print('Conteúdo recebido não é um ZIP válido.')
    except Exception as e:
        print('Erro ao extrair ZIP:', e)


def main() -> int:
    parser = argparse.ArgumentParser(description='Sincroniza estado do Render para local')
    parser.add_argument('--url', required=True, help='Base URL do site no Render (ex: https://minha-app.onrender.com)')
    parser.add_argument('--admin-password', required=False, help='Senha administrativa (ou usar variável de ambiente ADMIN_PASSWORD)')
    args = parser.parse_args()

    admin_password = args.admin_password or ''
    if not admin_password:
        # tentar ler de arquivo local config se existir
        local_config = DATA_DIR / 'config.json'
        if local_config.exists():
            try:
                cfg = json.loads(local_config.read_text(encoding='utf-8'))
                admin_password = cfg.get('adminPassword', '')
            except Exception:
                admin_password = ''

    if not admin_password:
        print('A senha administrativa não foi informada. Use --admin-password ou configure `_data/config.json`.')
        return 2

    base_url = args.url

    # 1) backup
    print('Criando backups locais...')
    safe_copytree(DATA_DIR, backup_path('_data'))
    safe_copytree(UPLOADS_DIR, backup_path('uploads'))

    # 2) fetch state
    print('Baixando estado administrativo de:', base_url)
    state = fetch_admin_state(base_url, admin_password)
    if state is None:
        print('Falha ao obter o estado. Abortando.')
        return 3

    # gravar arquivos
    print('Aplicando arquivos em', DATA_DIR)
    try:
        if 'config' in state and isinstance(state['config'], dict):
            atomic_write_json(DATA_DIR / 'config.json', state['config'])
        if 'invites' in state and isinstance(state['invites'], list):
            atomic_write_json(DATA_DIR / 'invites.json', state['invites'])
        if 'messages' in state and isinstance(state['messages'], list):
            atomic_write_json(DATA_DIR / 'messages.json', state['messages'])
        if 'gallery' in state and isinstance(state['gallery'], list):
            atomic_write_json(DATA_DIR / 'gallery.json', state['gallery'])
    except Exception as e:
        print('Erro ao gravar arquivos de dados:', e)
        return 4

    # 3) baixar assets (ZIP)
    print('Baixando arquivos da galeria (ZIP)...')
    zipdata = download_gallery_zip(base_url, admin_password)
    if zipdata:
        extract_zip_to_uploads(zipdata)
    else:
        print('Nenhum ZIP recebido ou falha no download — verifique permissões/URL.')

    print('Sincronização concluída com sucesso.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
