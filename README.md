# Rashid

Racha de comida da engenharia. Alguém abre um **Racha** ("pizza hoje meio dia"),
a galera entra no lobby em tempo real, o organizador fecha — e todo mundo recebe
o QR PIX com a sua parte. O organizador adianta a conta e marca os reembolsos
conforme caem no extrato.

O vocabulário do domínio (Racha, Organizador, Parte, Cobrança…) está em
[CONTEXT.md](./CONTEXT.md).

## Stack

- **Server**: Node + Express 5 + Socket.IO (estado das salas ao vivo) + SQLite
  (`better-sqlite3`, durabilidade entre deploys) + `pix-utils` (BR Code / QR
  estático gerado localmente — sem PSP, sem integração bancária).
- **Client**: React 19 + Vite, design tokens TROX (sem logo). Modais no padrão
  shadcn/ui (Dialog + AlertDialog) sobre primitivas Radix, estilizados com os
  mesmos tokens — ver `client/src/ui/`.
- **Acesso**: senha única compartilhada (`APP_PASSWORD`) — pré-tela barra quem
  é de fora; não há login por usuário.

## Rodando local

```bash
npm install
npm run dev        # server em :3001 + Vite em :5173 (proxy pronto)
```

Abra http://localhost:5173 — senha padrão `esfiha` (sem `APP_PASSWORD` definido).

Build + produção local:

```bash
npm run build      # gera client/dist
npm start          # serve tudo em :3001
```

Teste E2E (server precisa estar de pé):

```bash
npm start &        # ou qualquer instância rodando
BASE_URL=http://localhost:3001 npm run smoke
```

## Variáveis de ambiente

| Var | Default | O quê |
| --- | --- | --- |
| `APP_PASSWORD` | `esfiha` | Senha da pré-tela. **Defina em produção.** |
| `ADMIN_PASSWORD` | — | Senha do painel `#/admin`. Sem ela o painel fica desativado. |
| `DB_PATH` | `./data/rashid.db` | Caminho do SQLite. Em produção aponte para o volume. |
| `PORT` | `3001` | Porta HTTP (a Railway injeta a dela). |
| `PIX_CITY` | `CURITIBA` | Cidade gravada no BR Code (exigência do padrão PIX). |

## Painel admin

`#/admin`, atrás de uma senha própria (`ADMIN_PASSWORD`) — separada da senha da
equipe de propósito: dali dá pra apagar o racha de qualquer pessoa. Lista todos
os rachas (inclusive os concluídos, que o lobby esconde), exclui, reabre e
conclui à força. Sem `ADMIN_PASSWORD` definida o painel não abre.

## Chave PIX

O app normaliza a chave para a forma exata que o BR Code exige, porque o banco
casa a chave por string: telefone só é encontrado em E.164 (`+5541987147149`) e
CPF/CNPJ só em dígitos nus. Onze dígitos são ambíguos entre CPF e celular sem
DDI — o desempate é o dígito verificador do CPF, e quem tiver um celular que por
acaso passe no checksum pode forçar telefone digitando com `+55`.

## Deploy na Railway

1. Suba o repositório para o GitHub (`git init`, commit, push).
2. Na Railway: **New Project → Deploy from GitHub repo**. O Nixpacks detecta
   Node e roda `npm install` → `npm run build` → `npm start` sozinho.
3. **Volume** (obrigatório — sem ele o banco morre a cada deploy):
   no serviço, *Settings → Volumes → Add Volume*, mount path `/data`.
4. **Variables**:
   - `APP_PASSWORD` = a senha da equipe
   - `DB_PATH` = `/data/rashid.db`
5. *Settings → Networking → Generate Domain* e compartilhe a URL com a galera.

Uma instância só — o Socket.IO e o SQLite assumem isso. Nessa escala
(35 pessoas) é exatamente o que você quer.
