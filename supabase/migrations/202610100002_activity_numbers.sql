BEGIN;

ALTER TABLE public.registros_vtr
  ADD COLUMN IF NOT EXISTS atividade_numero integer;

ALTER TABLE public.registros_vtr
  ADD CONSTRAINT registros_vtr_atividade_numero_check
  CHECK (atividade_numero IS NULL OR atividade_numero > 0);

-- Antes de numerar registros antigos, verifica se o histórico baixa/recebimento
-- está em uma sequência coerente.
DO $$
BEGIN
  IF EXISTS (
    WITH sequencia AS (
      SELECT
        viatura_id,
        tipo_registro,
        criado_em,
        id,
        sum(
          CASE
            WHEN tipo_registro = 'baixa' THEN 1
            WHEN tipo_registro = 'recebimento' THEN -1
            ELSE 0
          END
        ) OVER (
          PARTITION BY viatura_id
          ORDER BY criado_em, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS saldo
      FROM public.registros_vtr
      WHERE tipo_registro IN ('baixa', 'recebimento')
    )
    SELECT 1
    FROM sequencia
    WHERE saldo < 0 OR saldo > 1
  ) THEN
    RAISE EXCEPTION
      'Historico antigo possui baixa/recebimento fora da sequencia esperada.';
  END IF;
END;
$$;

-- Numera as baixas antigas: 1, 2, 3...
WITH baixas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY viatura_id
      ORDER BY criado_em, id
    )::integer AS numero
  FROM public.registros_vtr
  WHERE tipo_registro = 'baixa'
)
UPDATE public.registros_vtr r
SET atividade_numero = b.numero
FROM baixas b
WHERE r.id = b.id
  AND r.atividade_numero IS NULL;

-- O recebimento recebe o mesmo número ordinal da baixa correspondente.
WITH recebimentos AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY viatura_id
      ORDER BY criado_em, id
    )::integer AS numero
  FROM public.registros_vtr
  WHERE tipo_registro = 'recebimento'
)
UPDATE public.registros_vtr r
SET atividade_numero = x.numero
FROM recebimentos x
WHERE r.id = x.id
  AND r.atividade_numero IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  registros_vtr_atividade_tipo_unico
ON public.registros_vtr (
  viatura_id,
  atividade_numero,
  tipo_registro
)
WHERE
  atividade_numero IS NOT NULL
  AND tipo_registro IN ('baixa', 'recebimento');

CREATE OR REPLACE FUNCTION public.atribuir_numero_atividade_vtr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  numero_aberto integer;
BEGIN
  -- Check-in inicial e vistoria final não possuem número de atividade.
  IF NEW.tipo_registro NOT IN ('baixa', 'recebimento') THEN
    NEW.atividade_numero := NULL;
    RETURN NEW;
  END IF;

  -- Serializa operações da mesma VTR para impedir números duplicados.
  PERFORM 1
  FROM public.viaturas
  WHERE id = NEW.viatura_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VTR_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF NEW.tipo_registro = 'baixa' THEN

    -- Não permite nova baixa enquanto existir atividade aberta.
    IF EXISTS (
      SELECT 1
      FROM public.registros_vtr b
      WHERE b.viatura_id = NEW.viatura_id
        AND b.tipo_registro = 'baixa'
        AND b.atividade_numero IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.registros_vtr r
          WHERE r.viatura_id = b.viatura_id
            AND r.tipo_registro = 'recebimento'
            AND r.atividade_numero = b.atividade_numero
        )
    ) THEN
      RAISE EXCEPTION 'ATIVIDADE_ABERTA'
        USING ERRCODE = '55000';
    END IF;

    SELECT COALESCE(max(atividade_numero), 0) + 1
    INTO NEW.atividade_numero
    FROM public.registros_vtr
    WHERE viatura_id = NEW.viatura_id
      AND tipo_registro = 'baixa';

  ELSE

    -- Recebimento deve pertencer à baixa que ainda está aberta.
    SELECT b.atividade_numero
    INTO numero_aberto
    FROM public.registros_vtr b
    WHERE b.viatura_id = NEW.viatura_id
      AND b.tipo_registro = 'baixa'
      AND b.atividade_numero IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.registros_vtr r
        WHERE r.viatura_id = b.viatura_id
          AND r.tipo_registro = 'recebimento'
          AND r.atividade_numero = b.atividade_numero
      )
    ORDER BY b.atividade_numero DESC
    LIMIT 1;

    IF numero_aberto IS NULL THEN
      RAISE EXCEPTION 'BAIXA_ABERTA_NAO_ENCONTRADA'
        USING ERRCODE = '55000';
    END IF;

    NEW.atividade_numero := numero_aberto;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registros_vtr_numera_atividade
ON public.registros_vtr;

CREATE TRIGGER registros_vtr_numera_atividade
BEFORE INSERT ON public.registros_vtr
FOR EACH ROW
EXECUTE FUNCTION public.atribuir_numero_atividade_vtr();

COMMIT;
