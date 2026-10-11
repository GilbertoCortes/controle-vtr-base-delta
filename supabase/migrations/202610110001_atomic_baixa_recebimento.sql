BEGIN;

-- ============================================================
-- BAIXA ATÔMICA
-- A baixa só passa a existir se registro + fotos + status
-- forem concluídos dentro da mesma transação do PostgreSQL.
-- ============================================================

CREATE OR REPLACE FUNCTION public.concluir_baixa_vtr(
  target_id uuid,
  actor_id uuid,
  novo_registro_id uuid,
  km_atual integer,
  combustivel_valor text,
  oleo_valor text,
  arrefecimento_valor text,
  dados jsonb,
  motivo text,
  caminhos_fotos text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  situacao_atual text;
  km_anterior integer;
  atividade integer;
  caminho text;
BEGIN
  IF auth.uid() IS NULL
     OR actor_id IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = actor_id
         AND ativo
     )
  THEN
    RAISE EXCEPTION 'ACTIVE_USER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT situacao, quilometragem
  INTO situacao_atual, km_anterior
  FROM public.viaturas
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VTR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF lower(coalesce(situacao_atual, '')) <> 'ativa' THEN
    RAISE EXCEPTION 'VTR_NOT_ACTIVE'
      USING ERRCODE = '55000';
  END IF;

  IF km_atual IS NULL OR km_atual < 0 THEN
    RAISE EXCEPTION 'INVALID_KM'
      USING ERRCODE = '23514';
  END IF;

  IF km_anterior IS NOT NULL AND km_atual < km_anterior THEN
    RAISE EXCEPTION 'KM_REGRESSION'
      USING ERRCODE = '23514';
  END IF;

  IF novo_registro_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_REGISTER_ID'
      USING ERRCODE = '23514';
  END IF;

  -- Garante que nenhuma foto apontará para outra VTR/operação.
  FOREACH caminho IN ARRAY coalesce(caminhos_fotos, ARRAY[]::text[])
  LOOP
    IF caminho IS NULL
       OR split_part(caminho, '/', 1) <> target_id::text
       OR split_part(caminho, '/', 2) <> novo_registro_id::text
    THEN
      RAISE EXCEPTION 'INVALID_PHOTO_PATH'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.registros_vtr (
    id,
    viatura_id,
    tipo_registro,
    km,
    combustivel,
    oleo_motor,
    liquido_arrefecimento,
    checklist,
    usuario_id
  )
  VALUES (
    novo_registro_id,
    target_id,
    'baixa',
    km_atual,
    combustivel_valor,
    oleo_valor,
    arrefecimento_valor,
    dados,
    actor_id
  );

  INSERT INTO public.fotos_registro_vtr (
    registro_id,
    caminho_storage
  )
  SELECT novo_registro_id, foto.caminho_storage
  FROM unnest(coalesce(caminhos_fotos, ARRAY[]::text[]))
    AS foto(caminho_storage);

  UPDATE public.viaturas
  SET
    situacao = 'baixada',
    quilometragem = km_atual,
    motivo_situacao = motivo,
    atualizado_em = now()
  WHERE id = target_id;

  SELECT atividade_numero
  INTO atividade
  FROM public.registros_vtr
  WHERE id = novo_registro_id;

  RETURN atividade;
END;
$$;


-- ============================================================
-- RECEBIMENTO ATÔMICO
-- O recebimento só existe se registro + fotos + status ativa
-- forem concluídos na mesma transação.
-- ============================================================

CREATE OR REPLACE FUNCTION public.concluir_recebimento_vtr(
  target_id uuid,
  actor_id uuid,
  novo_registro_id uuid,
  km_atual integer,
  combustivel_valor text,
  oleo_valor text,
  arrefecimento_valor text,
  dados jsonb,
  reparos boolean,
  descricao_reparos_valor text,
  empresa_valor text,
  responsavel_valor text,
  cpf_valor text,
  caminhos_fotos text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  situacao_atual text;
  km_anterior integer;
  atividade integer;
  caminho text;
BEGIN
  IF auth.uid() IS NULL
     OR actor_id IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = actor_id
         AND ativo
     )
  THEN
    RAISE EXCEPTION 'ACTIVE_USER_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT situacao, quilometragem
  INTO situacao_atual, km_anterior
  FROM public.viaturas
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VTR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF lower(coalesce(situacao_atual, '')) <> 'baixada' THEN
    RAISE EXCEPTION 'VTR_NOT_DOWN'
      USING ERRCODE = '55000';
  END IF;

  IF km_atual IS NULL OR km_atual < 0 THEN
    RAISE EXCEPTION 'INVALID_KM'
      USING ERRCODE = '23514';
  END IF;

  IF km_anterior IS NOT NULL AND km_atual < km_anterior THEN
    RAISE EXCEPTION 'KM_REGRESSION'
      USING ERRCODE = '23514';
  END IF;

  IF novo_registro_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_REGISTER_ID'
      USING ERRCODE = '23514';
  END IF;

  FOREACH caminho IN ARRAY coalesce(caminhos_fotos, ARRAY[]::text[])
  LOOP
    IF caminho IS NULL
       OR split_part(caminho, '/', 1) <> target_id::text
       OR split_part(caminho, '/', 2) <> novo_registro_id::text
    THEN
      RAISE EXCEPTION 'INVALID_PHOTO_PATH'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.registros_vtr (
    id,
    viatura_id,
    tipo_registro,
    km,
    combustivel,
    oleo_motor,
    liquido_arrefecimento,
    checklist,
    reparos_realizados,
    descricao_reparos,
    empresa,
    responsavel_entrega,
    cpf_responsavel_entrega,
    usuario_id
  )
  VALUES (
    novo_registro_id,
    target_id,
    'recebimento',
    km_atual,
    combustivel_valor,
    oleo_valor,
    arrefecimento_valor,
    dados,
    reparos,
    nullif(descricao_reparos_valor, ''),
    empresa_valor,
    responsavel_valor,
    cpf_valor,
    actor_id
  );

  INSERT INTO public.fotos_registro_vtr (
    registro_id,
    caminho_storage
  )
  SELECT novo_registro_id, foto.caminho_storage
  FROM unnest(coalesce(caminhos_fotos, ARRAY[]::text[]))
    AS foto(caminho_storage);

  UPDATE public.viaturas
  SET
    situacao = 'ativa',
    quilometragem = km_atual,
    motivo_situacao = NULL,
    atualizado_em = now()
  WHERE id = target_id;

  SELECT atividade_numero
  INTO atividade
  FROM public.registros_vtr
  WHERE id = novo_registro_id;

  RETURN atividade;
END;
$$;


REVOKE ALL ON FUNCTION public.concluir_baixa_vtr(
  uuid, uuid, uuid, integer, text, text, text, jsonb, text, text[]
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.concluir_recebimento_vtr(
  uuid, uuid, uuid, integer, text, text, text, jsonb,
  boolean, text, text, text, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.concluir_baixa_vtr(
  uuid, uuid, uuid, integer, text, text, text, jsonb, text, text[]
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.concluir_recebimento_vtr(
  uuid, uuid, uuid, integer, text, text, text, jsonb,
  boolean, text, text, text, text, text[]
) TO authenticated;

COMMIT;
