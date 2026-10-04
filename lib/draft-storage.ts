"use client";

import { createClient } from "@/lib/supabase/client";

// Prefixo de todo rascunho funcional do app. Chaves fora deste padrao
// (ex.: navegacao) nunca sao tocadas pelo sistema de rascunhos.
const DRAFT_PREFIX = "controle-vtr:user:";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

type Envelope<T> = {
  v: 1;
  ts: number;
  data: T;
};

let cachedUserId: string | null | undefined;

// Retorna o UUID do usuario autenticado, ou null se nao houver sessao.
export async function getDraftUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    cachedUserId = data.user?.id ?? null;
  } catch {
    cachedUserId = null;
  }
  return cachedUserId;
}

// Invalida o cache ao trocar de sessao (login/logout).
export function resetDraftUserCache() {
  cachedUserId = undefined;
}

function keyFor(userId: string, scope: string) {
  return `${DRAFT_PREFIX}${userId}:${scope}`;
}

// Grava rascunho com timestamp, isolado por usuario.
export function saveDraft<T>(userId: string, scope: string, data: T): boolean {
  if (!userId) return false;
  try {
    const envelope: Envelope<T> = { v: 1, ts: Date.now(), data };
    sessionStorage.setItem(keyFor(userId, scope), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

// Le rascunho somente se pertencer ao usuario, estiver integro e dentro do TTL.
// Rascunho expirado ou corrompido e removido e NAO restaurado.
export function loadDraft<T>(userId: string, scope: string): T | null {
  if (!userId) return null;
  const key = keyFor(userId, scope);
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(raw) as Envelope<T>;
  } catch {
    removeDraft(userId, scope); // JSON corrompido
    return null;
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.v !== 1 ||
    typeof envelope.ts !== "number" ||
    !("data" in envelope)
  ) {
    removeDraft(userId, scope); // formato invalido
    return null;
  }
  if (Date.now() - envelope.ts > DRAFT_TTL_MS) {
    removeDraft(userId, scope); // expirado
    return null;
  }
  return envelope.data;
}

export function removeDraft(userId: string, scope: string) {
  if (!userId) return;
  try {
    sessionStorage.removeItem(keyFor(userId, scope));
  } catch {
    /* noop */
  }
}

// Remove TODOS os rascunhos funcionais de um usuario (somente o prefixo do app).
// Nao toca em outras chaves do sessionStorage.
export function clearDraftsForUser(userId: string) {
  if (!userId) return;
  const prefix = keyFor(userId, "");
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
