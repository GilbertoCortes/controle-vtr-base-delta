"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/protected");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("invalid login credentials")) {
        setError("E-mail ou senha incorretos. Confira os dados e tente novamente.");
      } else if (message.toLowerCase().includes("email not confirmed")) {
        setError("Confirme seu e-mail antes de acessar o sistema.");
      } else if (message.toLowerCase().includes("too many requests")) {
        setError("Muitas tentativas de acesso. Aguarde um pouco e tente novamente.");
      } else {
        setError("Não foi possível entrar. Verifique sua conexão e tente novamente.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "relative min-h-svh w-full overflow-hidden",
        className,
      )}
      {...props}
    >
      {/* Background: tela 3 (cenario + logos + titulo), cover, centralizado, sem distorcer */}
      <Image
        src="/tela%203.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
        aria-hidden="true"
      />

      <div className="relative flex min-h-svh flex-col px-5 pb-6 pt-5 sm:px-8">
        {/* Centro: apenas o card de login (logos/titulo/rodape estao na imagem) */}
        {/* justify-end + espacador superior posicionam o card abaixo do subtitulo da imagem, sem sobrepor o logo G/titulo */}
        <main className="flex flex-1 flex-col items-center justify-end pb-[2vh] pt-[50vh] sm:pt-[54vh]">
          {/* Card de login — translateY sobe o card ~120px em relacao a posicao do container */}
          <div className="w-full max-w-[400px] -translate-y-[120px] rounded-2xl border border-white/12 bg-[#07121c]/[0.82] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-sm sm:p-7">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-[#e6edf2]">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="nome@exemplo.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-md border border-white/15 bg-white/5 px-3.5 text-base text-white placeholder:text-[#8fa0ad] outline-none transition-colors focus:border-[#e8c15a] focus:ring-2 focus:ring-[#e8c15a]/25 sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-[#e6edf2]">
                  Senha
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-md border border-white/15 bg-white/5 px-3.5 pr-11 text-base text-white outline-none transition-colors focus:border-[#e8c15a] focus:ring-2 focus:ring-[#e8c15a]/25 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#9fb0bc] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8c15a]"
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </div>
              {error && (
                <p role="alert" className="rounded-md border border-[#e06c5f]/40 bg-[#e06c5f]/15 px-3 py-2.5 text-sm leading-relaxed text-[#f3b3ab]">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="flex h-12 w-full items-center justify-center rounded-md bg-[#e8c15a] px-4 text-sm font-bold uppercase tracking-wide text-[#1a1405] transition-colors hover:bg-[#f0cf7c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0cf7c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1a29] disabled:cursor-wait disabled:opacity-70"
              >
                {isLoading ? "Entrando..." : "Entrar"}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-[#93a5b1]">
              Acesse com seu usuário cadastrado.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
