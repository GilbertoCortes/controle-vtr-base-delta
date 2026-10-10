BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.exclusoes_vtr) THEN
    RAISE EXCEPTION 'Conclua as exclusoes pendentes antes de instalar o fluxo de vistoria e PDF final.';
  END IF;
END;
$$;

ALTER TABLE public.fotos_registro_vtr ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE public.fotos_registro_vtr ADD CONSTRAINT fotos_categoria_check
  CHECK (categoria IS NULL OR categoria IN ('frente','lateral_direita','lateral_esquerda','traseira','painel','equipamentos','avarias'));
CREATE UNIQUE INDEX fotos_categoria_unica_por_registro ON public.fotos_registro_vtr(registro_id, categoria)
  WHERE categoria IS NOT NULL AND categoria <> 'avarias';
ALTER TABLE public.registros_vtr DROP CONSTRAINT registros_vtr_tipo_registro_check;
ALTER TABLE public.registros_vtr ADD CONSTRAINT registros_vtr_tipo_registro_check
  CHECK (tipo_registro IN ('checkin_inicial','baixa','recebimento','vistoria_final'));

CREATE TABLE public.retiradas_vtr (
  viatura_id uuid PRIMARY KEY REFERENCES public.viaturas(id) ON DELETE CASCADE,
  registro_id uuid NOT NULL UNIQUE REFERENCES public.registros_vtr(id) ON DELETE CASCADE,
  administrador_id uuid NOT NULL REFERENCES auth.users(id),
  fase text NOT NULL DEFAULT 'fotos' CHECK (fase IN ('fotos','pronta','selada','autorizada')),
  recibo_hash text,
  pdf_hash text,
  pdf_bytes bigint,
  criado_em timestamptz NOT NULL DEFAULT now(),
  relatorio_em timestamptz,
  CHECK ((recibo_hash IS NULL AND pdf_hash IS NULL AND pdf_bytes IS NULL) OR
    (recibo_hash IS NOT NULL AND pdf_hash IS NOT NULL AND pdf_bytes > 0))
);
ALTER TABLE public.retiradas_vtr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retiradas_vtr FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retiradas_vtr TO service_role;

CREATE FUNCTION public.iniciar_vistoria_final(target_id uuid, actor_id uuid, dados jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  novo_id uuid;
  km_atual integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND ativo AND perfil = 'administrador'
  ) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501'; END IF;
  SELECT quilometragem INTO km_atual FROM public.viaturas WHERE id = target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VTR_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.retiradas_vtr WHERE viatura_id = target_id) THEN
    RAISE EXCEPTION 'WITHDRAWAL_ALREADY_STARTED' USING ERRCODE = '55000';
  END IF;
  IF (dados->>'km_atual')::integer < coalesce(km_atual, 0) THEN
    RAISE EXCEPTION 'KM_REGRESSION' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.registros_vtr
    (viatura_id, tipo_registro, km, combustivel, oleo_motor, liquido_arrefecimento, checklist, usuario_id)
    VALUES (target_id, 'vistoria_final', (dados->>'km_atual')::integer,
      lower(dados->>'combustivel'), lower(dados->>'oleo_motor'), lower(dados->>'liquido_arrefecimento'), dados, actor_id)
    RETURNING id INTO novo_id;
  INSERT INTO public.retiradas_vtr(viatura_id, registro_id, administrador_id) VALUES (target_id, novo_id, actor_id);
  RETURN novo_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_gravacao_vtr_em_exclusao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  parent_id uuid;
  old_parent_id uuid;
  retirada public.retiradas_vtr%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'viaturas' THEN parent_id := OLD.id;
  ELSIF TG_TABLE_NAME = 'registros_vtr' THEN
    IF NEW.tipo_registro = 'vistoria_final' AND (auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = NEW.usuario_id AND ativo AND perfil = 'administrador'
    )) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501'; END IF;
    parent_id := NEW.viatura_id;
    IF TG_OP = 'UPDATE' THEN old_parent_id := OLD.viatura_id; END IF;
  ELSE
    SELECT viatura_id INTO parent_id FROM public.registros_vtr WHERE id = NEW.registro_id;
    IF TG_OP = 'UPDATE' THEN
      SELECT viatura_id INTO old_parent_id FROM public.registros_vtr WHERE id = OLD.registro_id;
    END IF;
  END IF;
  IF old_parent_id IS NOT NULL AND old_parent_id IS DISTINCT FROM parent_id THEN
    PERFORM public.verificar_vtr_disponivel(old_parent_id);
    IF EXISTS (SELECT 1 FROM public.retiradas_vtr WHERE viatura_id = old_parent_id) THEN
      RAISE EXCEPTION 'WITHDRAWAL_IN_PROGRESS' USING ERRCODE = '55000';
    END IF;
  END IF;
  PERFORM public.verificar_vtr_disponivel(parent_id);
  SELECT * INTO retirada FROM public.retiradas_vtr WHERE viatura_id = parent_id;
  IF FOUND THEN
    IF TG_TABLE_NAME = 'fotos_registro_vtr' AND TG_OP = 'INSERT' THEN
      IF retirada.fase = 'fotos' AND NEW.registro_id = retirada.registro_id AND auth.role() = 'service_role' THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'WITHDRAWAL_IN_PROGRESS' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.proteger_snapshot_retirada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parent_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'registros_vtr' THEN parent_id := OLD.viatura_id;
  ELSE SELECT viatura_id INTO parent_id FROM public.registros_vtr WHERE id = OLD.registro_id; END IF;
  IF EXISTS (SELECT 1 FROM public.viaturas WHERE id = parent_id) THEN
    PERFORM 1 FROM public.viaturas WHERE id = parent_id FOR UPDATE;
    IF auth.role() = 'service_role' AND EXISTS (
      SELECT 1 FROM public.retiradas_vtr r
      JOIN public.exclusoes_vtr e ON e.viatura_id = r.viatura_id
      WHERE r.viatura_id = parent_id AND r.fase = 'autorizada'
        AND r.pdf_bytes > 0 AND r.pdf_hash IS NOT NULL AND r.recibo_hash IS NOT NULL
    ) THEN
      RETURN OLD;
    END IF;
    IF EXISTS (SELECT 1 FROM public.retiradas_vtr WHERE viatura_id = parent_id AND fase <> 'fotos') THEN
      RAISE EXCEPTION 'REPORT_SNAPSHOT_LOCKED' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER registros_preserva_relatorio BEFORE DELETE ON public.registros_vtr
  FOR EACH ROW EXECUTE FUNCTION public.proteger_snapshot_retirada();
CREATE TRIGGER fotos_preserva_relatorio BEFORE DELETE ON public.fotos_registro_vtr
  FOR EACH ROW EXECUTE FUNCTION public.proteger_snapshot_retirada();

CREATE FUNCTION public.concluir_fotos_vistoria(target_id uuid, final_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['frente','lateral_direita','lateral_esquerda','traseira','painel','equipamentos']) c
    WHERE (SELECT count(*) FROM public.fotos_registro_vtr WHERE registro_id = final_id AND categoria = c) <> 1
  ) THEN RAISE EXCEPTION 'REQUIRED_PHOTOS_MISSING' USING ERRCODE = '23514'; END IF;
  UPDATE public.retiradas_vtr SET fase = 'pronta'
    WHERE viatura_id = target_id AND registro_id = final_id AND fase IN ('fotos','pronta');
  IF NOT FOUND THEN RAISE EXCEPTION 'FINAL_INSPECTION_UNAVAILABLE' USING ERRCODE = '55000'; END IF;
END;
$$;

CREATE FUNCTION public.selar_vistoria_final(target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE final_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  SELECT registro_id INTO final_id FROM public.retiradas_vtr WHERE viatura_id = target_id AND fase IN ('pronta','selada');
  IF NOT FOUND THEN RAISE EXCEPTION 'FINAL_INSPECTION_REQUIRED' USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.registros_vtr WHERE id = final_id AND tipo_registro = 'vistoria_final'
      AND km >= 0 AND checklist->>'pintura' IN ('Boa','Ruim') AND checklist->>'lataria' IN ('Boa','Ruim')) THEN
    RAISE EXCEPTION 'FINAL_INSPECTION_INVALID' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['frente','lateral_direita','lateral_esquerda','traseira','painel','equipamentos']) c
    WHERE (SELECT count(*) FROM public.fotos_registro_vtr WHERE registro_id = final_id AND categoria = c) <> 1
  ) THEN RAISE EXCEPTION 'REQUIRED_PHOTOS_MISSING' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'fotos-vtr' AND split_part(o.name,'/',1) = target_id::text
    AND NOT EXISTS (SELECT 1 FROM public.fotos_registro_vtr f JOIN public.registros_vtr r ON r.id = f.registro_id
      WHERE r.viatura_id = target_id AND f.caminho_storage = o.name)
  ) THEN RAISE EXCEPTION 'UNTRACKED_UPLOAD_IN_PROGRESS' USING ERRCODE = '55000'; END IF;
  UPDATE public.retiradas_vtr SET fase = 'selada' WHERE viatura_id = target_id AND fase = 'pronta';
END;
$$;

CREATE FUNCTION public.cancelar_vistoria_incompleta(target_id uuid, final_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  DELETE FROM public.retiradas_vtr WHERE viatura_id = target_id AND registro_id = final_id AND fase = 'fotos';
  IF FOUND THEN DELETE FROM public.registros_vtr WHERE id = final_id AND viatura_id = target_id; END IF;
END;
$$;

CREATE FUNCTION public.autorizar_exclusao_relatorio(target_id uuid, actor_id uuid, receipt_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND ativo AND perfil = 'administrador'
  ) THEN RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  UPDATE public.retiradas_vtr SET fase = 'autorizada'
    WHERE viatura_id = target_id AND administrador_id = actor_id AND recibo_hash = receipt_hash
      AND pdf_bytes > 0 AND pdf_hash IS NOT NULL AND fase IN ('selada','autorizada');
  IF NOT FOUND THEN RAISE EXCEPTION 'REPORT_RECEIPT_REQUIRED' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE FUNCTION public.exigir_relatorio_antes_exclusao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.retiradas_vtr WHERE viatura_id = NEW.viatura_id
      AND fase = 'autorizada' AND pdf_bytes > 0 AND recibo_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'REPORT_RECEIPT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER exclusoes_exige_relatorio BEFORE INSERT OR UPDATE ON public.exclusoes_vtr
  FOR EACH ROW EXECUTE FUNCTION public.exigir_relatorio_antes_exclusao();

REVOKE ALL ON FUNCTION public.iniciar_vistoria_final(uuid,uuid,jsonb), public.selar_vistoria_final(uuid),
  public.concluir_fotos_vistoria(uuid,uuid),
  public.cancelar_vistoria_incompleta(uuid,uuid), public.autorizar_exclusao_relatorio(uuid,uuid,text),
  public.proteger_snapshot_retirada(), public.exigir_relatorio_antes_exclusao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_vistoria_final(uuid,uuid,jsonb), public.selar_vistoria_final(uuid),
  public.concluir_fotos_vistoria(uuid,uuid),
  public.cancelar_vistoria_incompleta(uuid,uuid), public.autorizar_exclusao_relatorio(uuid,uuid,text) TO service_role;

COMMIT;
