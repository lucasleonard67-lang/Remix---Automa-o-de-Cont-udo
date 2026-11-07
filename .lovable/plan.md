# Redeploy: higgsfield-oauth

## Objetivo
Fazer o redeploy da Edge Function `higgsfield-oauth` a partir do commit mais recente da branch ativa (`eb6d0ba`), preservando `verify_jwt = false`.

## Contexto
- A função já está declarada em `supabase/config.toml` com `verify_jwt = false`.
- O callback OAuth (`/callback`) é chamado pelo navegador do usuário, redirecionado pelo provedor Higgsfield, sem header `Authorization`. Por isso, a função precisa continuar pública no gateway e fazer sua própria validação de `state` no callback.
- As ações `start`, `status` e `disconnect` continuam validando JWT de admin no próprio código da function.

## Ação
1. Verificar no `supabase/config.toml` que `[functions.higgsfield-oauth]` está com `verify_jwt = false`.
2. Executar o deploy apenas da function `higgsfield-oauth`, sem alterar nenhum arquivo de código, migrations, schema ou frontend.

## Não será alterado
- Código de `supabase/functions/higgsfield-oauth/index.ts`.
- Módulos compartilhados (`_shared/`).
- Outras Edge Functions.
- Banco de dados, migrations ou frontend.
