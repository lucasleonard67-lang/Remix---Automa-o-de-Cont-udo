// _shared/prompts/compile.ts — compiladores de recheio → texto de prompt.
// Fonte: docs/06-arquitetura-ia.md §1.2 (envelope de altitude) e §7 (caching).
//
// Funções PURAS e DETERMINÍSTICAS: mesma versão de persona/guardrails/strategy
// ⇒ mesmo texto, byte a byte (ordem fixa de seções, sem timestamps, sem UUIDs).
// compilePersona e compileGuardrails entram no PREFIXO ESTÁVEL cacheável dos
// prompts do Gerador e do Juiz; compileStrategy é insumo do Roteador (único
// papel de geração que lê brand_strategy inteira).

import type { GuardrailsContent, PersonaContent, StrategyContent } from '../types.ts';

function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function bulleted(items: readonly string[]): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- (nenhum)';
}

// ── Persona (voz) ────────────────────────────────────────────────────────────

/**
 * Compila a versão ativa de brand_persona.content (contrato de voz, 9 seções)
 * em texto de prompt. Ordem das seções é FIXA (1-9) — parte do prefixo cacheável.
 */
export function compilePersona(persona: PersonaContent): string {
  const parts: string[] = ['# CONTRATO DE VOZ'];

  parts.push(section(
    '1. Identidade (quem fala)',
    [
      `Nome: ${persona.identity.name}`,
      `Papel: ${persona.identity.role}`,
      `Posicionamento: ${persona.identity.positioning}`,
      `Para quem fala: ${persona.identity.audience}`,
    ].join('\n'),
  ));

  parts.push(section(
    '2. Credenciais (toda credencial tem fonte — nunca invente autoridade)',
    bulleted(persona.credenciais.map((c) => `${c.claim} (fonte: ${c.source})`)),
  ));

  parts.push(section(
    '3. Visão de mundo e teses',
    `${persona.worldview.summary}\nTeses que a voz defende:\n${bulleted(persona.worldview.theses)}`,
  ));

  parts.push(section('4. Princípios de tom', bulleted(persona.tone_principles)));

  parts.push(section(
    '5. Léxico assinatura (DOSAGEM OBRIGATÓRIA — no máximo 1-2 termos por peça)',
    bulleted(persona.signature_lexicon.map(
      (l) => `"${l.term}" — ${l.usage} (máx ${l.max_per_piece} por peça)`,
    )),
  ));

  parts.push(section('6. Heurísticas de calibração', bulleted(persona.calibration_heuristics)));

  parts.push(section(
    '7. Opiniões explícitas (combustível da análise proprietária)',
    bulleted(persona.opinioes.map((o) => `${o.topic}: ${o.stance}`)),
  ));

  parts.push(section('8. Checklist de voz (a peça deve passar em TODOS)', bulleted(persona.voice_checklist)));

  const good = persona.reference_examples.good
    .map((e) => `- BOM: "${e.text}" → ${e.why}`)
    .join('\n');
  const bad = persona.reference_examples.bad
    .map((e) => `- RUIM: "${e.text}" → ${e.why}`)
    .join('\n');
  parts.push(section(
    '9. Exemplos calibradores',
    [good, bad].filter((s) => s.length > 0).join('\n') || '- (nenhum)',
  ));

  parts.push(
    'A ban list NÃO está aqui: a fonte única de proibições é a seção GUARDRAILS abaixo.',
  );

  return parts.join('\n\n');
}

// ── Guardrails (regras duras) ────────────────────────────────────────────────

/**
 * Compila a versão ativa de guardrails.content em texto de regras para prompt.
 * Fonte ÚNICA de proibições (persona referencia, nunca duplica). Inclui os
 * channel_scope_overrides serializados em ordem fixa — a versão ativa é estável,
 * então o bloco inteiro permanece cacheável.
 */
export function compileGuardrails(guardrails: GuardrailsContent): string {
  const parts: string[] = ['# GUARDRAILS (regras duras — violar qualquer uma REPROVA a peça)'];

  parts.push(section('Pontuação banida (nunca usar)', bulleted(guardrails.banned_punctuation)));
  parts.push(section('Palavras banidas (nunca usar, em nenhuma flexão)', bulleted(guardrails.banned_words)));
  parts.push(section('Metáforas banidas', bulleted(guardrails.banned_metaphors)));
  parts.push(section('CTAs proibidos', bulleted(guardrails.banned_ctas)));
  parts.push(section('CTAs permitidos (o CTA da peça DEVE sair desta lista)', bulleted(guardrails.allowed_ctas)));

  const overrideKeys = Object.keys(guardrails.channel_scope_overrides).sort();
  if (overrideKeys.length > 0) {
    const lines: string[] = [];
    for (const key of overrideKeys) {
      const ov = guardrails.channel_scope_overrides[key as keyof typeof guardrails.channel_scope_overrides];
      if (!ov) continue;
      if (ov.banned_words?.length) {
        lines.push(`${key}: palavras banidas adicionais: ${ov.banned_words.join(', ')}`);
      }
      if (ov.allowed_ctas?.length) {
        lines.push(`${key}: CTAs permitidos adicionais: ${ov.allowed_ctas.join(', ')}`);
      }
    }
    if (lines.length > 0) {
      parts.push(section('Regras adicionais por canal (aditivas)', bulleted(lines)));
    }
  }

  const dosage: string[] = [
    `Termos do léxico assinatura: no máximo ${guardrails.dosage_rules.signature_lexicon_max_per_piece} por peça.`,
    `Emojis no corpo: no máximo ${guardrails.dosage_rules.emoji_max ?? 0}.`,
    guardrails.dosage_rules.hashtag_policy === 'metadata_only'
      ? 'Hashtags: proibidas no corpo do texto; permitidas apenas em campo de metadado do canal.'
      : 'Hashtags: proibidas.',
  ];
  parts.push(section('Dosagem', bulleted(dosage)));

  parts.push(section(
    'Regras duras de grounding',
    bulleted([
      'Nunca inventar número, case ou citação; fonte obrigatória para todo dado.',
      'Nunca alterar ou arredondar número sem base declarada na fonte.',
      'Exatamente 1 prova central por peça, vinda do contexto selecionado.',
      'Dado faltante vira a marcação [VERIFICAR: descreva o dado] no texto — nunca um chute.',
      'Proibida a antítese "não é X, é Y" e variações — construa a ideia de forma direta.',
    ]),
  ));

  return parts.join('\n\n');
}

// ── Strategy (bandeira → briefing de teses) ──────────────────────────────────

/**
 * Compila brand_strategy.content num briefing de teses para o Roteador.
 * O Gerador NUNCA vê este texto — recebe a tese destilada no briefing
 * (classification.thesis), regra de altitude do 06 §1.2.
 */
export function compileStrategy(strategy: StrategyContent): string {
  const parts: string[] = ['# ESTRATÉGIA DA MARCA (bandeira)'];

  parts.push(section('Promessa central', strategy.brand_promise));
  parts.push(section('Teses que o conteúdo defende', bulleted(strategy.theses)));
  parts.push(section('Inimigo narrativo (status quo combatido)', strategy.enemy));
  parts.push(section('Territórios seguros de assunto', bulleted(strategy.safe_list)));
  parts.push(section(
    'ICP (cliente ideal)',
    `Perfil: ${strategy.icp.perfil}\nDesejos:\n${bulleted(strategy.icp.desejos)}`,
  ));
  parts.push(section('Postura editorial', strategy.editorial_stance));

  const mixKeys = Object.keys(strategy.content_mix).sort();
  if (mixKeys.length > 0) {
    parts.push(section(
      'Mix de conteúdo (proporção alvo)',
      bulleted(mixKeys.map((k) => `${k}: ${strategy.content_mix[k]}`)),
    ));
  }

  parts.push(section('Repertório de CTAs da marca', bulleted(strategy.cta_repertoire)));

  return parts.join('\n\n');
}
