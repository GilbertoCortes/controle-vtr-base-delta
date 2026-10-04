-- PREVIEW DE ROLLBACK - NAO APLICAR SEM AUTORIZACAO
-- Remove a funcao de protecao do ultimo administrador ativo.
-- Atencao: os handlers que chamam a RPC precisam ser revertidos antes/depois desta remocao.

REVOKE EXECUTE ON FUNCTION public.guard_admin_update(uuid, boolean, text) FROM service_role;
DROP FUNCTION IF EXISTS public.guard_admin_update(uuid, boolean, text);
