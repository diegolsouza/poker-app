import { useEffect, useMemo, useState } from 'react';
import supabase from '../supabaseClient';
import {
  DEFAULT_POINTS_RULES,
  DEFAULT_PRIZE_RULES,
  POSITION_KEYS,
  parsePointsRules,
  parsePrizeRules,
  type PointsRules,
  type PrizeRules,
} from '../utils/tournamentRules';

type ConfiguracaoRow = {
  buy_in: number;
  rebuy: number;
  add_on: number;
  custo_salao: number;
  pontuacao_json: unknown;
  premiacao_json: unknown;
};

const TEMPORADA_POR_JOGADOR = 8;
const CAIXINHA_POR_JOGADOR = 2;
const TAXA_NOVO_PARTICIPANTE = 50;
const PIX_PAGAMENTO = 'pokeruplife@gmail.com';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}%`;
}

function buildPrizeItems(values: number[]): string[] {
  return POSITION_KEYS.map((position, index) => {
    const value = values[index] ?? 0;
    return `${position}º: ${formatPercent(value)}`;
  });
}

export default function Regras() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [buyIn, setBuyIn] = useState(30);
  const [rebuy, setRebuy] = useState(20);
  const [addOn, setAddOn] = useState(20);
  const [custoSalao, setCustoSalao] = useState(0);
  const [pointsRules, setPointsRules] = useState<PointsRules>(DEFAULT_POINTS_RULES);
  const [prizeRules, setPrizeRules] = useState<PrizeRules>(DEFAULT_PRIZE_RULES);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);

      const { data, error: queryError } = await supabase
        .from('configuracoes')
        .select('buy_in, rebuy, add_on, custo_salao, pontuacao_json, premiacao_json')
        .eq('id', 1)
        .maybeSingle();

      if (queryError) {
        setError(`Não foi possível carregar configurações: ${queryError.message}`);
        setIsLoading(false);
        return;
      }

      if (data) {
        const config = data as ConfiguracaoRow;
        setBuyIn(Number(config.buy_in ?? 30));
        setRebuy(Number(config.rebuy ?? 20));
        setAddOn(Number(config.add_on ?? 20));
        setCustoSalao(Number(config.custo_salao ?? 0));
        setPointsRules(parsePointsRules(config.pontuacao_json));
        setPrizeRules(parsePrizeRules(config.premiacao_json));
      }

      setIsLoading(false);
    };

    void load();
  }, []);

  const pontosPorColocacao = useMemo(
    () =>
      POSITION_KEYS.map((position) => `${position}º: ${pointsRules.byPosition[position]} ponto(s)`).concat(
        `10º+ : ${pointsRules.tenPlus} ponto(s)`
      ),
    [pointsRules],
  );

  const premiacaoAte9 = useMemo(() => buildPrizeItems(prizeRules.ate9), [prizeRules.ate9]);
  const premiacaoDe9A18 = useMemo(() => buildPrizeItems(prizeRules.de9a18), [prizeRules.de9a18]);
  const premiacaoAcima18 = useMemo(() => buildPrizeItems(prizeRules.acima18), [prizeRules.acima18]);

  const valorBuyIn = formatCurrency(buyIn);
  const valorRebuy = formatCurrency(rebuy);
  const valorAddOn = formatCurrency(addOn);
  const valorSalao = formatCurrency(custoSalao);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1700px] space-y-6">
        <header className="rounded-3xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff8d4d]">Regras</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-100">Regras do Torneio e Operacionais</h1>
          <p className="mt-2 text-sm text-slate-300">
            Guia público com as regras do torneio e as regras operacionais usadas no sistema.
          </p>
        </header>

        {isLoading ? (
          <p className="rounded-xl border border-[#244357] bg-[#081723]/92 px-4 py-3 text-sm text-slate-300">Carregando regras e configurações...</p>
        ) : null}

        {error ? <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}

        <section className="space-y-4 rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <header>
            <h2 className="text-xl font-semibold text-slate-100">Regras Operacionais</h2>
            <p className="mt-1 text-sm text-slate-300">
              Regras de participação, horário e condução da rodada.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Inclusão de Novos Participantes</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Antes de entrar no grupo de WhatsApp, o convidado deve participar de pelo menos 1 jogo.</li>
                <li>Enquanto não entra no grupo, os avisos de data devem ser enviados por quem convidou.</li>
                <li>A primeira participação é de experiência para o jogador testar o formato.</li>
                <li>Na segunda participação, o novo jogador paga taxa única de {formatCurrency(TAXA_NOVO_PARTICIPANTE)}.</li>
                <li>Depois dessa taxa única, não há nova cobrança de adesão nos torneios seguintes.</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Horário e Dinâmica do Jogo</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Quem chegar até 20:00 no salão recebe bônus de 1.000 fichas.</li>
                <li>Buy-in: 4.000 fichas até 22:00 por {valorBuyIn}.</li>
                <li>Entrada após 21:00: o jogador se posiciona antes do dealer e paga blind obrigatório.</li>
                <li>Rebuy: 4.000 fichas por {valorRebuy}, ilimitado, até 22:15.</li>
                <li>Add-on: 5.000 fichas por {valorAddOn}, liberado no encerramento do rebuy (22:15).</li>
                <li>Se cair na última mão antes do fim do rebuy, pode fazer rebuy + add-on juntos (9.000 fichas e custo somado).</li>
                <li>Há intervalo de 20 minutos para janta por volta de 21:30.</li>
                <li>Encerramento: 24:00 + 3 mãos; ao fim da 3ª mão, contam-se fichas para definir colocação final.</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Jantar</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Com cozinheiro, ele pode propor prato especial ou churrasco.</li>
                <li>Sem cozinheiro/prato definido, o grupo decide na hora (normalmente pizza).</li>
                <li>Bebidas: cada participante compra e leva a sua.</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Salão e Pagamentos</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Taxa de reserva do salão (configurada): {valorSalao}.</li>
                <li>Esse valor é dividido pela quantidade de participantes elegíveis no rateio.</li>
                <li>Pagamentos e recebimentos (buy-in, rebuys, rateios e premiação) usam a chave PIX {PIX_PAGAMENTO}.</li>
                <li>Os valores finais seguem a tabela/lista de acerto apresentada ao fim da rodada.</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Regras Financeiras Gerais</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Somente participantes do tipo jogador entram no rateio do salão.</li>
                <li>Somente quem jantou entra no rateio da janta.</li>
                <li><strong>Cozinheiro não paga janta</strong>, mesmo que tenha marcado que jantou.</li>
                <li>Visitante não paga buy-in e não entra no rateio do salão.</li>
                <li>Custos extras informados no registro entram no acerto individual.</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4 md:col-span-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Mesas, Sorteio e Junção</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Quantidade de mesas por participantes: até 9 = 1 mesa; 10 a 18 = 2 mesas; 19+ = 3 mesas.</li>
                <li>Limite máximo: 27 participantes, por capacidade e logística.</li>
                <li>Distribuição inicial de jogadores e posições nas mesas por sorteio com baralho.</li>
                <li>Para 2 mesas: quando restarem 9 jogadores no total, ocorre junção para mesa única.</li>
                <li>Na junção, os lugares são definidos por novo sorteio no mesmo formato das mesas iniciais.</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="space-y-4 rounded-3xl border border-[#244357] bg-[#081723]/92 p-5 shadow-[0_18px_45px_rgba(3,8,14,0.42)]">
          <header>
            <h2 className="text-xl font-semibold text-slate-100">Regras do Torneio</h2>
            <p className="mt-1 text-sm text-slate-300">
              Parâmetros aplicados no sistema para financeiro, pontuação e premiação.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Configurações Atuais da Rodada</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-200">
                <li>Buy-in por jogador: <strong>{valorBuyIn}</strong></li>
                <li>Re-buy (cada): <strong>{valorRebuy}</strong></li>
                <li>Add-on (quando utilizado): <strong>{valorAddOn}</strong></li>
                <li>Custo do salão configurado: <strong>{valorSalao}</strong></li>
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Pontuação por Colocação</h3>
              <ul className="mt-3 space-y-1 text-sm text-slate-200">
                {pontosPorColocacao.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-slate-300">Bônus melhor mão: <strong>{pointsRules.bonusMelhorMao} ponto(s)</strong></p>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Premiação até 9 jogadores</h3>
              <ul className="mt-3 space-y-1 text-sm text-slate-200">
                {premiacaoAte9.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Premiação de 9 a 18 jogadores</h3>
              <ul className="mt-3 space-y-1 text-sm text-slate-200">
                {premiacaoDe9A18.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Premiação acima de 18 jogadores</h3>
              <ul className="mt-3 grid gap-1 text-sm text-slate-200 sm:grid-cols-2 lg:grid-cols-1">
                {premiacaoAcima18.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4 md:col-span-2 lg:col-span-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#ff9a63]">Fórmula de Prêmio da Etapa</h3>
              <p className="mt-3 text-sm text-slate-200">
                Prêmio total da etapa = (jogadores x (buy-in - {TEMPORADA_POR_JOGADOR} - {CAIXINHA_POR_JOGADOR})) +
                (rebuys x rebuy) + (add-ons x add-on).
              </p>
              <p className="mt-2 text-sm text-slate-300">
                Os valores {TEMPORADA_POR_JOGADOR} e {CAIXINHA_POR_JOGADOR} por jogador são abatidos do buy-in para compor os acumulados de temporada e caixinha.
              </p>
            </article>
          </div>
        </section>
      </section>
    </main>
  );
}
