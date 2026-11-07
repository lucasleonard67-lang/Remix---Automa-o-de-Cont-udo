// automation-tick — motor automático de conteúdo (ponto 7 do plano docs/14).
//
// Deploy config: verify_jwt = false (público; autentica x-cron-secret OU JWT
// admin — mesmo desenho do director-advance).
//
// Chamado de hora em hora por pg_cron. Para cada gatilho habilitado, verifica
// quantas peças já foram geradas HOJE por ele e, se estiver abaixo da cota,
// dispara UMA geração.
//
// DECISÃO DE PRODUTO: gera e ENFILEIRA. Nada é aprovado nem publicado sozinho —
// a peça cai na Biblioteca em "Em revisão" como qualquer outra.
//
// Uma geração por tick por gatilho, de propósito: a saga é cara e demorada, e
// espalhar ao longo do dia é melhor do que despejar a cota inteira às 7h.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createServiceClient, getUser } from "../_shared/supabase.ts";
import { runSaga } from "../_shared/saga.ts";
import { driveRequired } from "../_shared/drive-gate.ts";
import type { ChannelType } from "../_shared/types.ts";
import { segredoIgual } from "../_shared/segredo-igual.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Service = ReturnType<typeof createServiceClient>;

/** Famílias → tipos concretos. Espelha src/hooks/use-channels.ts (ponto 10). */
const CHANNELS_BY_FAMILY: Record<string, ChannelType[]> = {
  video_curto_vertical: ["instagram_reel"],
  story: ["instagram_stories"],
  carrossel: ["instagram_carousel"],
  post_imagem: ["instagram_post"],
  post_texto: ["x_post", "threads_post", "linkedin_post", "facebook_post"],
};

interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  account_id: string | null;
  family: string;
  per_day: number;
  source: "radar" | "acervo" | "tema";
  theme: string | null;
  created_by: string | null;
}

/** Quantas vezes este gatilho já gerou hoje (a verdade vive no log de runs). */
async function geradasHoje(service: Service, triggerId: string): Promise<number> {
  const inicioDoDia = new Date();
  inicioDoDia.setUTCHours(0, 0, 0, 0);
  const { count } = await service
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    .eq("trigger_id", triggerId)
    // 'started' conta: uma saga em voo já consumiu a vaga do dia. Contar só
    // 'ok' deixaria o próximo tick disparar de novo enquanto a primeira roda.
    .in("status", ["started", "ok"])
    .gte("created_at", inicioDoDia.toISOString());
  return count ?? 0;
}

/**
 * Pauta do disparo. 'radar' pega a notícia nova mais recente; 'acervo' pega um
 * case do contexto; 'tema' usa o texto fixo do gatilho.
 */
async function montarBriefing(
  service: Service,
  trigger: Trigger,
): Promise<{ prompt: string; rssItemId?: string } | null> {
  if (trigger.source === "tema") {
    const tema = trigger.theme?.trim();
    return tema ? { prompt: tema } : null;
  }

  if (trigger.source === "radar") {
    const { data } = await service
      .from("rss_items")
      .select("id, title, description, link")
      .is("used_in_job_id", null)
      .is("dismissed_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const item = data?.[0] as
      { id: string; title: string; description?: string | null; link: string } | undefined;
    if (!item) return null;
    return {
      rssItemId: item.id,
      prompt:
        `Notícia: ${item.title}\n\n` +
        (item.description ? `Resumo: ${item.description}\n\n` : "") +
        `Fonte: ${item.link}\n\n` +
        "Escreva uma peça conectando esta notícia ao que a marca defende, com um caso concreto do acervo.",
    };
  }

  // 'acervo': deixa o Roteador escolher a prova, pedindo caso concreto com número.
  return {
    prompt:
      "Escreva uma peça sobre um problema real que a marca resolve, usando um caso " +
      "concreto do acervo com número, e termine com um convite para conversar.",
  };
}

async function dispararGatilho(service: Service, trigger: Trigger): Promise<void> {
  const feitas = await geradasHoje(service, trigger.id);
  if (feitas >= trigger.per_day) return;

  const canais = CHANNELS_BY_FAMILY[trigger.family] ?? [];
  const briefing = await montarBriefing(service, trigger);
  if (!briefing) {
    await service.from("automation_runs").insert({
      trigger_id: trigger.id,
      status: "skipped",
      detail:
        trigger.source === "radar"
          ? "Nenhuma notícia nova no radar."
          : "Gatilho sem tema definido.",
    });
    return;
  }

  const { data: job, error } = await service
    .from("generation_jobs")
    .insert({
      prompt: briefing.prompt,
      status: "created",
      created_by: trigger.created_by,
    })
    .select("id")
    .maybeSingle();

  if (error || !job) {
    await service.from("automation_runs").insert({
      trigger_id: trigger.id,
      status: "error",
      detail: `Não foi possível criar o job: ${error?.message ?? "sem id"}`,
    });
    return;
  }

  // A run nasce 'started' e só vira 'ok' quando a saga CHEGA à fila de revisão.
  // Marcar 'ok' no insert do job contava como entregue algo que ainda podia
  // falhar — e, pior, queimava a cota do dia por uma peça que nunca existiu.
  const { data: run } = await service
    .from("automation_runs")
    .insert({
      trigger_id: trigger.id,
      job_id: job.id,
      status: "started",
      detail: `Gatilho "${trigger.name}" — ${trigger.family}`,
    })
    .select("id")
    .maybeSingle();
  const runId = (run as { id: string } | null)?.id ?? null;

  await service
    .from("automation_triggers")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", trigger.id);

  // Vincula a notícia ao job, como faz a criação manual vinda do Radar.
  if (briefing.rssItemId) {
    await service.from("rss_items").update({ used_in_job_id: job.id }).eq("id", briefing.rssItemId);
  }

  // Os canais da família vão por PARÂMETRO — não há coluna para eles no job;
  // é assim que a criação manual também restringe o alvo.
  const saga = runSaga(job.id, {
    from: "classifying",
    ...(canais.length > 0 ? { requested_channel_types: canais } : {}),
  })
    .then(async (status) => {
      // O motor é AUTÔNOMO: um job parado em awaiting_angle nunca chega à fila,
      // e ninguém está olhando para escolher. Escolhe o primeiro ângulo, que é
      // o mesmo default da criação manual quando o roteador não pede escolha.
      if (status === "awaiting_angle") {
        const { data: atual } = await service
          .from("generation_jobs")
          .select("classification")
          .eq("id", job.id)
          .maybeSingle();
        const angulos = (atual?.classification as { angles?: unknown[] } | null)?.angles;
        const primeiro = Array.isArray(angulos) ? angulos[0] : null;
        if (primeiro) {
          // Mesmo caminho do resume-job: grava o ângulo no job e retoma em
          // retrieving (o ângulo mora na linha, não nas opções da saga).
          await service
            .from("generation_jobs")
            .update({ selected_angle: primeiro })
            .eq("id", job.id);
          return await runSaga(job.id, { from: "retrieving" });
        }
      }
      return status;
    })
    .then(async (status) => {
      const ok = status === "awaiting_review" || status === "done";
      if (runId) {
        await service
          .from("automation_runs")
          .update({
            status: ok ? "ok" : "error",
            detail: ok
              ? `Gatilho "${trigger.name}" — peça na fila de revisão`
              : `Gatilho "${trigger.name}" — a geração terminou em "${status}"`,
          })
          .eq("id", runId);
      }
    })
    .catch(async (err) => {
      console.error(`[automation] saga do job ${job.id} falhou:`, err);
      if (runId) {
        await service
          .from("automation_runs")
          .update({
            status: "error",
            detail: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          })
          .eq("id", runId);
      }
    });

  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(saga);
  else await saga;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const service = createServiceClient();

  // Autenticação igual à do Diretor: segredo do cron OU admin logado (para
  // "rodar agora" pela interface).
  let autorizado = false;
  const segredo = req.headers.get("x-cron-secret");
  if (segredo) {
    const { data } = await service.rpc("get_vault_secret", { _name: "VIDEO_CRON_SECRET" });
    autorizado = segredoIgual(segredo, data);
  }
  if (!autorizado) {
    const user = await getUser(req);
    if (user) {
      const { data: isAdmin } = await service.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      autorizado = Boolean(isAdmin);
    }
  }
  if (!autorizado) return errorResponse(401, "unauthorized", "x-cron-secret ou JWT de admin.");

  try {
    const { data, error } = await service
      .from("automation_triggers")
      .select("*")
      .eq("enabled", true);
    if (error) throw new Error(error.message);

    const gatilhos = (data ?? []) as Trigger[];
    // geração automática também exige o Drive: fica o registro, sem erro
    if (await driveRequired(service)) {
      for (const gatilho of gatilhos) {
        // cota do dia já cumprida: não havia o que gerar, então não há o que registrar
        if ((await geradasHoje(service, gatilho.id)) >= gatilho.per_day) continue;
        await service.from("automation_runs").insert({
          trigger_id: gatilho.id,
          status: "skipped",
          detail: "Conecte o Google Drive para gerar.",
        });
      }
      return jsonResponse({ triggers: gatilhos.length, skipped: "drive_required" });
    }
    for (const gatilho of gatilhos) {
      await dispararGatilho(service, gatilho).catch(async (err) => {
        console.error(`[automation] gatilho ${gatilho.id} falhou:`, err);
        await service.from("automation_runs").insert({
          trigger_id: gatilho.id,
          status: "error",
          detail: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        });
      });
    }
    return jsonResponse({ triggers: gatilhos.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, "internal", message);
  }
});
