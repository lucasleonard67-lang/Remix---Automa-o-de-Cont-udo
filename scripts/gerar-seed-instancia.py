#!/usr/bin/env python3
"""Regenera supabase/seed-instancia.sql a partir das migrations.

O Remix do Lovable clona o SCHEMA (tabelas, colunas, indices, constraints,
funcoes, policies, triggers de public) e para por ai. Tres classes de coisa
ficam para tras, e este script as recupera, EM ORDEM DE ARQUIVO:

  1. DADO semeado por migration — insert/update/delete em public.* / storage.*
  2. PRIVILEGIO — grant/revoke. MEDIDO em 2026-08-31: o remix nasce com o grant
     default do Supabase (EXECUTE para PUBLIC/anon/authenticated em TODAS as
     funcoes de public), o que reabre 16 funcoes que as migrations fecham — entre
     elas `get_vault_secret`, que e SECURITY DEFINER e nao tem checagem no corpo.
     Sem replay dos REVOKEs, qualquer um com a chave publishable le o Vault
     inteiro por POST /rest/v1/rpc/get_vault_secret.
  3. REALTIME — `alter publication supabase_realtime add table`. O
     `replica identity full` migra; a filiacao na publicacao, nao. Sem replay a
     publicacao nasce com ZERO tabelas e a UI nunca atualiza sozinha.

A ordem importa duas vezes: o catalogo de video tem indice unico de "um primario
por capability" (o UPDATE que despromove precisa cair entre os INSERTs), e cada
`grant` de excecao vem logo depois do `revoke` que o precede.

Statements dentro de corpo de funcao nao entram: vem indentados e/ou dentro de
dollar-quoting, e o divisor abaixo os trata como um statement so que comeca em
`create function`. Os blocos `do $$ ... $$` entram apenas quando mexem na
publicacao do Realtime — as migrations ja os escrevem com
`exception when duplicate_object then null`, entao sao idempotentes.

    python3 scripts/gerar-seed-instancia.py
"""
import re
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = RAIZ / "supabase" / "migrations"
SAIDA = RAIZ / "supabase" / "seed-instancia.sql"

CABECALHO = """\
-- ============================================================================
-- seed-instancia.sql — semeia uma instância NOVA (pós-Remix)
-- ============================================================================
-- GERADO por scripts/gerar-seed-instancia.py — não edite à mão.
--
-- O Remix do Lovable clona o SCHEMA (tabelas, colunas, índices, constraints,
-- funções, policies, triggers de `public`) e para aí. Três classes de coisa
-- ficam para trás, e este arquivo repõe as três, EM ORDEM DE MIGRATION:
--
--   1. DADO semeado por migration
--   2. PRIVILÉGIO — os GRANT/REVOKE. Sem eles a instância nasce com o grant
--      padrão do Supabase (EXECUTE para anon em TODAS as funções de public), o
--      que reabre 16 funções que as migrations fecham. Uma delas é
--      `get_vault_secret`, SECURITY DEFINER e sem checagem no corpo: qualquer
--      um com a chave publishable lê o Vault inteiro por
--      POST /rest/v1/rpc/get_vault_secret. Isto NÃO aparece em nenhuma tela.
--   3. REALTIME — o `alter publication supabase_realtime add table`. O
--      `replica identity full` migra; a filiação na publicação, não. Sem isto a
--      publicação nasce com ZERO tabelas e a UI nunca atualiza sozinha.
--
-- Ainda ficam de fora, e estão no runbook (docs/15-runbook-remix.md): o trigger
-- `on_auth_user_created` (bloco 1 abaixo), os cron jobs e o `instance_url`
-- (scripts/pos-remix.sql) e os segredos do Vault (passo humano).
--
-- Tudo aqui é IDEMPOTENTE: rodar duas vezes não duplica nem sobrescreve.
-- Depois de rodar, confira com scripts/verificar-instancia.sql.
--
-- A ORDEM IMPORTA duas vezes: o catálogo de vídeo tem índice único de um
-- primário por capability (o UPDATE que despromove precisa cair entre os
-- INSERTs), e cada GRANT de exceção vem logo depois do REVOKE que o precede.
-- Rode o arquivo do começo ao fim, sem reordenar.
-- ============================================================================

-- ── 1. O gatilho que o Remix perde ───────────────────────────────────────────
-- Sem ele ninguém vira admin ao se cadastrar e a instância nasce sem dono.
-- (A função handle_new_user vem no Remix; o trigger em auth.users, não.)

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. Dado, privilégio e Realtime, em ordem de migration ────────────────────

"""

# Tres classes: dado, privilegio e realtime. Ver docstring.
DADO = re.compile(r"^(insert\s+into|update|delete\s+from)\s+(public\.|storage\.)", re.I)
PRIVILEGIO = re.compile(r"^(grant|revoke)\s", re.I)
REPLICA = re.compile(r"^alter\s+table\s+[\w.]+\s+replica\s+identity", re.I)
PUBLICACAO = re.compile(r"^do\s+\$\$.*alter\s+publication\s+supabase_realtime", re.I | re.S)
SEGREDO = re.compile(r"^do\s+\$\$.*vault\.create_secret", re.I | re.S)


def classifica(s):
    """Devolve o rotulo da classe do statement, ou None se ele nao entra no seed.

    Blocos `do $$ ... $$` entram por INTENCAO, nunca por serem blocos: das 29
    ocorrencias nas migrations, a maioria e guarda de DDL (`create type if not
    exists`, `add enum value`) que ja vem no clone de schema e nao deve ser
    reexecutada. So duas intencoes interessam ao seed — mexer na publicacao do
    Realtime e gerar os `*_CRON_SECRET` no Vault. As migrations do RSS e do
    video ja geram esses dois sozinhas com gen_random_bytes; o que faltava era
    o seed carregar os blocos, sem o que a instancia nova nascia sem cron
    secret e alguem tinha que inventar dois valores na mao.
    """
    if DADO.match(s):
        return "dado"
    if PRIVILEGIO.match(s):
        return "privilegio"
    if REPLICA.match(s) or PUBLICACAO.match(s):
        return "realtime"
    if SEGREDO.match(s):
        return "segredo"
    return None


def statements(sql):
    """Divide SQL em statements respeitando aspas simples, dollar-quoting e comentários."""
    i, n, ini = 0, len(sql), 0
    while i < n:
        c = sql[i]
        if sql[i:i + 2] == "--":
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if sql[i:i + 2] == "''":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            continue
        if c == "$":
            m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
            if m:
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                i = n if j < 0 else j + len(tag)
                continue
        if c == ";":
            yield sql[ini:i + 1]
            i += 1
            ini = i
            continue
        i += 1
    resto = sql[ini:].strip()
    if resto:
        yield resto


def sem_comentario_inicial(s):
    linhas = s.split("\n")
    while linhas and (not linhas[0].strip() or linhas[0].lstrip().startswith("--")):
        linhas.pop(0)
    return "\n".join(linhas).strip()


def rotulo(s, classe):
    """Uma linha de comentario que diz o que o statement faz, para o arquivo se ler."""
    if classe == "dado":
        verbo = s.split()[0].lower()
        alvo = re.search(r"(?:into|update|from)\s+([\w.]+)", s, re.I).group(1)
        return f"{verbo} {alvo}"
    if classe == "privilegio":
        verbo = s.split()[0].lower()
        alvo = re.search(r"on\s+(?:function\s+)?([\w.]+)", s, re.I)
        return f"{verbo} {alvo.group(1) if alvo else '?'}"
    if classe == "segredo":
        return "gera segredo de cron se ausente"
    alvo = re.search(r"(?:add\s+table|alter\s+table)\s+([\w.]+)", s, re.I)
    return f"realtime {alvo.group(1) if alvo else '?'}"


def main():
    partes = [CABECALHO]
    contagem = {"dado": 0, "privilegio": 0, "realtime": 0, "segredo": 0}
    for caminho in sorted(MIGRATIONS.glob("*.sql")):
        for s in statements(caminho.read_text()):
            s = sem_comentario_inicial(s)
            classe = classifica(s)
            if classe is None:
                continue
            partes.append(f"-- {caminho.name} · {rotulo(s, classe)}\n{s}\n")
            contagem[classe] += 1
    total = sum(contagem.values())
    resumo = ", ".join(f"{v} de {k}" for k, v in contagem.items())

    # Rodape-sentinela. MEDIDO em 2026-08-31: um Remix entregou este arquivo
    # CORTADO no meio — 2.447 dos 48.093 caracteres — enquanto o template tinha a
    # copia integra. Nada avisou: o arquivo abre, tem cabecalho, tem o gatilho de
    # auth, e simplesmente acaba. Quem rodasse assim teria uma instancia sem
    # dado, sem privilegio e sem Realtime, achando que semeou.
    #
    # Por isso o arquivo termina se declarando. A conferencia e uma linha: se o
    # rodape nao estiver ai, o arquivo chegou truncado — pegue a copia do
    # template antes de rodar qualquer coisa.
    partes.append(
        "-- ============================================================================\n"
        f"-- FIM DO SEED — {total} statements ({resumo})\n"
        "--\n"
        "-- Este rodapé é sentinela. Se o arquivo que você abriu NÃO termina aqui, ele\n"
        "-- chegou TRUNCADO (já aconteceu num Remix real) — não adianta rodar o pedaço:\n"
        "-- pegue a cópia íntegra do projeto template antes de continuar.\n"
        "-- ============================================================================\n"
    )

    SAIDA.write_text("\n".join(partes))
    print(f"{SAIDA.relative_to(RAIZ)}: {total} statements ({resumo})", file=sys.stderr)


if __name__ == "__main__":
    main()
