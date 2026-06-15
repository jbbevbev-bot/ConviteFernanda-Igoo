# Convite Festa

Projeto do convite — pode ser executado como Web Service Python (recomendado) ou hospedado estaticamente.

Resumo rápido
- Para habilitar a API (`/api/*`), uploads e a galeria dinâmica, rode o `server.py` como um serviço Python (Web Service) no Render.
- Se preferir apenas hospedar HTML/CSS/JS como site estático, o front contém um fallback que carrega `_data/*.json`, mas recursos dinâmicos (uploads, mensagens em tempo real) não funcionarão.

Preparar repositório e push (exemplo):

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<seu-usuario>/<seu-repo>.git
git push -u origin main
```

Deploy recomendado no Render (Web Service Python)

1. No painel do Render, crie um novo **Web Service** conectado ao seu repositório GitHub.
2. Configure:
   - **Environment**: `Python`
   - **Branch**: `main`
   - **Start Command**: `python server.py`
   - **Build Command**: deixe em branco (opcional)
   - **Plan**: selecione conforme sua conta
3. Variáveis de ambiente úteis:
   - `PORT` — o servidor usa esse valor (Render fornece automaticamente `PORT`).
   - `DATABASE_URL` — opcional; neste repositório a persistência atualmente usa arquivos JSON em `_data/`. Se quiser usar Postgres em produção, é preciso migrar a camada de persistência (posso implementar isso se desejar).

Notas sobre armazenamento (importante):
- Arquivos enviados à galeria são gravados em `uploads/` no sistema de arquivos do serviço. O armazenamento de arquivos no Render é efêmero por padrão: arquivos podem ser perdidos após um novo deploy. Para persistência, use um bucket S3 (ou serviço similar) ou habilite Persistent Disk (recurso pago do Render).
 - Arquivos enviados à galeria são gravados em `uploads/` no sistema de arquivos do serviço. O armazenamento de arquivos no Render é efêmero por padrão: arquivos podem ser perdidos após um novo deploy. Para persistência, use um bucket S3 (ou serviço similar) ou habilite Persistent Disk (recurso pago do Render).

Persistent Disk (Render) — como usar
- Crie um Persistent Disk no painel do Render e monte em `/home/render/uploads`.
- No serviço (Environment → Environment Variables) adicione: `UPLOADS_DIR=/home/render/uploads`.
- O `server.py` já respeita `UPLOADS_DIR` e gravará uploads nesse caminho quando definido.

Deploy como site estático (opcional)

Se você NÃO precisa de endpoints `/api/*` nem uploads, pode criar um Static Site no Render:
- Use **Static Site** e deixe `Publish Directory` como `.`. O site carregará os JSON em `_data/` como fallback e funcionará sem servidor, mas recursos dinâmicos serão limitados.

Arquivo `render.yaml`

Este repositório contém `render.yaml` configurado para deploy como Web Service (Python). Se preferir, você pode criar o serviço manualmente no painel do Render usando as instruções acima.

Sobre banco de dados

- Atualmente o aplicativo persiste dados em `_data/*.json` (convites, mensagens, galeria). A captura de credenciais do banco que você mencionou (Postgres) não é usada por este código por padrão.
- Se você quiser que eu altere a aplicação para usar `DATABASE_URL` (Postgres) em produção, posso:
  1) adicionar dependência `psycopg2-binary` ou `asyncpg` e uma camada simples de migração; 
  2) migrar leitura/escrita dos JSON para tabelas; 
  3) atualizar o `render.yaml` e o `README.md` com variáveis de ambiente necessárias.

Testes locais

Rode o servidor localmente para testar tudo:

```bash
python server.py
```

Abra `http://localhost:8000`.

Próximos passos que posso fazer por você
- Commitar este `render.yaml` e `README.md` (já atualizado aqui).
- Configurar a migração para Postgres e implementar `DATABASE_URL`.
- Ajudar a configurar o serviço no painel do Render (posso gerar comandos e instruções passo a passo).

Diga qual próximo passo prefere: configurar Postgres, eu configuro o deploy no Render, ou só quer que eu finalize o README e eu commito as mudanças.