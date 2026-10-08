-- APLICAR SOMENTE APOS a limpeza administrativa explicita das VTRs legadas.
BEGIN;
LOCK TABLE public.viaturas IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.viaturas WHERE arquivada = true) THEN
    RAISE EXCEPTION 'Execute a limpeza administrativa das VTRs arquivadas antes de remover os campos';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exclusoes_vtr) THEN
    RAISE EXCEPTION 'Conclua as exclusoes pendentes antes de remover os campos';
  END IF;
END;
$$;

-- RESTRICT (sem CASCADE): dependencias nao revisadas fazem a migration abortar.
ALTER TABLE public.viaturas
  DROP COLUMN arquivada_por,
  DROP COLUMN arquivada_em,
  DROP COLUMN arquivada;

COMMIT;
