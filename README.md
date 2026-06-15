# Convite Festa (site estático)

Projeto de convite para festa — site estático (HTML/CSS/JS) pronto para deploy em serviços como Render.

Instruções rápidas para subir no GitHub e implantar no Render:

1. Inicializar git, adicionar arquivos e fazer commit:

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
```

2. Criar repositório no GitHub (via site ou `gh`) e adicionar remoto:

```powershell
git remote add origin https://github.com/<seu-usuario>/<seu-repo>.git
git push -u origin main
```

Ou, usando o GitHub CLI:

```powershell
gh repo create <seu-usuario>/<seu-repo> --private --source=. --remote=origin --push
```

3. Configurar no Render (Static Site):
   - Conecte o repositório GitHub.
   - Branch: `main` (ou a branch que você usar).
   - Build Command: deixe em branco (opcional para site estático simples).
   - Publish Directory: `.` (raiz do repositório onde está `index.html`).
   - Clique em Deploy Static Site.

4. Se precisar de variáveis de ambiente, adicione-as no painel do Render.

Automação (opcional):
- Posso executar os comandos `git` e `gh` aqui se você autorizar e fornecer o URL do repositório remoto, ou as credenciais apropriadas.
- Alternativamente, você pode executar os comandos locais acima.

Arquivos adicionados por mim:
- [README.md](README.md)
- [.gitignore](.gitignore)
- [render.yaml](render.yaml)

Se você quiser que eu crie o repositório no GitHub e faça o push, envie o URL do repositório remoto ou me autorize a usar `gh` CLI aqui. Caso contrário, execute os comandos acima e depois me diga o URL do repo para eu configurar o Render (posso gerar o `render.yaml` final com o `repo` preenchido).