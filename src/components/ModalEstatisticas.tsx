import { useEffect, useMemo, useState } from 'react';
import supabase from '../supabaseClient';
import { DEFAULT_POINTS_RULES, getPointsByPlacement, parsePointsRules } from '../utils/tournamentRules';

type ModalEstatisticasProps = {
  jogadorId: string;
  isOpen: boolean;
  onClose: () => void;
};

type RegistroHistorico = {
  id: number;
  tipo_participante: 'jogador' | 'visitante';
  colocacao: number | null;
  rebuys: number | null;
  melhor_mao: boolean;
  etapa: {
    id: number;
    codigo_etapa: string;
    temporada: {
      id: number;
      codigo_temporada: string;
    } | null;
  } | null;
};

type RegistroHistoricoRow = {
  id: number;
  tipo_participante: 'jogador' | 'visitante';
  colocacao: number | null;
  rebuys: number | null;
  melhor_mao: boolean;
  etapa:
    | {
        id: number;
        codigo_etapa: string;
        temporada:
          | {
              id: number;
              codigo_temporada: string;
            }
          | {
              id: number;
              codigo_temporada: string;
            }[]
          | null;
      }
    | {
        id: number;
        codigo_etapa: string;
        temporada:
          | {
              id: number;
              codigo_temporada: string;
            }
          | {
              id: number;
              codigo_temporada: string;
            }[]
          | null;
      }[]
    | null;
};

function pickFirst<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function normalizarRegistro(row: RegistroHistoricoRow): RegistroHistorico {
  const etapa = pickFirst(row.etapa);
  const temporada = etapa ? pickFirst(etapa.temporada) : null;

  return {
    id: row.id,
    tipo_participante: row.tipo_participante,
    colocacao: row.colocacao,
    rebuys: row.rebuys,
    melhor_mao: row.melhor_mao,
    etapa: etapa
      ? {
          id: etapa.id,
          codigo_etapa: etapa.codigo_etapa,
          temporada: temporada
            ? {
                id: temporada.id,
                codigo_temporada: temporada.codigo_temporada,
              }
            : null,
        }
      : null,
  };
}

type ResumoTemporada = {
  temporadaId: number;
  nomeTemporada: string;
  pontos: number;
  participacoes: number;
  melhorColocacao: number | null;
};

export default function ModalEstatisticas({ jogadorId, isOpen, onClose }: ModalEstatisticasProps) {
  const [registros, setRegistros] = useState<RegistroHistorico[]>([]);
  const [pointsRules, setPointsRules] = useState(DEFAULT_POINTS_RULES);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const carregarRegras = async () => {
      const { data, error: queryError } = await supabase
        .from('configuracoes')
        .select('pontuacao_json')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!queryError) {
        setPointsRules(parsePointsRules(data?.pontuacao_json));
      }
    };

    void carregarRegras();
  }, []);

  useEffect(() => {
    const carregarHistorico = async () => {
      if (!isOpen) return;

      const jogadorIdNumber = Number(jogadorId);
      if (!jogadorId || Number.isNaN(jogadorIdNumber)) {
        setError('Jogador inválido para consulta de estatísticas.');
        setRegistros([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('registros_etapa')
        .select(
          'id, tipo_participante, colocacao, rebuys, melhor_mao, etapa:etapas!fk_registros_etapa(id, codigo_etapa, temporada:temporadas!fk_etapa_temporada(id, codigo_temporada))',
        )
        .eq('jogador_id', jogadorIdNumber)
        .order('id', { ascending: false });

      if (queryError) {
        setError(`Erro ao carregar histórico do jogador: ${queryError.message}`);
        setRegistros([]);
      } else {
        const registrosNormalizados = ((data ?? []) as RegistroHistoricoRow[]).map(normalizarRegistro);
        setRegistros(registrosNormalizados);
      }

      setIsLoading(false);
    };

    void carregarHistorico();
  }, [isOpen, jogadorId]);

  const estatisticas = useMemo(() => {
    const totalPontos = registros.reduce((acc, item) => {
      const pontosBase = getPointsByPlacement(item.colocacao, pointsRules);
      const bonusMelhorMao = item.melhor_mao ? pointsRules.bonusMelhorMao : 0;
      return acc + pontosBase + bonusMelhorMao;
    }, 0);

    const totalParticipacoes = registros.length;
    const totalRebuys = registros.reduce((acc, item) => acc + (item.rebuys ?? 0), 0);
    const totalMelhorMao = registros.filter((item) => item.melhor_mao).length;
    const totalPodios = registros.filter((item) => item.colocacao !== null && item.colocacao >= 1 && item.colocacao <= 5).length;

    const porTemporadaMap = new Map<number, ResumoTemporada>();

    for (const item of registros) {
      const temporada = item.etapa?.temporada;
      if (!temporada) {
        continue;
      }

      if (!porTemporadaMap.has(temporada.id)) {
        porTemporadaMap.set(temporada.id, {
          temporadaId: temporada.id,
          nomeTemporada: temporada.codigo_temporada,
          pontos: 0,
          participacoes: 0,
          melhorColocacao: null,
        });
      }

      const resumo = porTemporadaMap.get(temporada.id);
      if (!resumo) continue;

      resumo.participacoes += 1;
      resumo.pontos += getPointsByPlacement(item.colocacao, pointsRules);
      if (item.melhor_mao) {
        resumo.pontos += pointsRules.bonusMelhorMao;
      }

      if (item.colocacao !== null) {
        resumo.melhorColocacao = resumo.melhorColocacao === null ? item.colocacao : Math.min(resumo.melhorColocacao, item.colocacao);
      }
    }

    const porTemporada = Array.from(porTemporadaMap.values()).sort((a, b) =>
      b.nomeTemporada.localeCompare(a.nomeTemporada, 'pt-BR'),
    );

    return {
      totalPontos,
      totalParticipacoes,
      totalRebuys,
      totalMelhorMao,
      totalPodios,
      porTemporada,
    };
  }, [pointsRules, registros]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fechar modal"
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label="Estatísticas do jogador"
        className="relative z-10 flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-4 py-3 sm:items-center sm:px-6 sm:py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 sm:text-xl">Histórico Completo do Jogador</h2>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">Dados consolidados de todas as temporadas.</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Fechar"
          >
            X
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-5 sm:p-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-5">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pontos Ganhos</p>
              <p className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{estatisticas.totalPontos}</p>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Participações</p>
              <p className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{estatisticas.totalParticipacoes}</p>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rebuys</p>
              <p className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{estatisticas.totalRebuys}</p>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Melhor Mão</p>
              <p className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{estatisticas.totalMelhorMao}</p>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pódios</p>
              <p className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{estatisticas.totalPodios}</p>
            </article>
          </div>

          {error ? <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          {isLoading ? <p className="text-sm text-slate-500">Carregando histórico...</p> : null}

          <div className="space-y-2 md:hidden">
            {estatisticas.porTemporada.length === 0 ? (
              <p className="rounded-xl border border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                Nenhum registro encontrado para este jogador.
              </p>
            ) : (
              estatisticas.porTemporada.map((item) => (
                <article key={item.temporadaId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">{item.nomeTemporada}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600">
                      Pontos<br />
                      <span className="font-semibold text-slate-900">{item.pontos}</span>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600">
                      Part.<br />
                      <span className="font-semibold text-slate-900">{item.participacoes}</span>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600">
                      Melhor<br />
                      <span className="font-semibold text-slate-900">{item.melhorColocacao ?? '-'}</span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Temporada</th>
                  <th className="px-3 py-3 text-right font-semibold">Pontos</th>
                  <th className="px-3 py-3 text-right font-semibold">Participações</th>
                  <th className="px-3 py-3 text-right font-semibold">Melhor Colocação</th>
                </tr>
              </thead>

              <tbody>
                {estatisticas.porTemporada.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Nenhum registro encontrado para este jogador.
                    </td>
                  </tr>
                ) : (
                  estatisticas.porTemporada.map((item) => (
                    <tr key={item.temporadaId} className="border-t border-slate-100 text-slate-700">
                      <td className="px-3 py-3 font-medium text-slate-900">{item.nomeTemporada}</td>
                      <td className="px-3 py-3 text-right font-semibold">{item.pontos}</td>
                      <td className="px-3 py-3 text-right">{item.participacoes}</td>
                      <td className="px-3 py-3 text-right">{item.melhorColocacao ?? '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="flex justify-end border-t border-slate-200 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
