"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useState } from "react";

export type UsuarioPerfil = {
  id: string;
  email: string | null;
  nome_completo: string | null;
  rg_id: string | null;
  base: string | null;
  ala: string | null;
  perfil: string | null;
  ativo: boolean;
};

type DadosUsuario = {
  nome_completo: string;
  rg_id: string;
  email: string;
  base: string;
  ala: string;
  perfil: "usuario" | "administrador";
};

type NovoUsuario = DadosUsuario & { password: string };

const basesDisponiveis = ["Base", "Alfa", "Bravo", "Charlie", "Delta"];
const alasDisponiveis = ["Alfa", "Bravo", "Charlie"];

const novoUsuarioInicial: NovoUsuario = {
  nome_completo: "",
  rg_id: "",
  email: "",
  base: "",
  ala: "",
  perfil: "usuario",
  password: "",
};

function displayValue(value: string | null) {
  return value?.trim() || "—";
}

export function AdminUsersManager({
  users,
  currentUserId,
  isAdmin,
  listError,
}: {
  users: UsuarioPerfil[];
  currentUserId: string;
  isAdmin: boolean;
  listError: string | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [newUser, setNewUser] = useState(novoUsuarioInicial);
  const [editingUser, setEditingUser] = useState<UsuarioPerfil | null>(null);
  const [editValues, setEditValues] = useState<DadosUsuario | null>(null);
  const [passwordUser, setPasswordUser] = useState<UsuarioPerfil | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const activeUsers = users.filter((user) => user.ativo);

  async function readResponse(response: Response) {
    return await response.json().catch(() => null) as { message?: string } | null;
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch("/api/usuarios/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setIsError(true);
        setMessage(result?.message ?? "Não foi possível cadastrar o usuário.");
        return;
      }
      setNewUser(novoUsuarioInicial);
      setIsOpen(false);
      setMessage(result?.message ?? "Usuário cadastrado com sucesso.");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("Não foi possível conectar ao sistema. Tente novamente.");
    } finally {
      setIsCreating(false);
    }
  }

  async function changeAccess(target: UsuarioPerfil, ativo: boolean) {
    if (!isAdmin || busyUserId) return;
    if (!ativo) {
      const confirmation = target.id === currentUserId
        ? "Você está removendo o seu próprio acesso. Deseja continuar?"
        : "Tem certeza que deseja remover o acesso deste usuário? O histórico das ações realizadas por ele será preservado.";
      if (!window.confirm(confirmation)) return;
    }
    setBusyUserId(target.id);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(`/api/usuarios/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo }),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setIsError(true);
        setMessage(result?.message ?? "Não foi possível atualizar o acesso do usuário.");
        return;
      }
      setMessage(result?.message ?? (ativo ? "Usuário reativado." : "Acesso removido."));
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("Não foi possível conectar ao sistema. Tente novamente.");
    } finally {
      setBusyUserId(null);
    }
  }

  function startEdit(target: UsuarioPerfil) {
    setIsOpen(false);
    setEditingUser(target);
    setPasswordUser(null);
    setEditValues({
      nome_completo: target.nome_completo ?? "",
      rg_id: target.rg_id ?? "",
      email: target.email ?? "",
      base: basesDisponiveis.includes(target.base ?? "") ? target.base! : "",
      ala: alasDisponiveis.includes(target.ala ?? "") ? target.ala! : "",
      perfil: target.perfil === "administrador" ? "administrador" : "usuario",
    });
    setMessage(null);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || !editingUser || !editValues || isCreating) return;
    setIsCreating(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(`/api/usuarios/${editingUser.id}/perfil`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editValues),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setIsError(true);
        setMessage(result?.message ?? "Não foi possível salvar os dados do usuário.");
        return;
      }
      setEditingUser(null);
      setEditValues(null);
      setMessage(result?.message ?? "Dados do usuário atualizados com sucesso.");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("Não foi possível conectar ao sistema. Tente novamente.");
    } finally {
      setIsCreating(false);
    }
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || !passwordUser || isCreating) return;
    if (newPassword.length < 8) {
      setIsError(true);
      setMessage("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setIsCreating(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(`/api/usuarios/${passwordUser.id}/senha`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setIsError(true);
        setMessage(result?.message ?? "Não foi possível alterar a senha.");
        return;
      }
      setPasswordUser(null);
      setNewPassword("");
      setMessage(result?.message ?? "Senha alterada com sucesso.");
    } catch {
      setIsError(true);
      setMessage("Não foi possível conectar ao sistema. Tente novamente.");
    } finally {
      setIsCreating(false);
    }
  }

  function userActions(target: UsuarioPerfil) {
    if (!isAdmin) return null;
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => startEdit(target)} className="min-h-10 rounded-md border border-[#40514c] px-3 text-xs font-bold text-[#e0e8e3] hover:bg-white/5">EDITAR USUÁRIO</button>
        <button type="button" onClick={() => { setIsOpen(false); setPasswordUser(target); setEditingUser(null); setNewPassword(""); }} className="min-h-10 rounded-md border border-[#40514c] px-3 text-xs font-bold text-[#e0e8e3] hover:bg-white/5">ALTERAR SENHA</button>
        <button type="button" title="Remover usuário" aria-label="Remover usuário" disabled={busyUserId !== null} onClick={() => void changeAccess(target, false)} className="flex size-10 items-center justify-center rounded-md border border-[#bd4c4b]/50 bg-[#301f22] text-[#f0aaa2] hover:bg-[#bd4c4b] hover:text-white disabled:cursor-wait disabled:opacity-60">
          {busyUserId === target.id ? "…" : <Trash2 aria-hidden="true" className="size-4" />}
        </button>
      </div>
    );
  }

  const inputClass = "h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#a9b8b1]">{activeUsers.length} usuário(s) ativo(s)</p>
        <button type="button" onClick={() => { setIsOpen((open) => !open); setEditingUser(null); setPasswordUser(null); setMessage(null); }} className="inline-flex min-h-12 items-center justify-center rounded-md bg-[#d5b45b] px-5 text-sm font-bold text-[#17201e] hover:bg-[#e2c675]">ADICIONAR USUÁRIO</button>
      </div>

      {message && <p role={isError ? "alert" : "status"} className={`rounded-md border p-3 text-sm ${isError ? "border-[#bd4c4b]/35 bg-[#bd4c4b]/10 text-[#f0aaa2]" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>{message}</p>}
      {listError && <p role="alert" className="whitespace-pre-wrap text-sm text-[#f0aaa2]">{listError}</p>}

      {isOpen && (
        <form onSubmit={createUser} className="space-y-4 rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[#f3f4ef]">Adicionar usuário</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Nome completo<input required value={newUser.nome_completo} onChange={(event) => setNewUser({ ...newUser, nome_completo: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">RG / ID funcional<input required value={newUser.rg_id} onChange={(event) => setNewUser({ ...newUser, rg_id: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">E-mail<input type="email" required value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Base<select required value={newUser.base} onChange={(event) => setNewUser({ ...newUser, base: event.target.value })} className={inputClass}><option value="" disabled>Selecione a Base</option>{basesDisponiveis.map((base) => <option key={base}>{base}</option>)}</select></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">ALA<select required value={newUser.ala} onChange={(event) => setNewUser({ ...newUser, ala: event.target.value })} className={inputClass}><option value="" disabled>Selecione a ALA</option>{alasDisponiveis.map((ala) => <option key={ala}>{ala}</option>)}</select></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Perfil<select required value={newUser.perfil} onChange={(event) => setNewUser({ ...newUser, perfil: event.target.value as NovoUsuario["perfil"] })} className={inputClass}><option value="usuario">usuario</option><option value="administrador">administrador</option></select></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Senha (mínimo 8 caracteres)<input type="password" autoComplete="new-password" minLength={8} required value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} className={inputClass} /></label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={isCreating} className="min-h-12 rounded-md bg-[#d5b45b] px-5 text-sm font-bold text-[#17201e] disabled:opacity-60">{isCreating ? "CRIANDO USUÁRIO..." : "CRIAR USUÁRIO"}</button>
            <button type="button" onClick={() => setIsOpen(false)} className="min-h-12 rounded-md border border-[#40514c] px-5 text-sm font-semibold text-[#e0e8e3]">Cancelar</button>
          </div>
        </form>
      )}

      {editingUser && editValues && (
        <form onSubmit={saveEdit} className="space-y-4 rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[#f3f4ef]">Editar usuário: {displayValue(editingUser.nome_completo)}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Nome completo<input required value={editValues.nome_completo} onChange={(event) => setEditValues({ ...editValues, nome_completo: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">RG / ID funcional<input required value={editValues.rg_id} onChange={(event) => setEditValues({ ...editValues, rg_id: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">E-mail<input type="email" required value={editValues.email} onChange={(event) => setEditValues({ ...editValues, email: event.target.value })} className={inputClass} /></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Base<select required value={editValues.base} onChange={(event) => setEditValues({ ...editValues, base: event.target.value })} className={inputClass}><option value="" disabled>Selecione a Base</option>{basesDisponiveis.map((base) => <option key={base}>{base}</option>)}</select></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">ALA<select required value={editValues.ala} onChange={(event) => setEditValues({ ...editValues, ala: event.target.value })} className={inputClass}><option value="" disabled>Selecione a ALA</option>{alasDisponiveis.map((ala) => <option key={ala}>{ala}</option>)}</select></label>
            <label className="space-y-2 text-sm font-medium text-[#e0e8e3]">Perfil<select required value={editValues.perfil} onChange={(event) => setEditValues({ ...editValues, perfil: event.target.value as DadosUsuario["perfil"] })} className={inputClass}><option value="usuario">usuario</option><option value="administrador">administrador</option></select></label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={isCreating} className="min-h-11 rounded-md bg-[#d5b45b] px-4 text-sm font-bold text-[#17201e] disabled:opacity-60">{isCreating ? "SALVANDO..." : "SALVAR ALTERAÇÕES"}</button>
            <button type="button" onClick={() => { setEditingUser(null); setEditValues(null); }} className="min-h-11 rounded-md border border-[#40514c] px-4 text-sm font-semibold text-[#e0e8e3]">Cancelar</button>
          </div>
        </form>
      )}

      {passwordUser && (
        <form onSubmit={savePassword} className="space-y-4 rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[#f3f4ef]">Alterar senha: {displayValue(passwordUser.nome_completo)}</h2>
          <label className="block space-y-2 text-sm font-medium text-[#e0e8e3]">Nova senha (mínimo 8 caracteres)<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={inputClass} /></label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={isCreating} className="min-h-11 rounded-md bg-[#d5b45b] px-4 text-sm font-bold text-[#17201e] disabled:opacity-60">{isCreating ? "ALTERANDO..." : "ALTERAR SENHA"}</button>
            <button type="button" onClick={() => { setPasswordUser(null); setNewPassword(""); }} className="min-h-11 rounded-md border border-[#40514c] px-4 text-sm font-semibold text-[#e0e8e3]">Cancelar</button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Usuários ativos</h2>
        {activeUsers.length === 0 ? <p className="py-6 text-center text-sm text-[#a9b8b1]">Nenhum usuário ativo.</p> : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {activeUsers.map((user) => (
              <li key={user.id} className="flex flex-col items-start justify-between gap-4 rounded-md border border-white/10 bg-[#192222] p-4">
                <dl className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><dt className="text-xs text-[#91a19a]">Nome completo</dt><dd className="break-words text-sm font-medium text-[#f3f4ef]">{displayValue(user.nome_completo)}</dd></div>
                  <div><dt className="text-xs text-[#91a19a]">RG / ID funcional</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(user.rg_id)}</dd></div>
                  <div><dt className="text-xs text-[#91a19a]">E-mail</dt><dd className="break-all text-sm text-[#e0e8e3]">{displayValue(user.email)}</dd></div>
                  <div><dt className="text-xs text-[#91a19a]">Base</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(user.base)}</dd></div>
                  <div><dt className="text-xs text-[#91a19a]">ALA</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(user.ala)}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs text-[#91a19a]">Perfil</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(user.perfil)}</dd></div>
                </dl>
                {userActions(user)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}