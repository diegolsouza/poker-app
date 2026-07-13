import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import supabase from '../supabaseClient';

type TipoRegistro = 'jogador' | 'visitante';

type Etapa = {
  id: number;
  codigo_etapa: string;
  data_etapa: string;
};

type Jogador = {
  id: number;
  nome: string;
};

type Configuracao = {
  custo_salao: number;
};

type RegistroFormRow = {
  id: string;
  jogadorId: string;
  tipo: TipoRegistro;
  cozinheiro: boolean;
  jantou: boolean;
  melhorMao: boolean;
  colocacao: string;
  rebuys: string;
  fezAddon: boolean;
  pagouSalao: boolean;
  pagouJanta: string;
  outrosCustos: string;
};

function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseFloatOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number.parseFloat(trimmed.replace(',', '.'));
  return Number.isNaN(parsed) ? null : parsed;
}

function createEmptyRow(): RegistroFormRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    jogadorId: '',
    tipo: 'jogador',
    cozinheiro: false,
    jantou: false,
    melhorMao: false,
    colocacao: '',
    rebuys: '0',
    fezAddon: false,
    pagouSalao: false,
    pagouJanta: '',
    outrosCustos: '',
  };
}

function ensureTrailingEmptyRow(rows: RegistroFormRow[]): RegistroFormRow[] {
  if (rows.length === 0) {
    return [createEmptyRow()];
  }

  const lastRow = rows[rows.length - 1];
  if (lastRow.jogadorId) {
    return [...rows, createEmptyRow()];
  }

  return rows;
}

export default function RegistroResultados() {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [jogadores, setJogadores] = useState<Jogador[]>([]);

  const [etapaId, setEtapaId] = useState('');
  const [custoSalao, setCustoSalao] = useState(0);
  const [rows, setRows] = useState<RegistroFormRow[]>([createEmptyRow()]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      const [etapasResult, jogadoresResult, configuracaoResult] = await Promise.all([
        supabase.from('etapas').select('id, codigo_etapa, data_etapa').order('data_etapa', { ascending: false }),
        supabase.from('jogadores').select('id, nome').eq('ativo', true).order('nome', { ascending: true }),
        supabase.from('configuracoes').select('custo_salao').eq('id', 1).maybeSingle(),
      ]);

      if (etapasResult.error) {
        setError(`Erro ao carregar etapas: ${etapasResult.error.message}`);
      } else {
        const etapasData = (etapasResult.data ?? []) as Etapa[];
        setEtapas(etapasData);

        if (etapasData.length > 0) {
          setEtapaId(String(etapasData[0].id));
        }
      }

      if (jogadoresResult.error) {
        setError(`Erro ao carregar jogadores: ${jogadoresResult.error.message}`);
      } else {
        setJogadores((jogadoresResult.data ?? []) as Jogador[]);
      }

      if (configuracaoResult.error) {
        setError(`Erro ao carregar configurações: ${configuracaoResult.error.message}`);
      } else {
        const configuracao = configuracaoResult.data as Configuracao | null;
        setCustoSalao(Number(configuracao?.custo_salao ?? 0));
      }

      setIsLoading(false);
    };

    void loadData();
  }, []);

  const resetForm = () => {
    setRows([createEmptyRow()]);
  };

  const updateRow = (rowId: string, updater: (row: RegistroFormRow) => RegistroFormRow) => {
    setRows((prev) => {
      const updatedRows = prev.map((row) => (row.id === rowId ? updater(row) : row));
      return ensureTrailingEmptyRow(updatedRows);
    });
  };

  const handleJogadorChange = (rowId: string, jogadorId: string) => {
    updateRow(rowId, (row) => ({ ...row, jogadorId }));
  };

  const handleTipoChange = (rowId: string, tipo: TipoRegistro) => {
    updateRow(rowId, (row) => ({
      ...row,
      tipo,
      colocacao: tipo === 'visitante' ? '' : row.colocacao,
    }));
  };

  const handleCozinheiroChange = (rowId: string, checked: boolean) => {
    updateRow(rowId, (row) => ({
      ...row,
      cozinheiro: checked,
      jantou: checked ? false : row.jantou,
    }));
  };

  const handlePagouSalaoChange = (rowId: string, checked: boolean) => {
    setRows((prev) => {
      const updatedRows = prev.map((row) => {
        if (row.id === rowId) {
          return { ...row, pagouSalao: checked };
        }

        if (checked) {
          return { ...row, pagouSalao: false };
        }

        return row;
      });

      return ensureTrailingEmptyRow(updatedRows);
    });
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => {
      const filtered = prev.filter((row) => row.id !== rowId);
      if (filtered.length === 0) {
        return [createEmptyRow()];
      }

      return ensureTrailingEmptyRow(filtered);
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!etapaId) {
      setError('Selecione a etapa antes de registrar.');
      return;
    }

    const validRows = rows.filter((row) => row.jogadorId);

    if (validRows.length === 0) {
      setError('Preencha ao menos um participante para registrar.');
      return;
    }

    const jogadorIds = validRows.map((row) => row.jogadorId);
    const hasDuplicateJogador = new Set(jogadorIds).size !== jogadorIds.length;
    if (hasDuplicateJogador) {
      setError('Há participantes repetidos na lista. Ajuste antes de salvar.');
      return;
    }

    const qtdPagadoresSalao = validRows.filter((row) => row.pagouSalao).length;
    if (qtdPagadoresSalao > 1) {
      setError('Somente uma pessoa pode pagar o salão por etapa.');
      return;
    }

    setIsSaving(true);

    if (qtdPagadoresSalao === 1) {
      const { data: existentes, error: consultaSalaoError } = await supabase
        .from('registros_etapa')
        .select('id')
        .eq('etapa_id', Number(etapaId))
        .gt('pagou_salao', 0)
        .limit(1);

      if (consultaSalaoError) {
        setError(`Erro ao validar pagamento do salão: ${consultaSalaoError.message}`);
        setIsSaving(false);
        return;
      }

      if ((existentes ?? []).length > 0) {
        setError('Esta etapa já possui um participante marcado como pagador do salão.');
        setIsSaving(false);
        return;
      }
    }

    const payload = validRows.map((row) => ({
      etapa_id: Number(etapaId),
      jogador_id: Number(row.jogadorId),
      tipo_participante: row.tipo,
      jantou: row.cozinheiro ? false : row.jantou,
      cozinheiro: row.cozinheiro,
      melhor_mao: row.melhorMao,
      fez_addon: row.fezAddon,
      colocacao: row.tipo === 'visitante' ? null : parseIntOrNull(row.colocacao),
      rebuys: parseIntOrNull(row.rebuys) ?? 0,
      pagou_salao: row.pagouSalao ? custoSalao : null,
      pagou_janta: parseFloatOrNull(row.pagouJanta),
      outros_custos: parseFloatOrNull(row.outrosCustos),
    }));

    const { error: insertError } = await supabase.from('registros_etapa').insert(payload);

    if (insertError) {
      setError(`Erro ao registrar resultado: ${insertError.message}`);
      setIsSaving(false);
      return;
    }

    setSuccess('Resultado registrado com sucesso.');
    resetForm();
    setIsSaving(false);
  };

  const isDisabled = isLoading || isSaving;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,94,0,0.08),transparent_24%),linear-gradient(180deg,#061019_0%,#07131d_40%,#081723_100%)] py-10 px-4 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-[1500px] rounded-3xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#244357] bg-[#0c1f2c] px-5 py-4 shadow-[0_8px_22px_rgba(1,4,8,0.28)] lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-50">Registro de Resultados de Etapas</h1>
            <p className="mt-1 text-sm text-slate-300">Preencha os dados dos participantes e registre no Supabase.</p>
          </div>

          <label className="flex w-full max-w-sm flex-col gap-1 text-sm text-slate-200">
            Etapa
            <select
              value={etapaId}
              onChange={(event) => setEtapaId(event.target.value)}
              disabled={isDisabled}
              className="h-11 rounded-lg border border-[#244357] bg-[#0b1a25] px-3 text-slate-50 outline-none transition focus:border-[#ff5e00]"
              required
            >
              <option value="">Selecione uma etapa</option>
              {etapas.map((etapa) => (
                <option key={etapa.id} value={etapa.id}>
                  {etapa.codigo_etapa} - {new Date(etapa.data_etapa).toLocaleDateString('pt-BR')}
                </option>
              ))}
            </select>
          </label>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-[#244357] bg-[#0b1a25] p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-sm text-slate-300">Preencha uma linha por participante. Ao selecionar um nome, uma nova linha vazia é criada automaticamente abaixo.</p>
              <span className="text-xs font-medium text-[#ff9a63]">Salão por pagador: R$ {custoSalao.toFixed(2)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1140px] w-full border-collapse text-[11px] leading-tight text-slate-200">
                <thead className="bg-[#102536] text-slate-100">
                  <tr>
                    <th className="w-[140px] px-1 py-1.5 text-left font-semibold">Nome</th>
                    <th className="w-[58px] px-1 py-1.5 text-left font-semibold">Tipo</th>
                    <th className="w-[58px] px-1 py-1.5 text-left font-semibold">Colocação</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Chef</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Jantou</th>
                    <th className="w-[62px] px-1 py-1.5 text-center font-semibold">M. Mão</th>
                    <th className="w-[56px] px-1 py-1.5 text-left font-semibold">Rebuys</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Add On</th>
                    <th className="w-[56px] px-1 py-1.5 text-center font-semibold">Salão</th>
                    <th className="w-[74px] px-1 py-1.5 text-left font-semibold">Pagou Janta</th>
                    <th className="w-[74px] px-1 py-1.5 text-left font-semibold">Outros Custos</th>
                    <th className="w-[46px] px-1 py-1.5 text-center font-semibold">Rem.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[#244357]">
                      <td className="px-1 py-1.5">
                        <select
                          value={row.jogadorId}
                          onChange={(event) => handleJogadorChange(row.id, event.target.value)}
                          disabled={isDisabled}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                        >
                          <option value="">Selecione</option>
                          {jogadores.map((jogador) => (
                            <option key={jogador.id} value={jogador.id}>
                              {jogador.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.tipo}
                          onChange={(event) => handleTipoChange(row.id, event.target.value as TipoRegistro)}
                          disabled={isDisabled}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                        >
                          <option value="jogador">🎯</option>
                          <option value="visitante">👀</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.colocacao}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, colocacao: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId || row.tipo === 'visitante'}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00] disabled:opacity-50"
                        >
                          <option value="">-</option>
                          {Array.from({ length: 9 }, (_, index) => index + 1).map((posicao) => (
                            <option key={posicao} value={posicao}>
                              {posicao}º
                            </option>
                          ))}
                          <option value="10">10º+</option>
                        </select>
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.cozinheiro}
                          onChange={(event) => handleCozinheiroChange(row.id, event.target.checked)}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.jantou}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, jantou: event.target.checked }))}
                          disabled={isDisabled || !row.jogadorId || row.cozinheiro}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.melhorMao}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, melhorMao: event.target.checked }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={row.rebuys}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, rebuys: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.fezAddon}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, fezAddon: event.target.checked }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.pagouSalao}
                          onChange={(event) => handlePagouSalaoChange(row.id, event.target.checked)}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-4 w-4 rounded border-slate-500 bg-[#0b1a25]"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.pagouJanta}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, pagouJanta: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                          placeholder="0,00"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.outrosCustos}
                          onChange={(event) => updateRow(row.id, (current) => ({ ...current, outrosCustos: event.target.value }))}
                          disabled={isDisabled || !row.jogadorId}
                          className="h-9 w-full rounded-lg border border-[#244357] bg-[#081723] px-1.5 text-[10px] text-slate-50 outline-none transition focus:border-[#ff5e00]"
                          placeholder="0,00"
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          disabled={isDisabled || rows.length === 1}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#2d4659] bg-[#102536] text-xs text-slate-200 transition hover:border-rose-400/60 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Remover linha"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
          {success ? <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</p> : null}

          <button
            type="submit"
            disabled={isDisabled}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#ff5e00] px-6 text-sm font-semibold text-white transition hover:bg-[#ff7a2f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Registrando...' : 'Registrar participantes'}
          </button>
        </form>
      </section>
    </main>
  );
}