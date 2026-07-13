import { useEffect, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import supabase from '../supabaseClient';
import {
  DEFAULT_POINTS_RULES,
  DEFAULT_PRIZE_RULES,
  POSITION_KEYS,
  type PointsRules,
  type PositionKey,
  type PrizeRules,
  buildPointsJson,
  buildPrizeJson,
  parsePointsRules,
  parsePrizeRules,
} from '../utils/tournamentRules';

type ConfiguracaoRow = {
  id: number;
  buy_in: number;
  rebuy: number;
  add_on: number;
  custo_salao: number;
  pontuacao_json: unknown;
  premiacao_json: unknown;
};

function parseMoney(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function toInputString(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function pointsToInputState(rules: PointsRules): Record<PositionKey, string> {
  return POSITION_KEYS.reduce((acc, posicao) => {
    acc[posicao] = toInputString(rules.byPosition[posicao]);
    return acc;
  }, {} as Record<PositionKey, string>);
}

function prizeToInputState(values: number[]): string[] {
  return values.map(toInputString);
}

export default function Configuracoes() {
  const [buyIn, setBuyIn] = useState('30.00');
  const [rebuy, setRebuy] = useState('20.00');
  const [addOn, setAddOn] = useState('20.00');
  const [custoSalao, setCustoSalao] = useState('0.00');

  const [pontosPosicoes, setPontosPosicoes] = useState<Record<PositionKey, string>>(
    pointsToInputState(DEFAULT_POINTS_RULES),
  );
  const [pontoDezOuMais, setPontoDezOuMais] = useState(toInputString(DEFAULT_POINTS_RULES.tenPlus));
  const [bonusMelhorMao, setBonusMelhorMao] = useState(toInputString(DEFAULT_POINTS_RULES.bonusMelhorMao));

  const [premiacaoAte9, setPremiacaoAte9] = useState<string[]>(prizeToInputState(DEFAULT_PRIZE_RULES.ate9));
  const [premiacaoDe9A18, setPremiacaoDe9A18] = useState<string[]>(prizeToInputState(DEFAULT_PRIZE_RULES.de9a18));
  const [premiacaoAcima18, setPremiacaoAcima18] = useState<string[]>(prizeToInputState(DEFAULT_PRIZE_RULES.acima18));

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadConfiguracoes = async () => {
      setIsLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('configuracoes')
        .select('id, buy_in, rebuy, add_on, custo_salao, pontuacao_json, premiacao_json')
        .eq('id', 1)
        .maybeSingle();

      if (queryError) {
        setError(`Erro ao carregar configurações: ${queryError.message}`);
        setIsLoading(false);
        return;
      }

      if (data) {
        const config = data as ConfiguracaoRow;
        setBuyIn(Number(config.buy_in).toFixed(2));
        setRebuy(Number(config.rebuy).toFixed(2));
        setAddOn(Number(config.add_on).toFixed(2));
        setCustoSalao(Number(config.custo_salao).toFixed(2));

        const pointsRules = parsePointsRules(config.pontuacao_json);
        setPontosPosicoes(pointsToInputState(pointsRules));
        setPontoDezOuMais(toInputString(pointsRules.tenPlus));
        setBonusMelhorMao(toInputString(pointsRules.bonusMelhorMao));

        const prizeRules = parsePrizeRules(config.premiacao_json);
        setPremiacaoAte9(prizeToInputState(prizeRules.ate9));
        setPremiacaoDe9A18(prizeToInputState(prizeRules.de9a18));
        setPremiacaoAcima18(prizeToInputState(prizeRules.acima18));
      }

      setIsLoading(false);
    };

    void loadConfiguracoes();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSaving(true);

    const payload = {
      id: 1,
      buy_in: parseMoney(buyIn),
      rebuy: parseMoney(rebuy),
      add_on: parseMoney(addOn),
      custo_salao: parseMoney(custoSalao),
      pontuacao_json: buildPointsJson({
        byPosition: POSITION_KEYS.reduce((acc, posicao) => {
          acc[posicao] = parseMoney(pontosPosicoes[posicao]);
          return acc;
        }, {} as Record<PositionKey, number>),
        tenPlus: parseMoney(pontoDezOuMais),
        bonusMelhorMao: parseMoney(bonusMelhorMao),
      } as PointsRules),
      premiacao_json: buildPrizeJson({
        ate9: premiacaoAte9.map(parseMoney),
        de9a18: premiacaoDe9A18.map(parseMoney),
        acima18: premiacaoAcima18.map(parseMoney),
      } as PrizeRules),
    };

    const { error: upsertError } = await supabase
      .from('configuracoes')
      .upsert(payload, { onConflict: 'id' });

    if (upsertError) {
      setError(`Erro ao salvar configurações: ${upsertError.message}`);
      setIsSaving(false);
      return;
    }

    setSuccess('Configurações salvas com sucesso.');
    setIsSaving(false);
  };

  const isDisabled = isLoading || isSaving;

  const handleUpdatePremiacao = (
    setter: Dispatch<SetStateAction<string[]>>,
    index: number,
    value: string,
  ) => {
    setter((prev) => prev.map((item, idx) => (idx === index ? value : item)));
  };

  const renderPremiacaoGrid = (
    titulo: string,
    valores: string[],
    setter: Dispatch<SetStateAction<string[]>>,
  ) => (
    <article className="rounded-xl border border-[#244357] bg-[#0b1a25] p-4">
      <h3 className="text-sm font-semibold text-slate-100">{titulo}</h3>
      <p className="mt-1 text-xs text-slate-400">Percentual por colocação (1º a 9º)</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {POSITION_KEYS.map((posicao, index) => (
          <label key={posicao} className="text-xs font-medium text-slate-300">
            {posicao}º (%)
            <input
              type="number"
              min={0}
              step="0.01"
              value={valores[index] ?? '0'}
              onChange={(event) => handleUpdatePremiacao(setter, index, event.target.value)}
              disabled={isDisabled}
              className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#081723] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
              required
            />
          </label>
        ))}
      </div>
    </article>
  );

  return (
    <main className="min-h-[calc(100vh-120px)] bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
        <header className="mb-6 rounded-2xl border border-[#244357] bg-[#0c1f2c] px-5 py-4 shadow-[0_8px_22px_rgba(1,4,8,0.28)]">
          <h1 className="text-2xl font-bold text-slate-50">Configurações do Torneio</h1>
          <p className="mt-1 text-sm text-slate-300">
            Defina os parâmetros globais utilizados no campeonato de poker.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-medium text-slate-200">
            Valor do Buy-in
            <div className="mt-1 flex h-11 items-center rounded-lg border border-[#244357] bg-[#0b1a25] px-3 focus-within:border-[#ff5e00]">
              <span className="mr-2 text-sm text-[#ff8d4d]">R$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={buyIn}
                onChange={(event) => setBuyIn(event.target.value)}
                disabled={isDisabled}
                className="w-full bg-transparent text-slate-50 outline-none placeholder:text-slate-500"
                placeholder="30.00"
                required
              />
            </div>
          </label>

          <label className="block text-sm font-medium text-slate-200">
            Valor do Re-buy
            <div className="mt-1 flex h-11 items-center rounded-lg border border-[#244357] bg-[#0b1a25] px-3 focus-within:border-[#ff5e00]">
              <span className="mr-2 text-sm text-[#ff8d4d]">R$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={rebuy}
                onChange={(event) => setRebuy(event.target.value)}
                disabled={isDisabled}
                className="w-full bg-transparent text-slate-50 outline-none placeholder:text-slate-500"
                placeholder="20.00"
                required
              />
            </div>
          </label>

          <label className="block text-sm font-medium text-slate-200">
            Valor do Add-on
            <div className="mt-1 flex h-11 items-center rounded-lg border border-[#244357] bg-[#0b1a25] px-3 focus-within:border-[#ff5e00]">
              <span className="mr-2 text-sm text-[#ff8d4d]">R$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={addOn}
                onChange={(event) => setAddOn(event.target.value)}
                disabled={isDisabled}
                className="w-full bg-transparent text-slate-50 outline-none placeholder:text-slate-500"
                placeholder="20.00"
                required
              />
            </div>
          </label>

          <label className="block text-sm font-medium text-slate-200">
            Custo do Salão de Festas da Rodada
            <div className="mt-1 flex h-11 items-center rounded-lg border border-[#244357] bg-[#0b1a25] px-3 focus-within:border-[#ff5e00]">
              <span className="mr-2 text-sm text-[#ff8d4d]">R$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={custoSalao}
                onChange={(event) => setCustoSalao(event.target.value)}
                disabled={isDisabled}
                className="w-full bg-transparent text-slate-50 outline-none placeholder:text-slate-500"
                placeholder="0.00"
                required
              />
            </div>
          </label>

          <section className="rounded-xl border border-[#244357] bg-[#0b1a25] p-4">
            <h2 className="text-sm font-semibold text-slate-100">Regra de Pontuação</h2>
            <p className="mt-1 text-xs text-slate-400">Defina os pontos de 1º a 9º, 10º+ e bônus da melhor mão.</p>

            <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {POSITION_KEYS.map((posicao) => (
                <label key={posicao} className="text-xs font-medium text-slate-300">
                  {posicao}º
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pontosPosicoes[posicao]}
                    onChange={(event) =>
                      setPontosPosicoes((prev) => ({
                        ...prev,
                        [posicao]: event.target.value,
                      }))
                    }
                    disabled={isDisabled}
                    className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#081723] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                    required
                  />
                </label>
              ))}

              <label className="text-xs font-medium text-slate-300">
                10º+
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={pontoDezOuMais}
                  onChange={(event) => setPontoDezOuMais(event.target.value)}
                  disabled={isDisabled}
                  className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#081723] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                  required
                />
              </label>

              <label className="text-xs font-medium text-slate-300">
                Bônus Melhor Mão
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={bonusMelhorMao}
                  onChange={(event) => setBonusMelhorMao(event.target.value)}
                  disabled={isDisabled}
                  className="mt-1 h-10 w-full rounded-lg border border-[#244357] bg-[#081723] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
                  required
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">Regra de Premiação por Rodada</h2>
            {renderPremiacaoGrid('Até 9 jogadores (1 mesa)', premiacaoAte9, setPremiacaoAte9)}
            {renderPremiacaoGrid('De 9 a 18 jogadores (2 mesas)', premiacaoDe9A18, setPremiacaoDe9A18)}
            {renderPremiacaoGrid('Acima de 18 jogadores (3 mesas)', premiacaoAcima18, setPremiacaoAcima18)}
          </section>

          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
          {success ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</p> : null}

          <button
            type="submit"
            disabled={isDisabled}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#ff5e00] px-5 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </form>
      </section>
    </main>
  );
}
