-- PREVIEW - NAO APLICAR SEM AUTORIZACAO
-- Protecao atomica do ultimo administrador ativo.
-- new_ativo = NULL significa "preservar o valor atual".
-- new_perfil = NULL significa "preservar o perfil atual".

CREATE OR REPLACE FUNCTION public.guard_admin_update(
  target_id uuid,
  new_ativo boolean,
  new_perfil text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_perfil text;
  current_ativo boolean;
  effective_ativo boolean;
  effective_perfil text;
  admins_ativos integer;
BEGIN
  -- Lock serializador de transacao: TODAS as operacoes que podem
  -- reduzir administradores ativos passam exatamente por esta chave.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('guard_last_active_admin')::bigint
  );

  SELECT p.perfil, p.ativo
    INTO current_perfil, current_ativo
    FROM public.profiles p
   WHERE p.id = target_id
   FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Validacao explicita de dominio: somente os dois perfis conhecidos.
  IF new_perfil IS NOT NULL
     AND new_perfil NOT IN ('administrador', 'usuario') THEN
    RAISE EXCEPTION 'INVALID_PERFIL' USING ERRCODE = 'P0003';
  END IF;

  -- NULL em new_ativo significa "nao alterar ativo" (preserva o valor atual).
  effective_ativo := coalesce(new_ativo, current_ativo);
  effective_perfil := coalesce(new_perfil, current_perfil);

  -- A operacao e "redutora" somente se o alvo e admin ATIVO hoje
  -- e deixaria de ser admin ativo apos a operacao.
  IF current_ativo
     AND current_perfil = 'administrador'
     AND (effective_ativo = false OR effective_perfil <> 'administrador') THEN

    SELECT count(*)
      INTO admins_ativos
      FROM public.profiles p2
     WHERE p2.perfil = 'administrador'
       AND p2.ativo = true;

    IF admins_ativos <= 1 THEN
      RAISE EXCEPTION 'LAST_ACTIVE_ADMIN' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- So grava ativo se foi informado (nao NULL).
  IF new_ativo IS NOT NULL THEN
    UPDATE public.profiles p3
       SET ativo = new_ativo
     WHERE p3.id = target_id;
  END IF;

  IF new_perfil IS NOT NULL THEN
    UPDATE public.profiles p4
       SET perfil = new_perfil
     WHERE p4.id = target_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_admin_update(uuid, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.guard_admin_update(uuid, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.guard_admin_update(uuid, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.guard_admin_update(uuid, boolean, text) TO service_role;
