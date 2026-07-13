import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import supabase from '../supabaseClient';

type Temporada = {
  id: number;
  codigo_temporada: string;
};

type EtapaCodigoRow = {
  codigo_etapa: string;
};

type StatusMessage = {
  type: 'success' | 'error';
  text: string;
} | null;

function normalizeNome(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeCodigoEtapa(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeCodigoTemporada(value: string): string {
  return value.trim().toUpperCase();
}

function getTodayDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getNextEtapaCode(codigoTemporada: string, codigosExistentes: string[]): string {
  const nextNumber = codigosExistentes.reduce((max, codigoAtual) => {
    const match = codigoAtual.match(/-(\d+)$/);
    if (!match) return max;

    const parsed = Number.parseInt(match[1], 10);
    if (Number.isNaN(parsed)) return max;
    return Math.max(max, parsed);
  }, 0) + 1;

  return `${codigoTemporada}-${String(nextNumber).padStart(2, '0')}`;
}

export default function CadastroBasico() {
  const [nomeJogador, setNomeJogador] = useState('');
  const [jogadorStatus, setJogadorStatus] = useState<StatusMessage>(null);
  const [isSavingJogador, setIsSavingJogador] = useState(false);

  const [temporadas, setTemporadas] = useState<Temporada[]>([]);
  const [temporadaId, setTemporadaId] = useState('');
  const [codigoEtapa, setCodigoEtapa] = useState('');
  const [dataEtapa, setDataEtapa] = useState('');
  const [etapaStatus, setEtapaStatus] = useState<StatusMessage>(null);
  const [isLoadingTemporadas, setIsLoadingTemporadas] = useState(false);
  const [isSavingEtapa, setIsSavingEtapa] = useState(false);

  const [codigoTemporada, setCodigoTemporada] = useState('');
  const [temporadaAtiva, setTemporadaAtiva] = useState(true);
  const [dataInicioTemporada, setDataInicioTemporada] = useState(getTodayDateISO());
  const [dataFimTemporada, setDataFimTemporada] = useState('');
  const [temporadaStatus, setTemporadaStatus] = useState<StatusMessage>(null);
  const [isSavingTemporada, setIsSavingTemporada] = useState(false);

  useEffect(() => {
    const loadTemporadas = async () => {
      setIsLoadingTemporadas(true);

      const { data, error } = await supabase
        .from('temporadas')
        .select('id, codigo_temporada')
        .order('codigo_temporada', { ascending: false });

      if (error) {
        setEtapaStatus({
          type: 'error',
          text: `Erro ao carregar temporadas: ${error.message}`,
        });
        setIsLoadingTemporadas(false);
        return;
      }

      const temporadasCarregadas = (data ?? []) as Temporada[];
      setTemporadas(temporadasCarregadas);

      if (temporadasCarregadas.length > 0) {
        setTemporadaId(String(temporadasCarregadas[0].id));
      }

      setIsLoadingTemporadas(false);
    };

    void loadTemporadas();
  }, []);

  useEffect(() => {
    const sugerirProximaEtapa = async () => {
      if (!temporadaId) {
        setDataEtapa(getTodayDateISO());
        return;
      }

      const temporadaSelecionada = temporadas.find((item) => String(item.id) === temporadaId);
      if (!temporadaSelecionada) {
        setDataEtapa(getTodayDateISO());
        return;
      }

      const { data, error } = await supabase
        .from('etapas')
        .select('codigo_etapa')
        .eq('temporada_id', Number(temporadaId));

      if (error) {
        setEtapaStatus({
          type: 'error',
          text: `Erro ao sugerir próxima etapa: ${error.message}`,
        });
        setDataEtapa(getTodayDateISO());
        return;
      }

      const codigosExistentes = ((data ?? []) as EtapaCodigoRow[]).map((item) => item.codigo_etapa);
      const codigoSugerido = getNextEtapaCode(temporadaSelecionada.codigo_temporada, codigosExistentes);

      setCodigoEtapa(codigoSugerido);
      setDataEtapa(getTodayDateISO());
    };

    void sugerirProximaEtapa();
  }, [temporadaId, temporadas]);

  const hasTemporadas = useMemo(() => temporadas.length > 0, [temporadas]);

  const loadTemporadasList = async () => {
    const { data, error } = await supabase
      .from('temporadas')
      .select('id, codigo_temporada')
      .order('codigo_temporada', { ascending: false });

    if (error) {
      return { error };
    }

    const temporadasCarregadas = (data ?? []) as Temporada[];
    setTemporadas(temporadasCarregadas);

    return { data: temporadasCarregadas };
  };

  const handleCadastrarJogador = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJogadorStatus(null);

    const nomeNormalizado = normalizeNome(nomeJogador);
    if (!nomeNormalizado) {
      setJogadorStatus({ type: 'error', text: 'Informe o nome do jogador.' });
      return;
    }

    setIsSavingJogador(true);

    const { data: existingData, error: existingError } = await supabase
      .from('jogadores')
      .select('id, nome')
      .ilike('nome', nomeNormalizado)
      .limit(1);

    if (existingError) {
      setJogadorStatus({
        type: 'error',
        text: `Erro ao validar jogador existente: ${existingError.message}`,
      });
      setIsSavingJogador(false);
      return;
    }

    if ((existingData ?? []).length > 0) {
      setJogadorStatus({
        type: 'error',
        text: 'Este jogador já está cadastrado.',
      });
      setIsSavingJogador(false);
      return;
    }

    const { error: insertError } = await supabase.from('jogadores').insert({
      nome: nomeNormalizado,
    });

    if (insertError) {
      setJogadorStatus({
        type: 'error',
        text: `Erro ao cadastrar jogador: ${insertError.message}`,
      });
      setIsSavingJogador(false);
      return;
    }

    setNomeJogador('');
    setJogadorStatus({
      type: 'success',
      text: 'Jogador cadastrado com sucesso.',
    });
    setIsSavingJogador(false);
  };

  const handleCadastrarEtapa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEtapaStatus(null);

    if (!temporadaId) {
      setEtapaStatus({ type: 'error', text: 'Selecione uma temporada.' });
      return;
    }

    const codigoNormalizado = normalizeCodigoEtapa(codigoEtapa);
    if (!codigoNormalizado) {
      setEtapaStatus({ type: 'error', text: 'Informe o código da etapa.' });
      return;
    }

    if (!dataEtapa) {
      setEtapaStatus({ type: 'error', text: 'Informe a data da rodada.' });
      return;
    }

    setIsSavingEtapa(true);

    const { error: insertError } = await supabase.from('etapas').insert({
      temporada_id: Number(temporadaId),
      codigo_etapa: codigoNormalizado,
      data_etapa: dataEtapa,
    });

    if (insertError) {
      setEtapaStatus({
        type: 'error',
        text: `Erro ao cadastrar etapa: ${insertError.message}`,
      });
      setIsSavingEtapa(false);
      return;
    }

    const temporadaSelecionada = temporadas.find((item) => String(item.id) === temporadaId);
    if (temporadaSelecionada) {
      const { data: etapasDaTemporada } = await supabase
        .from('etapas')
        .select('codigo_etapa')
        .eq('temporada_id', Number(temporadaId));

      const codigosExistentes = ((etapasDaTemporada ?? []) as EtapaCodigoRow[]).map((item) => item.codigo_etapa);
      const proximoCodigo = getNextEtapaCode(temporadaSelecionada.codigo_temporada, codigosExistentes);
      setCodigoEtapa(proximoCodigo);
    } else {
      setCodigoEtapa('');
    }

    setDataEtapa(getTodayDateISO());
    setEtapaStatus({
      type: 'success',
      text: 'Etapa cadastrada com sucesso.',
    });
    setIsSavingEtapa(false);
  };

  const handleCadastrarTemporada = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTemporadaStatus(null);

    const codigoNormalizado = normalizeCodigoTemporada(codigoTemporada);
    if (!codigoNormalizado) {
      setTemporadaStatus({ type: 'error', text: 'Informe o código da temporada.' });
      return;
    }

    if (!dataInicioTemporada) {
      setTemporadaStatus({ type: 'error', text: 'Informe a data de início da temporada.' });
      return;
    }

    setIsSavingTemporada(true);

    const { data: temporadaExistente, error: temporadaExistenteError } = await supabase
      .from('temporadas')
      .select('id')
      .eq('codigo_temporada', codigoNormalizado)
      .maybeSingle();

    if (temporadaExistenteError) {
      setTemporadaStatus({
        type: 'error',
        text: `Erro ao validar temporada existente: ${temporadaExistenteError.message}`,
      });
      setIsSavingTemporada(false);
      return;
    }

    if (temporadaExistente) {
      setTemporadaStatus({
        type: 'error',
        text: 'Esta temporada já está cadastrada.',
      });
      setIsSavingTemporada(false);
      return;
    }

    const { data: insertedData, error: insertError } = await supabase
      .from('temporadas')
      .insert({
        codigo_temporada: codigoNormalizado,
        ativa: temporadaAtiva,
        data_inicio: dataInicioTemporada,
        data_fim: dataFimTemporada || null,
      })
      .select('id')
      .single();

    if (insertError) {
      setTemporadaStatus({
        type: 'error',
        text: `Erro ao cadastrar temporada: ${insertError.message}`,
      });
      setIsSavingTemporada(false);
      return;
    }

    const temporadasResult = await loadTemporadasList();
    if (temporadasResult.error) {
      setTemporadaStatus({
        type: 'error',
        text: `Temporada cadastrada, mas houve erro ao atualizar lista: ${temporadasResult.error.message}`,
      });
    }

    if (insertedData?.id) {
      setTemporadaId(String(insertedData.id));
    }

    setCodigoTemporada('');
    setTemporadaAtiva(true);
    setDataInicioTemporada(getTodayDateISO());
    setDataFimTemporada('');
    setTemporadaStatus({
      type: 'success',
      text: 'Temporada cadastrada com sucesso.',
    });

    setIsSavingTemporada(false);
  };

  return (
    <main className="min-h-[calc(100vh-120px)] bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-6xl">
        <header className="mb-6 rounded-2xl border border-[#244357] bg-[#0c1f2c] px-5 py-4 shadow-[0_8px_22px_rgba(1,4,8,0.28)]">
          <h1 className="text-2xl font-bold text-slate-50">Cadastro</h1>
          <p className="mt-1 text-sm text-slate-300">
            Cadastre novos jogadores e novas etapas do campeonato.
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-3">
          <article className="order-3 rounded-2xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
            <h2 className="text-lg font-semibold text-slate-50">Cadastro de Nova Temporada</h2>
            <p className="mt-1 text-sm text-slate-300">Cadastre uma nova temporada com os campos exigidos.</p>

            <form className="mt-6 space-y-5" onSubmit={handleCadastrarTemporada}>
              <label className="block text-sm font-medium text-slate-200">
                Código da Temporada
                <input
                  type="text"
                  value={codigoTemporada}
                  onChange={(event) => setCodigoTemporada(event.target.value)}
                  placeholder="Ex: 2026-T2"
                  disabled={isSavingTemporada}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-[#ff5e00]"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Data de Início
                <input
                  type="date"
                  value={dataInicioTemporada}
                  onChange={(event) => setDataInicioTemporada(event.target.value)}
                  disabled={isSavingTemporada}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Data de Fim
                <input
                  type="date"
                  value={dataFimTemporada}
                  onChange={(event) => setDataFimTemporada(event.target.value)}
                  disabled={isSavingTemporada}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                />
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <input
                  type="checkbox"
                  checked={temporadaAtiva}
                  onChange={(event) => setTemporadaAtiva(event.target.checked)}
                  disabled={isSavingTemporada}
                  className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                />
                Temporada ativa
              </label>

              {temporadaStatus ? (
                <p
                  className={
                    temporadaStatus?.type === 'success'
                      ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'
                      : 'rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
                  }
                >
                  {temporadaStatus.text}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSavingTemporada}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-[#ff5e00] px-5 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingTemporada ? 'Cadastrando...' : 'Cadastrar Temporada'}
              </button>
            </form>
          </article>

          <article className="order-2 rounded-2xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
            <h2 className="text-lg font-semibold text-slate-50">Cadastro de Novos Jogadores</h2>
            <p className="mt-1 text-sm text-slate-300">
              O nome será salvo em letras maiúsculas e sem duplicidade.
            </p>

            <form className="mt-6 space-y-5" onSubmit={handleCadastrarJogador}>
              <label className="block text-sm font-medium text-slate-200">
                Nome do Jogador
                <input
                  type="text"
                  value={nomeJogador}
                  onChange={(event) => setNomeJogador(event.target.value)}
                  placeholder="Ex: Diego"
                  disabled={isSavingJogador}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-[#ff5e00]"
                  required
                />
              </label>

              {jogadorStatus ? (
                <p
                  className={
                    jogadorStatus?.type === 'success'
                      ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'
                      : 'rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
                  }
                >
                  {jogadorStatus.text}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSavingJogador}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-[#ff5e00] px-5 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingJogador ? 'Cadastrando...' : 'Cadastrar Jogador'}
              </button>
            </form>
          </article>

          <article className="order-1 rounded-2xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
            <h2 className="text-lg font-semibold text-slate-50">Cadastro de Novas Etapas</h2>
            <p className="mt-1 text-sm text-slate-300">
              Associe a etapa à temporada correta e defina a data da rodada.
            </p>

            <form className="mt-6 space-y-5" onSubmit={handleCadastrarEtapa}>
              <label className="block text-sm font-medium text-slate-200">
                Temporada
                <select
                  value={temporadaId}
                  onChange={(event) => setTemporadaId(event.target.value)}
                  disabled={isLoadingTemporadas || isSavingEtapa || !hasTemporadas}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                  required
                >
                  {!hasTemporadas ? <option value="">Nenhuma temporada encontrada</option> : null}
                  {temporadas.map((temporada) => (
                    <option key={temporada.id} value={String(temporada.id)}>
                      {temporada.codigo_temporada}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Código da Etapa
                <input
                  type="text"
                  value={codigoEtapa}
                  onChange={(event) => setCodigoEtapa(event.target.value)}
                  placeholder="Ex: 2026-T1-01"
                  disabled={isSavingEtapa}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-[#ff5e00]"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Data da Rodada
                <input
                  type="date"
                  value={dataEtapa}
                  onChange={(event) => setDataEtapa(event.target.value)}
                  disabled={isSavingEtapa}
                  className="mt-1 h-11 w-full rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                  required
                />
              </label>

              {etapaStatus ? (
                <p
                  className={
                    etapaStatus?.type === 'success'
                      ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200'
                      : 'rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200'
                  }
                >
                  {etapaStatus.text}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSavingEtapa || !hasTemporadas}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-[#ff5e00] px-5 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingEtapa ? 'Cadastrando...' : 'Cadastrar Etapa'}
              </button>
            </form>
          </article>
        </div>
      </section>
    </main>
  );
}
