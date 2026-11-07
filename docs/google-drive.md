# Google Drive

> **Estado em 04/11/2026: desligado.** O hub ainda não tem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no Vault, então `drive-hub` responde 503, a trava "sem Drive não gera" fica desligada em todas as instâncias e o card não aparece em Integrações. O que está abaixo é o desenho para quando as chaves existirem.

Os materiais ficam no Google Drive da pessoa. O banco guarda só o registro (`drive_files`). Sem Drive conectado, ninguém gera material novo; ver, baixar e publicar o que já existe segue normal. Só administrador conecta; os demais veem o pedido para chamar um administrador.

**A trava só liga onde `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` estão salvos, ou seja, no hub.** Nas outras instâncias, o produto gera como sempre até a regra da trava mudar em `supabase/sql/google-drive.sql`.

## Quem faz o quê

- **Cliente:** clica em Conectar e autoriza no Google. Nunca vê Google Cloud, chave ou URI.
- **Nós:** criamos um único cliente OAuth, uma vez, e guardamos as chaves só no hub.
- **Hub:** a function `drive-hub`, no projeto `rpsyfmvwdmzykggcwnoc`. É o único lugar com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
- **Instância nova:** entra na lista do hub (`app_settings.drive_hub_instances`). Nada muda no Google Cloud.

## Como a conexão anda

1. A instância cria `state` e PKCE e abre `drive-hub?instancia&state&challenge`.
2. O hub confere a lista, sela a origem no `state` e manda a pessoa para o Google.
3. O Google volta ao hub, que devolve a pessoa à function `google-drive` da instância.
4. A instância confere o `state` e pede ao hub para trocar o código, com o verifier.
5. O hub devolve os tokens e a credencial da instância. O refresh token fica no Vault da instância, e o hub não guarda token de ninguém.
6. Para renovar, a instância manda o refresh token e a credencial, e recebe o acesso.

Se o hub cair, os envios ao Drive param e voltam sozinhos. A conexão só cai quando o Google responde `invalid_grant`.

Trocar `GOOGLE_CLIENT_SECRET` invalida a credencial das instâncias: todas precisam reconectar. Vazou a chave: gere outra e peça a reconexão.

## Liberar uma instância

No hub, pelo Lovable:

```sql
insert into public.app_settings (key, value)
values ('drive_hub_instances', '{"urls": ["https://REF.supabase.co"]}')
on conflict (key) do update
set value = jsonb_set(
  public.app_settings.value, '{urls}',
  (public.app_settings.value -> 'urls') || '"https://REF.supabase.co"'::jsonb
);
```

O próprio hub não precisa estar na lista.

## Configurar no Google Cloud (uma vez só)

1. **Projeto.** Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto, por exemplo `Content Engine`.
2. **Drive API.** Em APIs e serviços → Biblioteca, ative a **Google Drive API**.
3. **Tela de consentimento.** Em Google Auth Platform → Branding, preencha nome, e-mail de suporte e contato. Em Público, escolha **Externo**. Em Acesso a dados, adicione só `.../auth/drive.file`.
4. **Publicar.** Em Público, clique em **Publicar app** (status "Em produção"). Em "Teste", o refresh token vence em 7 dias e a conexão cai sozinha.
5. **Cliente OAuth.** Em Clientes → Criar cliente, tipo **Aplicativo da Web**. Em URIs de redirecionamento autorizados, cole exatamente:

   ```
   https://rpsyfmvwdmzykggcwnoc.supabase.co/functions/v1/drive-hub
   ```

   Sem barra no fim. Não precisa de origem JavaScript autorizada.
6. **Segredos.** No app do hub, Config → Integrações → Google Drive, cole o ID do cliente e a chave secreta. Eles ficam no Vault. Nunca coloque em código, chat ou `.env`. Esse formulário só aparece no hub.

## Publicar

1. Rode `supabase/sql/google-drive.sql` pelo Lovable.
2. Publique as edges `drive-hub` e `google-drive` com **`verify_jwt = false`**. O Google volta por GET sem Authorization e o tick manda `x-cron-secret`. Com o gateway exigindo JWT, conectar falha com 401.
3. Publique as demais functions alteradas e o front.
4. Crie o agendamento gerenciado (`supabase--create_http_schedule`): POST a cada 5 minutos em `/api/public/jobs/google-drive-tick`. A rota chama `invoke_google_drive_tick`, que lê o segredo do Vault.

## Conferir no banco depois do SQL

Rode pelo Lovable. Isto não dá para confirmar pelo código: depende de como a instância hospedada foi criada.

**1. `director_state` fechada.** Ela guarda access token e verifier do PKCE. O SQL fecha a tabela; confira.

```sql
select c.relrowsecurity as rls_ligada,
       has_table_privilege('anon', 'public.director_state', 'select') as anon_le,
       has_table_privilege('authenticated', 'public.director_state', 'select') as logado_le
from pg_class c
where c.oid = 'public.director_state'::regclass;
```

Certo: `rls_ligada = true`, `anon_le = false`, `logado_le = false`. Qualquer outro resultado: pare e não conecte o Drive.

**2. O dono das funções enxerga o storage.** A varredura lê `storage.objects` por `SECURITY DEFINER`.

```sql
select p.proname, r.rolname as dono, r.rolsuper, r.rolbypassrls
from pg_proc p
join pg_roles r on r.oid = p.proowner
where p.proname in ('google_drive_candidates', 'google_drive_objects_seen', 'google_drive_object');

select public.google_drive_objects_seen(array['renders', 'context-files']) as definer_ve;

select relrowsecurity as rls_ligada, relforcerowsecurity as rls_forcada
from pg_class where oid = 'storage.objects'::regclass;
```

Certo: `rolbypassrls` ou `rolsuper` verdadeiro no dono, `rls_forcada = false` e `definer_ve` maior que zero, se o painel Storage mostra arquivos nesses buckets. Se `definer_ve` vier 0 com arquivos lá, a varredura não acha nada; o modal mostra o aviso e é preciso dar leitura a esse papel.

**3. A trava.**

```sql
select public.google_drive_required() as bloqueia_gerar;

select tgname from pg_trigger
where tgrelid = 'public.director_jobs'::regclass and tgname = 'director_jobs_require_drive';

-- cron.job não é legível pelo agente: confira com list_http_schedules
```

Certo: `bloqueia_gerar = false` antes de salvar as chaves e `true` depois, até conectar. O trigger e o cron existem.

**4. A última rodada da varredura.**

```sql
select value from public.director_state where key = 'google_drive_last_run';
```

## Primeiro teste, antes de ligar o apagamento

O apagamento começa **desligado**: a varredura copia e confere, mas não tira nada do storage. Faça a ida e volta real com um arquivo só:

1. Conecte o Drive e confira a pasta **Content Engine** com as subpastas.
2. Espere um vídeo com mais de 7 dias aparecer no Drive. Confira em `drive_files` o status `uploaded`.
3. Ligue o apagamento:

   ```sql
   update public.app_settings set value = '{"purge": true}' where key = 'google_drive_archive';
   ```

4. Quando um arquivo ficar `purged`, abra esse vídeo no app, clique em **Trazer de volta** e confira se toca.
5. **Desconecte, reconecte a mesma conta e repita o passo 4.** Com arquivo só no Drive, Desconectar não revoga no Google, porque a documentação não diz se `drive.file` mantém o acesso depois de revogar. Por isso, não remova o app em myaccount.google.com enquanto houver arquivo só no Drive sem antes testar esse caso numa conta de teste.

## O que fica e o que vai

| Bucket | Decisão | Por quê |
|---|---|---|
| `renders` | Vai: vídeo e áudio a partir de 1 MB, imagem a partir de 5 MB | É o que mais ocupa |
| `renders`: `director/assets/`, `thumbs/`, arquivos de trabalho, pequenos | Fica | Toda geração ou lista lê |
| `context-files` | Vai a partir de 5 MB | O texto segue nos chunks do banco |
| `brand-assets`: logo, fontes, `avatars/`, `voices/` | Fica | Entram em quase toda geração, ocupam pouco e vão a provedores por link longo |

Avatares, vozes e thumbs não são buckets próprios: moram em `brand-assets` e `renders`.

Sai do storage só com **mais de 7 dias sem uso**, tamanho e md5 iguais aos do Drive, fora de job ou edição ativa e sem publicação agendada. Qualquer dúvida ou falha mantém o arquivo.

## Verificação do Google

- `drive.file` é escopo **não sensível** e é o recomendado pelo Google para a maioria dos apps ([escopos do Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
- Com apenas escopos não sensíveis, a verificação do app **não é obrigatória** ([central de verificação](https://support.google.com/cloud/answer/13463073?hl=en)).
- Para mostrar **nome e logo** na tela de consentimento, é preciso a verificação de marca, que é mais leve. Ela pede ([requisitos](https://support.google.com/cloud/answer/13464321?hl=en)):
  - página inicial em domínio próprio e verificado, que descreva o produto e não seja só login, com link para a política de privacidade;
  - política de privacidade no mesmo domínio, com o mesmo link na tela de consentimento;
  - todos os domínios autorizados verificados no Google Search Console por dono ou editor do projeto;
  - contatos do projeto atualizados.
- **Atenção:** a URI acima está em `supabase.co`, que não é nosso, então ela não passa nessa regra de domínio próprio. Para ter a verificação de marca, será preciso um domínio próprio na URI (Custom Domain do Supabase). Sem isso a conexão funciona, mas sem nome e logo verificados.
- Cada conta tem limite de 100 refresh tokens por cliente OAuth; passou disso, o mais antigo cai sem aviso ([OAuth](https://developers.google.com/identity/protocols/oauth2)). Revogar remove todos os escopos do projeto para aquela conta ([OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server)).

## Quando algo falha

| Sintoma | Causa | Saída |
|---|---|---|
| Erro `redirect_uri_mismatch` no Google | URI diferente | Copie do modal, sem barra no fim |
| Conectar responde 401 | `verify_jwt` ligado | Publique `google-drive` com `verify_jwt = false` |
| Modal diz que a varredura não enxerga os arquivos | Papel sem leitura em `storage.objects` | Rode a consulta 2 acima |
| Conexão cai depois de 7 dias | App em "Teste" | Publique o app e reconecte |
| Geração pede o Drive de novo | Token revogado ou vencido | Reconecte; a geração continua de onde estava |
| "Este arquivo está em outra conta" | Conectou outra conta | Reconecte a conta indicada |
| "Não está mais no seu Google Drive" | A pessoa apagou | Restaure da lixeira do Drive; sem isso, não há como recuperar |
