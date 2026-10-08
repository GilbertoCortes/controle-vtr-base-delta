BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_atualiza_proprio_perfil ON public.profiles;
DROP POLICY IF EXISTS administrador_atualiza_perfis ON public.profiles;

-- Mesmo se outra politica permissiva for adicionada, clientes nao gravam diretamente.
DROP POLICY IF EXISTS profiles_bloqueia_update_direto ON public.profiles;
CREATE POLICY profiles_bloqueia_update_direto
  ON public.profiles AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- RLS pode ignorar linhas sem gerar erro; revogar privilegios rejeita o UPDATE.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.profiles
  FROM PUBLIC, anon, authenticated;

-- Grants por coluna sobrevivem ao REVOKE no nivel da tabela.
DO $$
DECLARE
  column_names text;
  guard_function regprocedure;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(attname), ', ' ORDER BY attnum)
    INTO column_names
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.profiles'::regclass
     AND attnum > 0
     AND NOT attisdropped;

  EXECUTE format(
    'REVOKE INSERT (%s), UPDATE (%s) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
    column_names, column_names
  );

  -- A RPC administrativa tambem nao pode contornar a protecao pela API publica.
  FOR guard_function IN
    SELECT p.oid::regprocedure
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'guard_admin_update'
       AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', guard_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', guard_function);
  END LOOP;
END;
$$;

-- O servidor verifica administrador ativo antes de usar esta role.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

-- As politicas e os grants de SELECT existentes permanecem intactos.
COMMIT;
