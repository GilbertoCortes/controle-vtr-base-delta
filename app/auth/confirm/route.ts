import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

const DEFAULT_REDIRECT = "/";

// Aceita somente caminhos internos absolutos: começam com "/" e não são
// protocol-relative ("//") nem variantes com barra invertida que o browser
// poderia interpretar como host externo. Qualquer outro valor é ignorado.
function safeInternalPath(value: string | null): string {
  if (!value) return DEFAULT_REDIRECT;
  if (!value.startsWith("/")) return DEFAULT_REDIRECT;
  if (value.startsWith("//")) return DEFAULT_REDIRECT;
  if (value.includes("\\")) return DEFAULT_REDIRECT;
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeInternalPath(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next);
    } else {
      // redirect the user to an error page with some instructions
      redirect(`/auth/error?error=${error?.message}`);
    }
  }

  // redirect the user to an error page with some instructions
  redirect(`/auth/error?error=No token hash or type`);
}
