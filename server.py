#!/usr/bin/env python3
"""
Servidor local para o convite de Igo & Fernanda.

Recursos:
- site principal responsivo
- portal do administrador com senha
- confirmação de presença por nome do convidado
- galeria colaborativa de fotos e vídeos
- mensagens especiais
- upload de assets do site (logo, fundo, fotos e áudio)

Uso:
    python server.py
Depois acesse:
    http://localhost:8000
"""

from __future__ import annotations

import json
import os
import re
import socketserver
import sys
import uuid
import unicodedata
from datetime import datetime, timezone
from email.parser import BytesParser
from email.policy import default as email_default_policy
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse
import io
import zipfile
import mimetypes

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / '_data'
# Diretório de uploads — pode ser sobrescrito por env var `UPLOADS_DIR`
_uploads_env = os.environ.get('UPLOADS_DIR', '')
if _uploads_env:
    UPLOADS_DIR = Path(_uploads_env)
else:
    UPLOADS_DIR = BASE_DIR / 'uploads'
ASSETS_DIR = UPLOADS_DIR / 'assets'
PORT = int(os.environ.get('PORT', '8000'))
MAX_UPLOAD_SIZE = 30 * 1024 * 1024
MAX_FILES_PER_UPLOAD = 12
ALLOWED_ASSET_PREFIXES = ('image/', 'audio/')

CONFIG_FILE = DATA_DIR / 'config.json'
INVITES_FILE = DATA_DIR / 'invites.json'
MESSAGES_FILE = DATA_DIR / 'messages.json'
GALLERY_FILE = DATA_DIR / 'gallery.json'


def safe_int(value, default=1):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# Garantir tipos MIME essenciais (algumas plataformas podem não mapear corretamente)
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('application/javascript', '.js')


def slugify_filename(name: str) -> str:
    base = Path(name).name
    if '.' in base:
        stem, suffix = base.rsplit('.', 1)
        safe_stem = re.sub(r'[^A-Za-z0-9_-]+', '-', stem).strip('-') or 'arquivo'
        safe_suffix = re.sub(r'[^A-Za-z0-9]+', '', suffix).lower() or 'bin'
        return f'{safe_stem}.{safe_suffix}'
    safe = re.sub(r'[^A-Za-z0-9_-]+', '-', base).strip('-') or 'arquivo'
    return safe


def read_json(path: Path, default_value):
    if not path.exists():
        return default_value
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default_value


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + '.tmp')
    temp_path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp_path.replace(path)


def create_default_row(index: int) -> dict:
    return {
        'id': index,
        'inviteCode': '',
        'name': '',
        'guestCount': 1,
        'guestLimit': 0,
        'contact': '',
        'tableNumber': '',
        'passwords': [],
        'guestNames': [],
        'registeredBy': '',
        'confirmation': 'pendente',
        'confirmationAt': None,
        'declinedAt': None,
    }


def normalize_lookup_text(value) -> str:
    text = unicodedata.normalize('NFD', str(value or '').strip().lower())
    text = ''.join(ch for ch in text if unicodedata.category(ch) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def tokenize_lookup_text(value) -> list[str]:
    normalized = normalize_lookup_text(value)
    return [token for token in normalized.split(' ') if token]


def normalize_guest_names(value) -> list[str]:
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r'[\n,;]+', str(value or ''))
    names = []
    seen = set()
    for raw in raw_items:
        cleaned = re.sub(r'\s+', ' ', str(raw).strip())[:80]
        if not cleaned:
            continue
        key = normalize_lookup_text(cleaned)
        if not key or key in seen:
            continue
        seen.add(key)
        names.append(cleaned)
    return names[:30]


def generate_random_digits(length: int) -> str:
    import random
    return ''.join(str(random.randint(0, 9)) for _ in range(length))


def create_invite_code(invites: list, except_id: int | None = None) -> str:
    used = {row.get('inviteCode') for row in invites if row.get('inviteCode')}
    def looks_sequential(code: str) -> bool:
        asc = '01234567890123456789'
        desc = '98765432109876543210'
        return asc.find(code) != -1 or desc.find(code) != -1 or re.match(r'^([0-9])\1+$', code)

    while True:
        code = generate_random_digits(8)
        if code in used:
            continue
        if looks_sequential(code):
            continue
        return code


def search_invites_by_name(invites: list, lookup: str) -> list:
    lookup_norm = normalize_lookup_text(lookup)
    lookup_tokens = set(tokenize_lookup_text(lookup))
    if not lookup_norm:
        return []
    ranked = []
    for row in invites:
        candidate_name = str(row.get('name', '')).strip()
        if not candidate_name:
            continue
        name_norm = normalize_lookup_text(candidate_name)
        if not name_norm:
            continue
        name_tokens = set(name_norm.split(' '))
        overlap = lookup_tokens & name_tokens
        score = 0
        if lookup_norm == name_norm:
            score += 100
        if lookup_norm and lookup_norm in name_norm:
            score += 60
        score += len(overlap) * 25
        if any(token.startswith(lookup_norm) or lookup_norm.startswith(token) for token in name_tokens):
            score += 10
        if score > 0:
            ranked.append((score, row))
    ranked.sort(key=lambda item: (-item[0], str(item[1].get('name', '')).lower(), item[1].get('id', 0)))
    return [row for _, row in ranked[:12]]


def default_gifts() -> list:
    return [
        {
            'title': 'Jantar romântico da 2ª lua de mel',
            'price': 280,
            'description': 'Um jantar especial para celebrar o amor em grande estilo.',
            'imageUrl': '',
            'imageQuery': 'jantar romântico casal lua de mel',
            'icon': 'fa-utensils',
            'mercadoPagoLink': '',
            'pixEnabled': True,
        },
        {
            'title': 'Café da manhã especial',
            'price': 95,
            'description': 'Mesa posta com delícias para começar o dia com carinho.',
            'imageUrl': '',
            'imageQuery': 'café da manhã romântico hotel',
            'icon': 'fa-mug-hot',
            'mercadoPagoLink': '',
            'pixEnabled': True,
        },
        {
            'title': 'Massagem relaxante para o casal',
            'price': 320,
            'description': 'Momento de descanso e cuidado para os dois.',
            'imageUrl': '',
            'imageQuery': 'spa casal massagem relaxante',
            'icon': 'fa-spa',
            'mercadoPagoLink': '',
            'pixEnabled': True,
        },
        {
            'title': 'Passeio ao pôr do sol',
            'price': 210,
            'description': 'Experiência romântica para guardar na memória.',
            'imageUrl': '',
            'imageQuery': 'passeio pôr do sol casal viagem',
            'icon': 'fa-sun',
            'mercadoPagoLink': '',
            'pixEnabled': True,
        },
        {
            'title': 'Surpresa especial para Fernanda',
            'price': 350,
            'description': 'Um mimo preparado com muito amor durante a viagem.',
            'imageUrl': '',
            'imageQuery': 'surpresa romântica presente casal',
            'icon': 'fa-gift',
            'mercadoPagoLink': '',
            'pixEnabled': True,
        },
        {
            'title': 'Brinde com vinho',
            'price': 160,
            'description': 'Um brinde elegante para uma noite inesquecível.',
            'imageUrl': '',
            'imageQuery': 'vinho jantar romântico casal',
            'icon': 'fa-wine-glass',
            'pixEnabled': True,
        },
    ]


def default_story_items() -> list:
    return [
        {
            'year': '2016',
            'title': 'O início da nossa jornada',
            'description': 'Entre sorrisos e conversas longas, começamos a construir uma história de amor, amizade e companheirismo.',
            'imageUrl': 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=1200&q=80',
        },
        {
            'year': '2017',
            'title': 'Descobrindo o mundo a dois',
            'description': 'Cada passeio e cada sonho reforçaram a certeza de que queríamos seguir de mãos dadas pela vida.',
            'imageUrl': 'https://images.unsplash.com/photo-1529636444744-adffc9135a5e?w=1200&q=80',
        },
        {
            'year': '2018',
            'title': 'Casamento e novos capítulos',
            'description': 'Prometemos amor, cuidado e fidelidade. Desde então, renovamos esse compromisso todos os dias.',
            'imageUrl': 'https://images.unsplash.com/photo-1543168256-418811576931?w=1200&q=80',
        },
        {
            'year': '2026',
            'title': 'Renovação de votos',
            'description': 'Agora celebramos 10 anos de casamento com o coração cheio de alegria, ao lado de pessoas queridas.',
            'imageUrl': 'https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?w=1200&q=80',
        },
    ]


def default_gallery() -> list:
    return [
        {
            'id': str(uuid.uuid4()),
            'type': 'image',
            'url': 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&q=80',
            'uploader': 'Prévia do convite',
            'createdAt': utc_now_iso(),
            'filename': '',
        },
        {
            'id': str(uuid.uuid4()),
            'type': 'image',
            'uploader': 'Prévia do convite',
            'createdAt': utc_now_iso(),
            'filename': '',
        },
        {
            'id': str(uuid.uuid4()),
            'type': 'image',
            'url': 'https://images.unsplash.com/photo-1591604021695-0c69b7c05981?w=1200&q=80',
            'uploader': 'Prévia do convite',
            'createdAt': utc_now_iso(),
            'filename': '',
        },
        {
            'id': str(uuid.uuid4()),
            'type': 'image',
            'url': 'https://images.unsplash.com/photo-1549417229-aa67d3263ad4?w=1200&q=80',
            'uploader': 'Prévia do convite',
            'createdAt': utc_now_iso(),
            'filename': '',
        },
    ]

def default_config() -> dict:
    return {
        'adminPassword': 'igofernanda2026',
        'theme': {
            'bg': '#f5f3ec',
            'bgSoft': '#fbfaf6',
            'paper': 'rgba(255,255,255,.86)',
            'paperStrong': 'rgba(255,255,255,.95)',
            'text': '#31402c',
            'accent': '#7d8f59',
            'accentDark': '#51613b',
            'accentDeep': '#40502d',
            'accentSoft': '#dde5cf',
            'goldSoft': '#d7c59f',
            'heroGradientStart': '#31402c',
            'heroGradientMiddle': '#4f5f3d',
            'heroGradientEnd': '#77885a',
            'sectionDarkStart': '#465337',
            'sectionDarkMiddle': '#59684a',
        },
        'branding': {
            'logoMode': 'image',
            'logoUrl': 'images/logo-festa.png',
            'monogramInitials': 'IF',
            'monogramTemplate': 'luxury-script',
            'logoPrimaryColor': '#111111',
            'logoAccentColor': '#3f8a17',
            'logoBackgroundColor': '#ffffff',
            'heroBackgroundUrl': 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1800&q=80',
            'siteTextureUrl': '',
        },
        'animation': {
            'enabled': True,
            'symbol': '❦',
            'density': 24,
        },
        'media': {
            'enabled': True,
            'mode': 'preset',
            'preset': 'instrumental-romantico',
            'audioUrl': '',
            'title': 'Trilha do casal',
            'subtitle': 'Instrumental romântico',
            'volume': 0.28,
            'autoplay': False,
        },
        'event': {
            'heroPre': 'Convidamos você para nossa renovação de votos em comemoração aos nossos 10 anos de casamento',
            'heroNote': 'Layout renovado em verde oliva, com portal administrativo privado, confirmação por modal e galeria colaborativa.',
            'coupleNames': 'Igo & Fernanda',
            'eventDateIso': '2026-08-01T17:00',
            'dateDisplay': '01 de Agosto de 2026 às 17h',
            'locationName': 'Salão de Festas - Condomínio Residencial Tapajós',
            'locationAddress': 'Av. Torquato Tapajós - 6437 - Tarumã - Manaus/AM',
            'mapsUrl': 'https://maps.app.goo.gl/hVNNUPjzZ5iNvbLW6',
            'mapEmbedUrl': 'https://www.google.com/maps?q=Condom%C3%ADnio%20Residencial%20Tapaj%C3%B3s%20Manaus&output=embed',
            'dressCode': 'Elegante / social',
            'dressCodeHint': 'Cores sugeridas: tons suaves, verdes e neutros',
            'footerText': 'Apresente este convite na portaria de entrada.',
            'footerQuote': 'Vocês fazem parte da nossa história.',
            'storyPre': 'Um amor para toda a vida',
            'storyTitle': 'Nossa História',
            'storyIntro': 'Uma linha do tempo para contar um pouco da nossa jornada.',
            'ceremonyPre': 'Detalhes do grande dia',
            'ceremonyTitle': 'Cerimônia & Festa',
            'locationPre': 'Como chegar',
            'locationTitle': 'Localização',
            'giftsPre': 'Sua presença é nosso maior presente',
            'giftsTitle': 'Lista de Presentes',
            'giftsDescription': 'Criamos uma lista especial para a nossa 2ª lua de mel. Escolha um item para presentear via Mercado Pago ou Pix.',
            'galleryPre': 'Momentos especiais',
            'galleryTitle': 'Galeria da Festa',
            'galleryDescription': 'Depois da festa, os convidados podem compartilhar fotos e vídeos diretamente pelo site.',
            'messagesPre': 'Deixe um recado',
            'messagesTitle': 'Mensagens Especiais',
            'messagesDescription': 'Escreva uma mensagem carinhosa para Igo & Fernanda. Cada recado ficará guardado com muito amor.',
        },
        'couple': {
            'fernandaName': 'Fernanda',
            'fernandaRole': 'Esposa',
            'fernandaBio': 'Mãe amorosa, apaixonada pela família, por viagens e pelo cheiro de café pela manhã.',
            'fernandaImageUrl': 'images/fernanda.jpg',
            'igoName': 'Igo',
            'igoRole': 'Marido',
            'igoBio': 'Grande pai, parceiro dedicado e aventureiro. Encontrou em Fernanda a companheira ideal para compartilhar sonhos e conquistas.',
            'igoImageUrl': 'images/igo.jpeg',
        },
        'story': {
            'items': default_story_items(),
        },
        'payment': {
            'mercadoPagoLink': '',
            'pixKey': 'chavepix@exemplo.com',
            'pixInstructions': 'Após o pagamento, envie o comprovante aos noivos.',
        },
        'gifts': default_gifts(),
    }


def merge_defaults(base, incoming):
    if isinstance(base, dict) and isinstance(incoming, dict):
        merged = {}
        for key, value in base.items():
            if key in incoming:
                merged[key] = merge_defaults(value, incoming.get(key))
            else:
                merged[key] = value
        for key, value in incoming.items():
            if key not in merged:
                merged[key] = value
        return merged
    if isinstance(base, list):
        return incoming if isinstance(incoming, list) else base
    return incoming if incoming not in (None, '') else base


def sanitize_public_config(config: dict) -> dict:
    public_config = json.loads(json.dumps(config))
    public_config.pop('adminPassword', None)
    return public_config


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    if not CONFIG_FILE.exists():
        write_json(CONFIG_FILE, default_config())
    if not INVITES_FILE.exists():
        write_json(INVITES_FILE, [create_default_row(i + 1) for i in range(100)])
    if not MESSAGES_FILE.exists():
        write_json(MESSAGES_FILE, [])
    if not GALLERY_FILE.exists():
        write_json(GALLERY_FILE, default_gallery())


def load_config() -> dict:
    stored = read_json(CONFIG_FILE, {})
    merged = merge_defaults(default_config(), stored if isinstance(stored, dict) else {})
    return merged


def load_invites() -> list:
    invites = read_json(INVITES_FILE, [create_default_row(i + 1) for i in range(100)])
    normalized = []
    for index, row in enumerate(invites, start=1):
        base = create_default_row(index)
        base.update(row or {})
        base['id'] = index
        base['guestCount'] = max(1, min(30, safe_int(base.get('guestCount'), 1)))
        base['guestLimit'] = max(0, min(30, safe_int(base.get('guestLimit'), 0)))
        base['tableNumber'] = str(base.get('tableNumber', '')).strip()[:40]
        if not isinstance(base.get('passwords'), list):
            base['passwords'] = []
        base['guestNames'] = normalize_guest_names(base.get('guestNames', []))
        base['registeredBy'] = str(base.get('registeredBy', '')).strip()[:80]
        normalized.append(base)
    return normalized


def load_messages() -> list:
    messages = read_json(MESSAGES_FILE, [])
    return messages if isinstance(messages, list) else []


def load_gallery() -> list:
    gallery = read_json(GALLERY_FILE, [])
    return gallery if isinstance(gallery, list) else []


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class InviteHandler(SimpleHTTPRequestHandler):
    def _send_json(self, payload, status=HTTPStatus.OK):
        raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password')
        self.end_headers()
        self.wfile.write(raw)

    def _send_error(self, message, status=HTTPStatus.BAD_REQUEST):
        self._send_json({'message': message}, status)

    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if length > MAX_UPLOAD_SIZE:
            raise ValueError('O arquivo enviado excede o limite permitido.')
        return self.rfile.read(length)

    def _read_json(self):
        body = self._read_body()
        if not body:
            return {}
        return json.loads(body.decode('utf-8'))

    def _parse_multipart(self):
        content_type = self.headers.get('Content-Type', '')
        body = self._read_body()
        parser = BytesParser(policy=email_default_policy)
        msg = parser.parsebytes(
            f'Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n'.encode('utf-8') + body
        )
        fields = {}
        files = []
        if not msg.is_multipart():
            return fields, files
        for part in msg.iter_parts():
            name = part.get_param('name', header='Content-Disposition')
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b''
            if filename:
                files.append({
                    'field_name': name,
                    'filename': filename,
                    'content_type': part.get_content_type(),
                    'content': payload,
                })
            else:
                fields[name] = payload.decode('utf-8', errors='ignore')
        return fields, files

    def _admin_authenticated(self) -> bool:
        config = load_config()
        return self.headers.get('X-Admin-Password', '') == config.get('adminPassword', '')

    def _require_admin(self) -> bool:
        if self._admin_authenticated():
            return True
        self._send_error('Senha do administrador inválida.', HTTPStatus.UNAUTHORIZED)
        return False

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        if path.startswith('/_data'):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if path == '/api/site-data':
            config = load_config()
            payload = {
                'config': sanitize_public_config(config),
                'messages': load_messages(),
                'gallery': load_gallery(),
            }
            self._send_json(payload)
            return
        if path == '/api/admin/state':
            if not self._require_admin():
                return
            self._send_json({
                'config': load_config(),
                'invites': load_invites(),
                'gallery': load_gallery(),
                'messages': load_messages(),
            })
            return
        if path == '/api/admin/gallery/download':
            if not self._require_admin():
                return
            gallery = load_gallery()
            # coletar nomes de arquivo que foram enviados para a galeria
            filenames = [entry.get('filename') for entry in gallery if entry.get('filename')]
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
                for fname in filenames:
                    try:
                        target = UPLOADS_DIR / fname
                        if target.exists() and target.is_file():
                            zf.write(str(target), arcname=Path(fname).name)
                    except Exception:
                        # ignorar arquivos problemáticos e continuar
                        pass
            buf.seek(0)
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', 'attachment; filename="galeria.zip"')
            self.send_header('Content-Length', str(len(buf.getvalue())))
            self.end_headers()
            try:
                self.wfile.write(buf.getvalue())
            except Exception:
                pass
            return
        if path.startswith('/api/invite-search/'):
            lookup = unquote(path.split('/api/invite-search/', 1)[1]).strip()
            if not lookup:
                self._send_error('Digite o seu primeiro nome para localizar o convite.', HTTPStatus.BAD_REQUEST)
                return
            invites = load_invites()
            matches = search_invites_by_name(invites, lookup)
            if not matches:
                self._send_error('Nome do convidado não encontrado. Digite o seu primeiro nome.', HTTPStatus.NOT_FOUND)
                return
            self._send_json({'matches': matches, 'lookup': lookup})
            return
        if path.startswith('/api/invite/'):
            invite_code = unquote(path.split('/api/invite/', 1)[1]).strip()
            invites = load_invites()
            row = next((item for item in invites if item.get('inviteCode') == invite_code), None)
            if not row:
                self._send_error('Convite não encontrado. Confira o código informado.', HTTPStatus.NOT_FOUND)
                return
            self._send_json({'invite': row})
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        try:
            if path == '/api/admin/login':
                payload = self._read_json()
                password = str(payload.get('password', ''))
                config = load_config()
                if password != config.get('adminPassword', ''):
                    self._send_error('Senha inválida.', HTTPStatus.UNAUTHORIZED)
                    return
                self._send_json({'message': 'Acesso autorizado.'})
                return
            if path == '/api/admin/gallery/download':
                if not self._require_admin():
                    return
                data = self._read_json()
                ids = data.get('ids') if isinstance(data, dict) else None
                gallery = load_gallery()
                # map ids to filenames; if no ids provided, include all
                items = gallery if not ids else [entry for entry in gallery if entry.get('id') in ids]
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for entry in items:
                        fname = entry.get('filename')
                        if not fname:
                            continue
                        target = UPLOADS_DIR / fname
                        try:
                            if target.exists() and target.is_file():
                                zf.write(str(target), arcname=Path(fname).name)
                        except Exception:
                            pass
                buf.seek(0)
                self.send_response(HTTPStatus.OK)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Disposition', 'attachment; filename="galeria.zip"')
                self.send_header('Content-Length', str(len(buf.getvalue())))
                self.end_headers()
                try:
                    self.wfile.write(buf.getvalue())
                except Exception:
                    pass
                return

            if path == '/api/admin/save':
                if not self._require_admin():
                    return
                payload = self._read_json()
                config = payload.get('config') or {}
                invites = payload.get('invites') or []
                if not isinstance(config, dict) or not isinstance(invites, list):
                    self._send_error('Dados inválidos para salvar o painel.')
                    return
                normalized_config = merge_defaults(default_config(), config)
                normalized_invites = []
                for index, row in enumerate(invites, start=1):
                    base = create_default_row(index)
                    base.update(row or {})
                    base['id'] = index
                    base['guestCount'] = max(1, min(30, safe_int(base.get('guestCount'), 1)))
                    base['guestLimit'] = max(0, min(30, safe_int(base.get('guestLimit'), 0)))
                    base['tableNumber'] = str(base.get('tableNumber', '')).strip()[:40]
                    if not isinstance(base.get('passwords'), list):
                        base['passwords'] = []
                    base['guestNames'] = normalize_guest_names(base.get('guestNames', []))
                    base['registeredBy'] = str(base.get('registeredBy', '')).strip()[:80]
                    normalized_invites.append(base)
                messages = payload.get('messages')
                if isinstance(messages, list):
                    normalized_messages = []
                    for item in messages:
                        if not isinstance(item, dict):
                            continue
                        normalized_messages.append({
                            'id': str(item.get('id', '')).strip() or str(uuid.uuid4()),
                            'name': str(item.get('name', '')).strip()[:80],
                            'message': str(item.get('message', '')).strip()[:500],
                            'createdAt': str(item.get('createdAt', '')).strip() or utc_now_iso(),
                        })
                    write_json(MESSAGES_FILE, normalized_messages[:100])
                write_json(CONFIG_FILE, normalized_config)
                write_json(INVITES_FILE, normalized_invites)
                self._send_json({'message': 'Painel salvo com sucesso.'})
                return

            if path == '/api/admin/upload-asset':
                if not self._require_admin():
                    return
                fields, files = self._parse_multipart()
                if not files:
                    self._send_error('Selecione um arquivo para envio.')
                    return
                file = files[0]
                content_type = file.get('content_type', '')
                if not any(content_type.startswith(prefix) for prefix in ALLOWED_ASSET_PREFIXES):
                    self._send_error('Envie apenas imagens ou arquivos de áudio.')
                    return
                content = file.get('content', b'')
                if len(content) > MAX_UPLOAD_SIZE:
                    self._send_error('O arquivo enviado excede o limite permitido.')
                    return
                slot = re.sub(r'[^A-Za-z0-9_-]+', '-', str(fields.get('slot', 'asset')).strip() or 'asset')
                filename = slugify_filename(file.get('filename', 'arquivo'))
                unique_name = f'{slot}-{uuid.uuid4().hex[:8]}-{filename}'
                target = ASSETS_DIR / unique_name
                target.write_bytes(content)
                self._send_json({
                    'message': 'Arquivo enviado com sucesso.',
                    'url': f'/uploads/assets/{unique_name}',
                    'contentType': content_type,
                    'filename': unique_name,
                })
                return

            if path == '/api/rsvp':
                payload = self._read_json()
                print('DEBUG RSVP payload:', payload)
                invite_code = str(payload.get('inviteCode', '')).strip()
                response = str(payload.get('response', '')).strip()
                guest_names = normalize_guest_names(payload.get('guestNames', []))
                registered_by = str(payload.get('registeredBy', '')).strip()[:80]
                attending_count_raw = payload.get('attendingCount') if isinstance(payload, dict) else None
                attending_count = safe_int(attending_count_raw, None)
                print('DEBUG attending_count_raw:', attending_count_raw, '->', attending_count)
                if response not in {'confirmado', 'recusado'}:
                    self._send_error('Resposta inválida para o RSVP.')
                    return
                invites = load_invites()
                row = None
                if invite_code:
                    row = next((item for item in invites if item.get('inviteCode') == invite_code), None)
                else:
                    # Tentar localizar pelo nome informado caso não haja inviteCode
                    lookup_name = registered_by or str(payload.get('registeredName', '')).strip()
                    if lookup_name:
                        matches = search_invites_by_name(invites, lookup_name)
                        if matches:
                            row = matches[0]
                if not row:
                    self._send_error('Convite não encontrado. Confira o nome ou contate o administrador.', HTTPStatus.NOT_FOUND)
                    return
                row['guestNames'] = guest_names
                row['registeredBy'] = registered_by or row.get('registeredBy', '') or row.get('name', '')
                # atualizar contato se fornecido pelo convidado
                contact = str(payload.get('contact', '')).strip()
                if contact:
                    row['contact'] = contact[:80]
                row['confirmation'] = response
                if response == 'confirmado':
                    row['confirmationAt'] = utc_now_iso()
                    row['declinedAt'] = None
                else:
                    row['declinedAt'] = utc_now_iso()
                # Registrar quantidade que irá comparecer (attendingCount) sem sobrescrever o limite original
                if attending_count is not None:
                    # Permitir que o convidado informe até 30 pessoas
                    attending_count = max(1, min(30, attending_count))
                    # respeitar limite definido pelo administrador, se houver
                    try:
                        limit = max(0, min(30, safe_int(row.get('guestLimit'), 0)))
                    except Exception:
                        limit = 0
                    if limit and attending_count > limit:
                        attending_count = limit
                    row['attendingCount'] = attending_count
                    # Atualizar também o campo `guestCount` para que o painel do admin reflita a quantidade informada
                    row['guestCount'] = attending_count
                # Garantir que convites confirmados possuam um `inviteCode` para poderem ser abertos posteriormente
                if response == 'confirmado' and not row.get('inviteCode'):
                    try:
                        row['inviteCode'] = create_invite_code(invites, row.get('id'))
                    except Exception:
                        # em caso de falha incomum, não interromper o fluxo
                        pass
                write_json(INVITES_FILE, invites)
                msg = 'Presença confirmada com sucesso.' if response == 'confirmado' else ''
                self._send_json({'message': msg, 'invite': row})
                return

            if path == '/api/messages':
                payload = self._read_json()
                name = str(payload.get('name', '')).strip()
                message = str(payload.get('message', '')).strip()
                if not name or not message:
                    self._send_error('Informe seu nome e sua mensagem.')
                    return
                messages = load_messages()
                messages.insert(0, {
                    'id': str(uuid.uuid4()),
                    'name': name[:80],
                    'message': message[:500],
                    'createdAt': utc_now_iso(),
                })
                write_json(MESSAGES_FILE, messages[:100])
                self._send_json({'message': 'Mensagem enviada com sucesso.'})
                return

            if path == '/api/gallery/upload':
                fields, files = self._parse_multipart()
                uploader = str(fields.get('uploader', 'Convidado')).strip() or 'Convidado'
                if not files:
                    self._send_error('Selecione ao menos um arquivo para enviar.')
                    return
                if len(files) > MAX_FILES_PER_UPLOAD:
                    self._send_error('Envie no máximo 12 arquivos por vez.')
                    return
                gallery = load_gallery()
                uploaded_items = []
                for file in files:
                    content_type = file.get('content_type', '')
                    if not (content_type.startswith('image/') or content_type.startswith('video/')):
                        continue
                    content = file.get('content', b'')
                    if len(content) > MAX_UPLOAD_SIZE:
                        continue
                    original_name = slugify_filename(file.get('filename', 'arquivo'))
                    unique_name = f"{uuid.uuid4().hex[:8]}-{original_name}"
                    target = UPLOADS_DIR / unique_name
                    target.write_bytes(content)
                    item = {
                        'id': str(uuid.uuid4()),
                        'type': 'video' if content_type.startswith('video/') else 'image',
                        'url': f'/uploads/{unique_name}',
                        'uploader': uploader[:80],
                        'createdAt': utc_now_iso(),
                        'filename': unique_name,
                    }
                    gallery.insert(0, item)
                    uploaded_items.append(item)
                write_json(GALLERY_FILE, gallery[:300])
                self._send_json({'message': f'{len(uploaded_items)} arquivo(s) enviado(s) com sucesso.', 'items': uploaded_items})
                return

            if path.startswith('/api/admin/gallery/delete'):
                if not self._require_admin():
                    return
                data = self._read_json()
                item_id = str(data.get('id', '')).strip()
                if not item_id:
                    self._send_error('ID do item não informado.')
                    return
                gallery = load_gallery()
                item = next((entry for entry in gallery if entry.get('id') == item_id), None)
                if not item:
                    self._send_error('Item da galeria não encontrado.', HTTPStatus.NOT_FOUND)
                    return
                filename = item.get('filename')
                gallery = [entry for entry in gallery if entry.get('id') != item_id]
                write_json(GALLERY_FILE, gallery)
                if filename:
                    target = UPLOADS_DIR / filename
                    if target.exists():
                        try:
                            target.unlink()
                        except Exception:
                            pass
                self._send_json({'message': 'Item removido da galeria.'})
                return

            self._send_error('Rota não encontrada.', HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self._send_error(str(error), HTTPStatus.BAD_REQUEST)
        except json.JSONDecodeError:
            self._send_error('JSON inválido.', HTTPStatus.BAD_REQUEST)
        except Exception as error:
            print('Erro interno:', error, file=sys.stderr)
            self._send_error('Ocorreu um erro interno no servidor.', HTTPStatus.INTERNAL_SERVER_ERROR)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


if __name__ == '__main__':
    ensure_storage()
    os.chdir(BASE_DIR)
    # Bind em 0.0.0.0 para permitir acesso externo em ambientes de produção
    with ThreadingHTTPServer(('0.0.0.0', PORT), InviteHandler) as httpd:
        print(f'Servidor rodando em http://0.0.0.0:{PORT}')
        print(f'Uploads directory: {UPLOADS_DIR}')
        print('Portal do administrador com senha habilitado')
        print('Editor visual com uploads de logo, fundo, imagens e áudio')
        print('Galeria colaborativa de fotos e vídeos habilitada')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServidor finalizado com sucesso.')
