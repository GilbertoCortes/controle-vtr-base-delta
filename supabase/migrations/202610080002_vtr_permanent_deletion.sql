BEGIN;

-- Abortamos se as relacoes reais nao corresponderem ao esquema revisado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.registros_vtr'::regclass
       AND confrelid = 'public.viaturas'::regclass
       AND conname = 'registros_vtr_viatura_id_fkey' AND confdeltype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.fotos_registro_vtr'::regclass
       AND confrelid = 'public.registros_vtr'::regclass
       AND conname = 'fotos_registro_vtr_registro_id_fkey' AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'As foreign keys revisadas ON DELETE CASCADE nao foram encontradas';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE contype = 'f'
       AND confrelid IN ('public.viaturas'::regclass, 'public.registros_vtr'::regclass, 'public.fotos_registro_vtr'::regclass)
       AND conname NOT IN ('registros_vtr_viatura_id_fkey', 'fotos_registro_vtr_registro_id_fkey')
       AND NOT (conrelid = coalesce(to_regclass('public.exclusoes_vtr'), 0::oid)
         AND conname = 'exclusoes_vtr_viatura_id_fkey')
  ) THEN
    RAISE EXCEPTION 'Existem outras tabelas vinculadas a VTRs; revisar antes de continuar';
  END IF;
END;
$$;

-- Operacao tecnica temporaria: nao e arquivo de VTRs e nao permite restauracao.
CREATE TABLE IF NOT EXISTS public.exclusoes_vtr (
  viatura_id uuid PRIMARY KEY REFERENCES public.viaturas(id) ON DELETE CASCADE,
  caminhos text[] NOT NULL,
  iniciada_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exclusoes_vtr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exclusoes_vtr FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exclusoes_vtr TO service_role;

CREATE OR REPLACE FUNCTION public.verificar_vtr_disponivel(target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VTR_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exclusoes_vtr WHERE viatura_id = target_id) THEN
    RAISE EXCEPTION 'VTR_DELETION_IN_PROGRESS' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_gravacao_vtr_em_exclusao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  parent_id uuid;
  old_parent_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'viaturas' THEN
    parent_id := NEW.id;
    IF EXISTS (SELECT 1 FROM public.exclusoes_vtr WHERE viatura_id = OLD.id) THEN
      RAISE EXCEPTION 'VTR_DELETION_IN_PROGRESS' USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'registros_vtr' THEN
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
  END IF;
  PERFORM public.verificar_vtr_disponivel(parent_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS viaturas_bloqueia_exclusao_pendente ON public.viaturas;
CREATE TRIGGER viaturas_bloqueia_exclusao_pendente
  BEFORE UPDATE ON public.viaturas FOR EACH ROW
  EXECUTE FUNCTION public.bloquear_gravacao_vtr_em_exclusao();
DROP TRIGGER IF EXISTS registros_bloqueia_exclusao_pendente ON public.registros_vtr;
CREATE TRIGGER registros_bloqueia_exclusao_pendente
  BEFORE INSERT OR UPDATE ON public.registros_vtr FOR EACH ROW
  EXECUTE FUNCTION public.bloquear_gravacao_vtr_em_exclusao();
DROP TRIGGER IF EXISTS fotos_bloqueia_exclusao_pendente ON public.fotos_registro_vtr;
CREATE TRIGGER fotos_bloqueia_exclusao_pendente
  BEFORE INSERT OR UPDATE ON public.fotos_registro_vtr FOR EACH ROW
  EXECUTE FUNCTION public.bloquear_gravacao_vtr_em_exclusao();

CREATE OR REPLACE FUNCTION public.preparar_exclusao_vtr(target_id uuid)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  photo_paths text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ADMIN_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VTR_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  -- Nao apagamos arquivos de outra VTR se um caminho foi cadastrado incorretamente.
  IF EXISTS (
    SELECT 1 FROM public.fotos_registro_vtr f
    JOIN public.registros_vtr r ON r.id = f.registro_id
    WHERE r.viatura_id = target_id
      AND (f.caminho_storage IS NULL OR split_part(f.caminho_storage, '/', 1) <> target_id::text)
  ) THEN
    RAISE EXCEPTION 'INVALID_VTR_PHOTO_PATH' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fotos_registro_vtr f
    JOIN public.registros_vtr r ON r.id = f.registro_id
    WHERE split_part(f.caminho_storage, '/', 1) = target_id::text
      AND r.viatura_id <> target_id
  ) THEN
    RAISE EXCEPTION 'SHARED_VTR_PHOTO_PATH' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(array_agg(path ORDER BY path), ARRAY[]::text[]) INTO photo_paths
  FROM (
    SELECT o.name AS path FROM storage.objects o
      WHERE o.bucket_id = 'fotos-vtr' AND split_part(o.name, '/', 1) = target_id::text
    UNION
    SELECT f.caminho_storage FROM public.fotos_registro_vtr f
      JOIN public.registros_vtr r ON r.id = f.registro_id WHERE r.viatura_id = target_id
    UNION
    SELECT unnest(e.caminhos) FROM public.exclusoes_vtr e WHERE e.viatura_id = target_id
  ) paths;

  INSERT INTO public.exclusoes_vtr (viatura_id, caminhos) VALUES (target_id, photo_paths)
    ON CONFLICT (viatura_id) DO UPDATE SET caminhos = EXCLUDED.caminhos;
  RETURN photo_paths;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_exclusao_vtr()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'fotos-vtr' AND split_part(name, '/', 1) = OLD.id::text
  ) THEN
    RAISE EXCEPTION 'VTR_STORAGE_NOT_EMPTY' USING ERRCODE = '55000';
  END IF;
  -- O rollback do cadastro continua podendo remover uma VTR sem registros.
  IF EXISTS (SELECT 1 FROM public.registros_vtr WHERE viatura_id = OLD.id)
     AND (auth.role() IS DISTINCT FROM 'service_role'
          OR NOT EXISTS (SELECT 1 FROM public.exclusoes_vtr WHERE viatura_id = OLD.id)) THEN
    RAISE EXCEPTION 'USE_ADMIN_DELETION_FLOW' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS viaturas_exige_limpeza_storage ON public.viaturas;
CREATE TRIGGER viaturas_exige_limpeza_storage
  BEFORE DELETE ON public.viaturas FOR EACH ROW
  EXECUTE FUNCTION public.proteger_exclusao_vtr();

CREATE OR REPLACE FUNCTION public.concluir_exclusao_vtr(target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ADMIN_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.viaturas WHERE id = target_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exclusoes_vtr WHERE viatura_id = target_id) THEN
    RAISE EXCEPTION 'VTR_DELETION_NOT_PREPARED' USING ERRCODE = '55000';
  END IF;
  -- O trigger verifica Storage; as duas FKs removem historicos e metadados atomicamente.
  DELETE FROM public.viaturas WHERE id = target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verificar_vtr_disponivel(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bloquear_gravacao_vtr_em_exclusao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proteger_exclusao_vtr() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preparar_exclusao_vtr(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_exclusao_vtr(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparar_exclusao_vtr(uuid), public.concluir_exclusao_vtr(uuid) TO service_role;

-- Rollback de cadastro usa cliente administrativo no servidor, nao esta policy.
DROP POLICY IF EXISTS viaturas_delete_somente_admin_ativo ON public.viaturas;
CREATE POLICY viaturas_delete_somente_admin_ativo ON public.viaturas
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.ativo AND p.perfil = 'administrador'
  ));

COMMIT;
