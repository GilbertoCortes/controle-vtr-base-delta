import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAdminSession } from "@/lib/supabase/admin";
import { ArchiveViaturaButton } from "@/components/archive-viatura-button";
import { formatPlate } from "@/lib/plate";

type Viatura = {
  id: string | number;
  placa: string;
  tipo: string;
  situacao: string;
  quilometragem: number | null;
  arquivada: boolean;
  arquivada_em: string | null;
  arquivada_por: string | null;
  motivo_situacao: string | null;
};

type Registro = {
  id: string | number;
  tipo_registro: string;
  km: number | null;
  combustivel: string | null;
  oleo_motor: string | null;
  liquido_arrefecimento: string | null;
  checklist: Record<string, unknown> | null;
  usuario_id: string | null;
  criado_em: string;
  reparos_realizados: boolean | null;
  descricao_reparos: string | null;
  empresa: string | null;
  responsavel_entrega: string | null;
  cpf_responsavel_entrega: string | null;
};

type Foto = {
  id: string | number;
  registro_id: string | number;
  caminho_storage: string;
  descricao: string | null;
  criado_em: string;
};

type FotoAssinada = {
  id: string | number;
  registro_id: string | number;
  descricao: string | null;
  url: string | null;
};

type HistoricoItem = {
  id: string;
  data: string;
  registro?: Registro;
  baixa?: Registro;
  recebimento?: Registro;
};

type PerfilFuncional = {
  id: string;
  nome_completo: string | null;
  rg_id: string | null;
  base: string | null;
  ala: string | null;
};

const checklistLabels: Record<string, string> = {
  km_atual: "KM",
  combustivel: "Combustível",
  oleo_motor: "Óleo do motor",
  liquido_arrefecimento: "Líquido de arrefecimento",
  observacoes: "Observações",
  reparos_realizados: "Reparos realizados",
  descricao_reparos: "Descrição dos reparos",
  pneu_dianteiro_esquerdo: "Pneu dianteiro esquerdo",
  pneu_dianteiro_direito: "Pneu dianteiro direito",
  pneu_traseiro_esquerdo: "Pneu traseiro esquerdo",
  pneu_traseiro_direito: "Pneu traseiro direito",
  pneu_dianteiro: "Pneu dianteiro",
  pneu_traseiro: "Pneu traseiro",
  estepe: "Estepe",
  seta_dianteira_direita: "Seta dianteira direita",
  seta_dianteira_esquerda: "Seta dianteira esquerda",
  seta_traseira_direita: "Seta traseira direita",
  seta_traseira_esquerda: "Seta traseira esquerda",
  luz_freio: "Luz de freio",
  luz_alerta: "Luz de alerta",
  farol_alto: "Farol alto",
  farol_baixo: "Farol baixo",
  buzina: "Buzina",
  strobo: "Strobo",
  sirene: "Sirene",
  giroflex: "Giroflex",
  triangulo: "Triângulo",
  chave_roda: "Chave de roda",
  retrovisor_direito: "Retrovisor direito",
  retrovisor_esquerdo: "Retrovisor esquerdo",
};

function displayValue(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function formatEventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data não disponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Hora não disponível"
    : new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(date);
}

function FunctionalProfileDetails({
  profile,
  label,
}: {
  profile?: PerfilFuncional;
  label: string;
}) {
  return (
    <div className="space-y-1 text-xs text-[#bdc9c3]">
      <p>{label}: {displayValue(profile?.nome_completo ?? null)}</p>
      <p>RG/ID: {displayValue(profile?.rg_id ?? null)} · Base: {displayValue(profile?.base ?? null)} · ALA: {displayValue(profile?.ala ?? null)}</p>
    </div>
  );
}

function formatRegistroType(value: string) {
  if (value === "checkin_inicial") return "Check-in/Entrada de VTR";
  if (value === "remocao_base") return "Removida da Base Delta";
  if (value === "recebimento") return "Recebida da Oficina";
  return displayValue(value);
}

async function ViaturaDetailsContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user, isAdmin } = await getAdminSession();

  if (!user) redirect("/auth/login");

  const { data: viaturaData, error: viaturaError } = await supabase
    .from("viaturas")
    .select("id, placa, tipo, situacao, quilometragem, arquivada, arquivada_em, arquivada_por, motivo_situacao")
    .eq("id", id)
    .maybeSingle();

  if (viaturaError) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-5">
        <p role="alert" className="text-sm text-[#f0aaa2]">
          Não foi possível carregar os dados da VTR. Tente novamente.
        </p>
      </section>
    );
  }

  if (!viaturaData) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef]">VTR não encontrada</h1>
      </section>
    );
  }

  const viatura = viaturaData as unknown as Viatura;
  const { data: recordsData, error: recordsError } = await supabase
    .from("registros_vtr")
    .select(
      "id, tipo_registro, km, combustivel, oleo_motor, liquido_arrefecimento, checklist, usuario_id, criado_em, reparos_realizados, descricao_reparos, empresa, responsavel_entrega, cpf_responsavel_entrega",
    )
    .eq("viatura_id", viatura.id)
    .order("criado_em", { ascending: false });
  const registros = (recordsData ?? []) as unknown as Registro[];
  const responsibleIds = Array.from(new Set([
    ...registros.map((registro) => registro.usuario_id),
    viatura.arquivada_por,
  ].filter((userId): userId is string => Boolean(userId))));
  const { data: profilesData } = responsibleIds.length
    ? await supabase
        .from("profiles")
        .select("id, nome_completo, rg_id, base, ala")
        .in("id", responsibleIds)
    : { data: [] };
  const profilesById = new Map(
    ((profilesData ?? []) as unknown as PerfilFuncional[]).map((profile) => [profile.id, profile]),
  );

  const registroIds = registros.map((registro) => registro.id);
  let fotos: Foto[] = [];
  let fotosError = false;
  if (registroIds.length > 0) {
    const { data: fotosData, error: fotosQueryError } = await supabase
      .from("fotos_registro_vtr")
      .select("id, registro_id, caminho_storage, descricao, criado_em")
      .in("registro_id", registroIds)
      .order("criado_em", { ascending: true });
    fotosError = Boolean(fotosQueryError);
    fotos = (fotosData ?? []) as unknown as Foto[];
  }
  const fotosAssinadas: FotoAssinada[] = await Promise.all(
    fotos.map(async (foto) => {
      const { data, error } = await supabase.storage
        .from("fotos-vtr")
        .createSignedUrl(foto.caminho_storage, 60 * 60);
      if (error) fotosError = true;
      return {
        id: foto.id,
        registro_id: foto.registro_id,
        descricao: foto.descricao,
        url: data?.signedUrl ?? null,
      };
    }),
  );
  const fotosByRegistroId = new Map<string, FotoAssinada[]>();
  for (const foto of fotosAssinadas) {
    const key = String(foto.registro_id);
    fotosByRegistroId.set(key, [...(fotosByRegistroId.get(key) ?? []), foto]);
  }
  const situacao = viatura.situacao.trim().toUpperCase();
  const isArchived = viatura.arquivada === true;
  const hasArchiveEvent = isArchived && Boolean(viatura.arquivada_em);
  const isAtiva = situacao === "ATIVA";
  const isBaixada = situacao === "BAIXADA";
  const checkinEntrada = [...registros]
    .filter((registro) => registro.tipo_registro === "checkin_inicial")
    .sort((left, right) => new Date(left.criado_em).getTime() - new Date(right.criado_em).getTime())[0] ?? null;
  const historico: HistoricoItem[] = [];
  let baixaPendente: Registro | null = null;

  function addRegistroAvulso(registro: Registro) {
    historico.push({ id: `registro-${registro.id}`, data: registro.criado_em, registro });
  }

  const registrosCronologicos = [...registros].sort(
    (left, right) => new Date(left.criado_em).getTime() - new Date(right.criado_em).getTime(),
  );
  for (const registro of registrosCronologicos) {
    if (registro.tipo_registro === "baixa") {
      if (baixaPendente) addRegistroAvulso(baixaPendente);
      baixaPendente = registro;
    } else if (registro.tipo_registro === "recebimento") {
      if (baixaPendente) {
        historico.push({
          id: `ciclo-${baixaPendente.id}-${registro.id}`,
          data: registro.criado_em,
          baixa: baixaPendente,
          recebimento: registro,
        });
        baixaPendente = null;
      } else {
        addRegistroAvulso(registro);
      }
    } else {
      addRegistroAvulso(registro);
    }
  }
  if (baixaPendente) addRegistroAvulso(baixaPendente);
  historico.sort((left, right) => new Date(right.data).getTime() - new Date(left.data).getTime());

  function renderRegistro(registro: Registro, tipo?: "baixa" | "recebimento" | "checkin") {
    const checklist = registro.checklist ?? {};
    const observacoes = checklist.observacoes;
    const checklistItems = Object.entries(checklist).filter(
      ([key]) => key !== "observacoes",
    );
    const fotosDoRegistro = fotosByRegistroId.get(String(registro.id)) ?? [];
    const profile = registro.usuario_id ? profilesById.get(registro.usuario_id) : undefined;
    const titulo = tipo === "checkin"
      ? "CHECK-IN/ENTRADA DE VTR"
      : tipo === "recebimento"
      ? "VIATURA RECEBIDA DA OFICINA"
      : tipo === "baixa" ? "BAIXA" : formatRegistroType(registro.tipo_registro).toUpperCase();
    const detalheLabel = tipo === "baixa"
      ? "Detalhes da baixa"
      : tipo === "recebimento" ? "Detalhes do recebimento" : tipo === "checkin"
      ? "Detalhes check-in de entrada de VTR" : "Ver detalhes do registro";
    const responsavelLabel = tipo === "checkin"
      ? "Recebida por"
      : tipo === "recebimento"
      ? "Recebida por"
      : tipo === "baixa" ? "Realizada por" : "Realizado por";

    return (
      <section className="space-y-3">
        <h3 className="text-sm font-bold tracking-wide text-[#f3f4ef]">{titulo}</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tipo !== "checkin" && <div><dt className="text-xs text-[#91a19a]">KM</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.km)} km</dd></div>}
          <div><dt className="text-xs text-[#91a19a]">{tipo === "checkin" ? "Data de entrada" : "Data"}</dt><dd className="text-sm text-[#e0e8e3]">{formatEventDate(registro.criado_em)}</dd></div>
          <div><dt className="text-xs text-[#91a19a]">Hora</dt><dd className="text-sm text-[#e0e8e3]">{formatEventTime(registro.criado_em)}</dd></div>
        </dl>
        {tipo === "checkin" && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-[#91a19a]">Placa</dt><dd className="text-sm text-[#e0e8e3]">{formatPlate(viatura.placa)}</dd></div>
            <div><dt className="text-xs text-[#91a19a]">Tipo</dt><dd className="text-sm text-[#e0e8e3]">{viatura.tipo}</dd></div>
          </dl>
        )}
        <FunctionalProfileDetails profile={profile} label={responsavelLabel} />
        {tipo === "baixa" && (
          <p className="whitespace-pre-wrap text-sm text-[#e0e8e3]">Motivo: {displayValue(observacoes)}</p>
        )}
        {tipo === "recebimento" && (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-[#91a19a]">Empresa</dt><dd className="text-[#e0e8e3]">{displayValue(registro.empresa)}</dd></div>
            <div><dt className="text-xs text-[#91a19a]">Responsável pela entrega</dt><dd className="text-[#e0e8e3]">{displayValue(registro.responsavel_entrega)}</dd></div>
            <div><dt className="text-xs text-[#91a19a]">CPF</dt><dd className="text-[#e0e8e3]">{displayValue(registro.cpf_responsavel_entrega)}</dd></div>
            <div><dt className="text-xs text-[#91a19a]">Reparos realizados?</dt><dd className="text-[#e0e8e3]">{registro.reparos_realizados === null ? "—" : registro.reparos_realizados ? "Sim" : "Não"}</dd></div>
            {registro.descricao_reparos && <div className="sm:col-span-2"><dt className="text-xs text-[#91a19a]">Descrição dos reparos</dt><dd className="whitespace-pre-wrap text-[#e0e8e3]">{registro.descricao_reparos}</dd></div>}
          </dl>
        )}
        <details className="rounded-md border border-white/10 bg-[#141d1d]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#f1d989] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d5b45d]">
            {detalheLabel}
          </summary>
          <div className="space-y-4 border-t border-white/10 p-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-[#91a19a]">Tipo do registro</dt><dd className="text-sm text-[#e0e8e3]">{formatRegistroType(registro.tipo_registro)}</dd></div>
              <div><dt className="text-xs text-[#91a19a]">KM</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.km ?? checklist.km_atual)} km</dd></div>
              <div><dt className="text-xs text-[#91a19a]">Combustível</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.combustivel ?? checklist.combustivel)}</dd></div>
              <div><dt className="text-xs text-[#91a19a]">Óleo do motor</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.oleo_motor ?? checklist.oleo_motor)}</dd></div>
              <div><dt className="text-xs text-[#91a19a]">Líquido de arrefecimento</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.liquido_arrefecimento ?? checklist.liquido_arrefecimento)}</dd></div>
              <div><dt className="text-xs text-[#91a19a]">Data e hora</dt><dd className="text-sm text-[#e0e8e3]">{formatEventDate(registro.criado_em)} às {formatEventTime(registro.criado_em)}</dd></div>
              {tipo === "recebimento" && <>
                <div><dt className="text-xs text-[#91a19a]">Empresa</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.empresa)}</dd></div>
                <div><dt className="text-xs text-[#91a19a]">Responsável pela entrega</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.responsavel_entrega)}</dd></div>
                <div><dt className="text-xs text-[#91a19a]">CPF do responsável</dt><dd className="text-sm text-[#e0e8e3]">{displayValue(registro.cpf_responsavel_entrega)}</dd></div>
                <div><dt className="text-xs text-[#91a19a]">Reparos realizados</dt><dd className="text-sm text-[#e0e8e3]">{registro.reparos_realizados === null ? "—" : registro.reparos_realizados ? "Sim" : "Não"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-[#91a19a]">Descrição dos reparos</dt><dd className="whitespace-pre-wrap text-sm text-[#e0e8e3]">{displayValue(registro.descricao_reparos)}</dd></div>
              </>}
              <div className="sm:col-span-2"><dt className="text-xs text-[#91a19a]">{tipo === "baixa" ? "Motivo / observações" : "Observações"}</dt><dd className="whitespace-pre-wrap text-sm text-[#e0e8e3]">{displayValue(observacoes)}</dd></div>
            </dl>
            <FunctionalProfileDetails profile={profile} label={responsavelLabel} />
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[#f3f4ef]">Checklist completo</h4>
              {checklistItems.length ? (
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {checklistItems.map(([key, value]) => (
                    <div key={key} className="rounded-sm border border-white/10 p-3">
                      <dt className="text-xs text-[#91a19a]">{checklistLabels[key] ?? key.replaceAll("_", " ")}</dt>
                      <dd className="mt-1 break-words text-sm text-[#e0e8e3]">{displayValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="text-sm text-[#bdc9c3]">Nenhum item de checklist registrado.</p>}
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[#f3f4ef]">Fotos da avaria / registro</h4>
              {fotosError && <p role="alert" className="mb-2 text-sm text-[#f0aaa2]">Não foi possível carregar todas as fotos.</p>}
              {fotosDoRegistro.length ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {fotosDoRegistro.map((foto) => (
                    <li key={foto.id} className="overflow-hidden rounded-md border border-white/10 bg-[#192222]">
                      {foto.url ? <Image src={foto.url} alt={foto.descricao || `Foto da VTR ${formatPlate(viatura.placa)}`} width={640} height={480} unoptimized className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center p-4 text-center text-sm text-[#91a19a]">Foto indisponível</div>}
                      {foto.descricao && <p className="p-3 text-xs text-[#bdc9c3]">{foto.descricao}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-[#bdc9c3]">Nenhuma foto vinculada a este registro.</p>}
            </div>
            <div>
              <a
                href={`/api/viaturas/${viatura.id}/registros/${registro.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#40514c] bg-[#1c2a27] px-4 text-sm font-bold text-[#f1d989] transition-colors hover:border-[#d5b45b] hover:bg-[#233330] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5b45b]"
              >
                Gerar PDF
              </a>
            </div>
          </div>
        </details>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div className="w-full">
          <h1 className="text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
            VTR {formatPlate(viatura.placa)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAtiva && !viatura.arquivada && (
            <Link
              href={`/protected/viaturas/${viatura.id}/baixa`}
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-[#bd4c4b]/50 bg-[#bd4c4b] px-5 text-sm font-bold text-white transition-colors hover:bg-[#d15d59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ef9691]"
            >
              BAIXAR VTR
            </Link>
          )}
          {isBaixada && !viatura.arquivada && (
            <Link
              href={`/protected/viaturas/${viatura.id}/recebimento-oficina`}
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-emerald-500/50 bg-emerald-700 px-5 text-sm font-bold text-white transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              RECEBER VTR DA OFICINA
            </Link>
          )}
          {isAdmin && !isArchived && !isBaixada && (
            <ArchiveViaturaButton
              isAdmin={isAdmin}
              viaturaId={viatura.id}
            />
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-white/10 bg-[#192222] p-4">
          <dt className="text-xs text-[#91a19a]">Placa</dt>
          <dd className="mt-1 font-semibold text-[#f3f4ef]">{formatPlate(viatura.placa)}</dd>
        </div>
        <div className="rounded-md border border-white/10 bg-[#192222] p-4">
          <dt className="text-xs text-[#91a19a]">Tipo</dt>
          <dd className="mt-1 font-semibold text-[#f3f4ef]">{displayValue(viatura.tipo)}</dd>
        </div>
        <div className="rounded-md border border-white/10 bg-[#192222] p-4">
          <dt className="text-xs text-[#91a19a]">Situação</dt>
          <dd className={`mt-1 font-semibold ${isAtiva ? "text-emerald-400" : "text-red-400"}`}>
            {isAtiva ? "ATIVA" : "BAIXADA"}
          </dd>
        </div>
      </dl>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-[#f3f4ef]">Check-in/Entrada de VTR</h2>
        {checkinEntrada ? (
          <article className="rounded-md border border-white/10 bg-[#192222] p-4 sm:p-5">
            {renderRegistro(checkinEntrada, "checkin")}
          </article>
        ) : (
          <p className="rounded-md border border-white/10 bg-[#192222] p-4 text-sm text-[#bdc9c3]">
            Não há registro de entrada disponível para esta VTR.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-[#f3f4ef]">Histórico</h2>
        {recordsError ? (
          <p role="alert" className="text-sm text-[#f0aaa2]">
            Não foi possível carregar o histórico desta VTR.
          </p>
        ) : historico.length === 0 ? (
          <p className="text-sm text-[#b7c4bd]">Nenhum registro encontrado.</p>
        ) : (
          <ol className="space-y-4">
            {historico.map((item) => {
              return (
                <li key={item.id}>
                  <article className="space-y-4 rounded-md border border-white/10 bg-[#192222] p-4 sm:p-5">
                    {item.recebimento && renderRegistro(item.recebimento, "recebimento")}
                    {item.recebimento && item.baixa && <hr className="border-white/10" />}
                    {item.baixa && renderRegistro(item.baixa, "baixa")}
                    {item.registro?.tipo_registro === "checkin_inicial" ? (
                      <section className="space-y-2">
                        <h3 className="text-sm font-bold tracking-wide text-[#f3f4ef]">
                          ENTRADA INICIAL / CHECK-IN
                        </h3>
                        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="text-xs text-[#91a19a]">Data e hora</dt>
                            <dd className="text-[#e0e8e3]">
                              {formatEventDate(item.registro.criado_em)} às {formatEventTime(item.registro.criado_em)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-[#91a19a]">Responsável</dt>
                            <dd className="text-[#e0e8e3]">
                              {displayValue(item.registro.usuario_id ? profilesById.get(item.registro.usuario_id)?.nome_completo ?? null : null)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-[#91a19a]">KM</dt>
                            <dd className="text-[#e0e8e3]">
                              {displayValue(item.registro.km ?? item.registro.checklist?.km_atual)} km
                            </dd>
                          </div>
                        </dl>
                      </section>
                    ) : item.registro && renderRegistro(
                      item.registro,
                      item.registro.tipo_registro === "baixa" || item.registro.tipo_registro === "recebimento"
                        ? item.registro.tipo_registro
                        : undefined,
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {hasArchiveEvent && viatura.arquivada_em && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-[#f3f4ef]">Saída da Base Delta</h2>
          <article className="space-y-4 rounded-md border border-white/10 bg-[#192222] p-4 sm:p-5">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-xs text-[#91a19a]">Data da retirada</dt><dd className="text-sm text-[#e0e8e3]">{formatEventDate(viatura.arquivada_em)}</dd></div>
              <div><dt className="text-xs text-[#91a19a]">Hora da retirada</dt><dd className="text-sm text-[#e0e8e3]">{formatEventTime(viatura.arquivada_em)}</dd></div>
              <div><dt className="text-xs text-[#91a19a]">Placa</dt><dd className="text-sm text-[#e0e8e3]">{formatPlate(viatura.placa)}</dd></div>
            </dl>
            <FunctionalProfileDetails
              profile={viatura.arquivada_por ? profilesById.get(viatura.arquivada_por) : undefined}
              label="Retirada por"
            />
            {viatura.motivo_situacao && (
              <p className="whitespace-pre-wrap text-sm text-[#e0e8e3]">Observação/motivo: {viatura.motivo_situacao}</p>
            )}
            <details className="rounded-md border border-white/10 bg-[#141d1d]">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#f1d989] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d5b45d]">
                Detalhes da saída da Base Delta
              </summary>
              <div className="space-y-3 border-t border-white/10 p-4">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs text-[#91a19a]">Data e hora</dt><dd className="text-sm text-[#e0e8e3]">{formatEventDate(viatura.arquivada_em)} às {formatEventTime(viatura.arquivada_em)}</dd></div>
                  <div><dt className="text-xs text-[#91a19a]">Tipo</dt><dd className="text-sm text-[#e0e8e3]">{viatura.tipo}</dd></div>
                  {viatura.motivo_situacao && <div className="sm:col-span-2"><dt className="text-xs text-[#91a19a]">Observação/motivo</dt><dd className="whitespace-pre-wrap text-sm text-[#e0e8e3]">{viatura.motivo_situacao}</dd></div>}
                </dl>
                <FunctionalProfileDetails
                  profile={viatura.arquivada_por ? profilesById.get(viatura.arquivada_por) : undefined}
                  label="Retirada por"
                />
              </div>
            </details>
          </article>
        </section>
      )}

    </section>
  );
}

export default function ViaturaDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl py-10 text-center text-sm text-[#b7c4bd]">
          Carregando dados da VTR...
        </div>
      }
    >
      <ViaturaDetailsContent params={params} />
    </Suspense>
  );
}