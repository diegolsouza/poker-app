import { useEffect, useMemo, useRef, useState } from 'react';
import supabase from '../supabaseClient';

// ===================== TIPOS =====================
type TimerStatus = 'stopped' | 'running' | 'paused' | 'interval';

type BlindLevelConfig = {
  bigBlind: number;
  minutes: number;
};

type TimerConfig = {
  blindLevels: BlindLevelConfig[];
  intervalMinutes: number;
  intervalExtraMinutes: number;
};

type BlindLevel = {
  smallBlind: number;
  bigBlind: number;
  minutes: number;
  showAnte: boolean;
};

type TimerState = {
  status: TimerStatus;
  blindLevel: number;
  startedAt: number | null;
  pausedAt: number | null;
  pausedElapsedSeconds: number;
  intervalStartedAt: number | null;
  intervalExtraMinutes: number;
  lastBlindMode: boolean;
  lastBlindStartedAt: number | null;
};

// ===================== CONSTANTES =====================
const DEFAULT_BLIND_LEVELS: BlindLevelConfig[] = [
  { bigBlind: 100, minutes: 20 },
  { bigBlind: 200, minutes: 20 },
  { bigBlind: 300, minutes: 20 },
  { bigBlind: 400, minutes: 20 },
  { bigBlind: 600, minutes: 20 },
  { bigBlind: 800, minutes: 20 },
  { bigBlind: 1200, minutes: 20 },
  { bigBlind: 2000, minutes: 20 },
  { bigBlind: 3000, minutes: 30 },
  { bigBlind: 4000, minutes: 30 },
];

const DEFAULT_TIMER_CONFIG: TimerConfig = {
  blindLevels: DEFAULT_BLIND_LEVELS,
  intervalMinutes: 20,
  intervalExtraMinutes: 10,
};

const LAST_BLIND_DURATION_SECONDS = 15 * 60; // 15 minutos

// ===================== UTILITÁRIOS =====================
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function timestampToMs(isoString: string | null): number | null {
  if (!isoString) return null;
  // Supabase retorna timestamps sem 'Z', causando interpretação como hora local em vez de UTC
  const utcString = isoString.endsWith('Z') || isoString.includes('+') ? isoString : `${isoString}Z`;
  return new Date(utcString).getTime();
}

// ===================== COMPONENTE PRINCIPAL =====================
interface PokerTimerProps {
  etapaId: number;
  isAdmin: boolean;
  isMesarioUnlocked: boolean;
  forcedPanelMode?: boolean;
}

export default function PokerTimer({ etapaId, isAdmin, isMesarioUnlocked, forcedPanelMode = false }: PokerTimerProps) {
  const [timerState, setTimerState] = useState<TimerState>({
    status: 'stopped',
    blindLevel: 0,
    startedAt: null,
    pausedAt: null,
    pausedElapsedSeconds: 0,
    intervalStartedAt: null,
    intervalExtraMinutes: 0,
    lastBlindMode: false,
    lastBlindStartedAt: null,
  });

  const [isMaximized, setIsMaximized] = useState(forcedPanelMode);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [timerConfig, setTimerConfig] = useState<TimerConfig>(DEFAULT_TIMER_CONFIG);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<number>(0);
  const serverTimeOffsetRef = useRef<number>(0);
  const autoAdvancedForLevelRef = useRef<number | null>(null);
  const prevBlindLevelRef = useRef<number>(-1);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  // Gerar blind levels dinamicamente baseado na configuração carregada
  const blindLevels: BlindLevel[] = useMemo(() => {
    return timerConfig.blindLevels.map((config, index) => ({
      smallBlind: Math.floor(config.bigBlind / 2),
      bigBlind: config.bigBlind,
      minutes: config.minutes,
      showAnte: index >= 4, // ANTE em jogo a partir do nível 5 (índice 4)
    }));
  }, [timerConfig]);

  const canControl = isAdmin || isMesarioUnlocked;
  const serverNow = () => Date.now() + serverTimeOffsetRef.current;

  // Ocultar timer nas páginas públicas até que seja iniciado (a menos que esteja em modo painel forçado)
  const showTimer = forcedPanelMode || timerState.status !== 'stopped' || isAdmin || isMesarioUnlocked;

  // ============ CARREGAR CONFIGURAÇÃO DO TIMER ============
  const loadTimerConfig = async () => {
    try {
      const { data, error: loadError } = await supabase
        .from('configuracoes')
        .select('timer_config_json')
        .eq('id', 1)
        .maybeSingle();

      if (loadError) {
        console.error('Erro ao carregar config do timer:', loadError.message);
        return;
      }

      if (data && data.timer_config_json) {
        const config = data.timer_config_json as TimerConfig;
        if (config.blindLevels && Array.isArray(config.blindLevels) && config.blindLevels.length > 0) {
          setTimerConfig(config);
        }
      }
    } catch (err) {
      console.error('Erro ao processar config do timer:', err);
    }
  };

  // ============ CARREGAMENTO INICIAL E SINCRONIZAÇÃO ============
  const loadTimerState = async () => {
    try {
      const { data, error: loadError } = await supabase
        .from('poker_timer_etapa')
        .select('*')
        .eq('etapa_id', etapaId)
        .maybeSingle();

      if (loadError) {
        console.error('Erro de Supabase ao carregar timer:', loadError.message, loadError.code);
        throw loadError;
      }

      if (data) {
        setTimerState({
          status: (data.status as TimerStatus) || 'stopped',
          blindLevel: data.blind_level || 0,
          startedAt: timestampToMs(data.started_at),
          pausedAt: timestampToMs(data.paused_at),
          pausedElapsedSeconds: data.paused_elapsed_seconds || 0,
          intervalStartedAt: timestampToMs(data.interval_started_at),
          intervalExtraMinutes: data.interval_extra_minutes || 0,
          lastBlindMode: data.last_blind_mode || false,
          lastBlindStartedAt: timestampToMs(data.last_blind_started_at),
        });
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Erro ao carregar estado do timer:', err);
    }
  };

  useEffect(() => {
    void loadTimerState();
  }, [etapaId]);

  // Carregar configuração do timer uma vez ao inicializar
  useEffect(() => {
    void loadTimerConfig();
  }, []);

  // Sincronizar horário com o servidor uma vez ao montar (corrige diferença de relógio entre dispositivos)
  useEffect(() => {
    const syncServerTime = async () => {
      const localBefore = Date.now();
      const { data } = await supabase.rpc('get_server_time');
      const localAfter = Date.now();
      if (data != null) {
        const serverTimeMs = Number(data);
        const networkLatency = (localAfter - localBefore) / 2;
        serverTimeOffsetRef.current = serverTimeMs - localBefore - networkLatency;
      }
    };
    void syncServerTime();
  }, []);

  // Sincronizar estado a cada 1 segundo para tempo real
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      const now = Date.now();
      if (now - lastSyncRef.current > 1000) {
        lastSyncRef.current = now;
        void loadTimerState();
      }
    }, 1000);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [etapaId]);

  // Sincronizar forcedPanelMode com isMaximized
  useEffect(() => {
    setIsMaximized(forcedPanelMode);
  }, [forcedPanelMode]);

  // ============ TICK DO TIMER ============
  useEffect(() => {
    timerIntervalRef.current = setInterval(() => {
      setCurrentTime(Date.now() + serverTimeOffsetRef.current);
    }, 100);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // ============ SALVAMENTO NO BANCO ============
  const saveTimerState = async (newState: TimerState) => {
    try {
      const payload = {
        etapa_id: etapaId,
        status: newState.status,
        blind_level: newState.blindLevel,
        started_at: newState.startedAt ? new Date(newState.startedAt).toISOString() : null,
        paused_at: newState.pausedAt ? new Date(newState.pausedAt).toISOString() : null,
        paused_elapsed_seconds: newState.pausedElapsedSeconds,
        interval_started_at: newState.intervalStartedAt ? new Date(newState.intervalStartedAt).toISOString() : null,
        interval_extra_minutes: newState.intervalExtraMinutes,
        last_blind_mode: newState.lastBlindMode,
        last_blind_started_at: newState.lastBlindStartedAt ? new Date(newState.lastBlindStartedAt).toISOString() : null,
      };

      console.log('Payload para salvar:', payload);

      // Tentar fazer update primeiro
      const { data: updateData, error: updateError } = await supabase
        .from('poker_timer_etapa')
        .update(payload)
        .eq('etapa_id', etapaId)
        .select();

      if (updateError) {
        console.error('Erro de update no Supabase:', updateError.message, updateError.code);
        throw updateError;
      }

      // Se nenhuma linha foi atualizada, inserir
      if (updateData && updateData.length === 0) {
        console.log('Nenhuma linha atualizada, tentando inserir...');
        const { data: insertData, error: insertError } = await supabase
          .from('poker_timer_etapa')
          .insert([payload])
          .select();

        if (insertError) {
          console.error('Erro de insert no Supabase:', insertError.message, insertError.code);
          throw insertError;
        }

        console.log('Insert realizado com sucesso:', insertData);
      } else {
        console.log('Update realizado com sucesso:', updateData);
      }

      setTimerState(newState);
      setError(null);
    } catch (err: any) {
      console.error('Erro completo ao salvar timer:', err);
      console.error('Mensagem:', err?.message);
      console.error('Código:', err?.code);
      setError(`Erro ao salvar timer: ${err?.message || 'desconhecido'}`);
    }
  };

  // ============ CÁLCULOS DE TEMPO ============
  const getElapsedSeconds = (): number => {
    if (timerState.status === 'stopped') return 0;

    if (timerState.status === 'paused') {
      return timerState.pausedElapsedSeconds;
    }

    if (timerState.status === 'interval' && timerState.intervalStartedAt) {
      const elapsed = Math.floor((currentTime - timerState.intervalStartedAt) / 1000);
      return elapsed;
    }

    if (timerState.status === 'running') {
      if (timerState.lastBlindMode && timerState.lastBlindStartedAt) {
        return Math.floor((currentTime - timerState.lastBlindStartedAt) / 1000);
      }

      if (timerState.startedAt) {
        const elapsed = timerState.pausedElapsedSeconds + Math.floor((currentTime - timerState.startedAt) / 1000);
        return elapsed;
      }
    }

    return 0;
  };

  const currentBlind = useMemo(() => blindLevels[timerState.blindLevel] || blindLevels[0], [timerState.blindLevel, blindLevels]);

  const { remainingSeconds, isLastMinute } = useMemo(() => {
    const elapsed = getElapsedSeconds();

    if (timerState.status === 'interval') {
      const totalIntervalSeconds = (timerConfig.intervalMinutes + timerState.intervalExtraMinutes) * 60;
      const remaining = Math.max(0, totalIntervalSeconds - elapsed);
      return { remainingSeconds: remaining, isLastMinute: remaining < 60 };
    }

    if (timerState.lastBlindMode) {
      const remaining = Math.max(0, LAST_BLIND_DURATION_SECONDS - elapsed);
      return { remainingSeconds: remaining, isLastMinute: true };
    }

    const levelDurationSeconds = currentBlind.minutes * 60;
    const remaining = Math.max(0, levelDurationSeconds - elapsed);
    return { remainingSeconds: remaining, isLastMinute: remaining < 60 };
  }, [timerState, currentBlind, getElapsedSeconds, timerConfig]);

  // ============ CONTROLES ============
  const handleStart = async () => {
    if (!canControl) return;

    const newState: TimerState = {
      status: 'running',
      blindLevel: timerState.blindLevel,
      startedAt: serverNow(),
      pausedAt: null,
      pausedElapsedSeconds: 0,
      intervalStartedAt: null,
      intervalExtraMinutes: 0,
      lastBlindMode: false,
      lastBlindStartedAt: null,
    };

    await saveTimerState(newState);
  };

  const handlePause = async () => {
    if (!canControl) return;

    if (timerState.status === 'running') {
      const newState: TimerState = {
        ...timerState,
        status: 'paused',
        pausedAt: serverNow(),
        pausedElapsedSeconds: getElapsedSeconds(),
      };

      await saveTimerState(newState);
    } else if (timerState.status === 'paused') {
      const newState: TimerState = {
        ...timerState,
        status: 'running',
        startedAt: serverNow(),
        pausedAt: null,
        // pausedElapsedSeconds mantido: será somado ao elapsed desde startedAt
      };

      await saveTimerState(newState);
    }
  };

  const handleInterval = async () => {
    if (!canControl) return;

    const newState: TimerState = {
      ...timerState,
      status: 'interval',
      intervalStartedAt: serverNow(),
      intervalExtraMinutes: 0,
      pausedElapsedSeconds: getElapsedSeconds(),
    };

    await saveTimerState(newState);
  };

  const handleEndInterval = async () => {
    if (!canControl) return;

    // Retorna ao mesmo blind de onde parou antes do intervalo
    const newState: TimerState = {
      ...timerState,
      status: 'running',
      startedAt: serverNow(),
      pausedAt: null,
      // pausedElapsedSeconds: mantido do spread (salvo ao entrar no intervalo)
      intervalStartedAt: null,
      intervalExtraMinutes: 0,
    };

    await saveTimerState(newState);
  };

  const handleAddSeconds = async (seconds: number) => {
    if (!canControl) return;

    let newElapsed = getElapsedSeconds() + seconds;
    if (newElapsed < 0) newElapsed = 0;

    const levelDurationSeconds = currentBlind.minutes * 60;
    if (timerState.lastBlindMode) {
      if (newElapsed > LAST_BLIND_DURATION_SECONDS) {
        newElapsed = LAST_BLIND_DURATION_SECONDS;
      }
    } else {
      if (newElapsed > levelDurationSeconds) {
        newElapsed = 0;
        let nextBlindLevel = timerState.blindLevel + 1;
        if (nextBlindLevel >= blindLevels.length) {
          nextBlindLevel = blindLevels.length - 1;
        }

        const newState: TimerState = {
          status: 'running',
          blindLevel: nextBlindLevel,
          startedAt: serverNow(),
          pausedAt: null,
          pausedElapsedSeconds: 0,
          intervalStartedAt: null,
          intervalExtraMinutes: 0,
          lastBlindMode: nextBlindLevel >= blindLevels.length - 1,
          lastBlindStartedAt: nextBlindLevel >= blindLevels.length - 1 ? serverNow() : null,
        };
        await saveTimerState(newState);
        return;
      }
    }

    if (timerState.status === 'running') {
      const newState: TimerState = {
        ...timerState,
        startedAt: serverNow() - newElapsed * 1000,
        pausedElapsedSeconds: 0,
      };
      await saveTimerState(newState);
    } else if (timerState.status === 'paused') {
      const newState: TimerState = {
        ...timerState,
        pausedElapsedSeconds: newElapsed,
      };
      await saveTimerState(newState);
    }
  };

  const handleNextBlind = async () => {
    if (!canControl) return;

    let nextBlindLevel = timerState.blindLevel + 1;

    if (nextBlindLevel >= blindLevels.length) {
      nextBlindLevel = blindLevels.length - 1;
    }

    const newState: TimerState = {
      ...timerState,
      blindLevel: nextBlindLevel,
      startedAt: serverNow(),
      pausedElapsedSeconds: 0,
      intervalStartedAt: null,
      intervalExtraMinutes: 0,
      lastBlindMode: false,
      lastBlindStartedAt: null,
    };

    if (timerState.status === 'stopped') {
      newState.status = 'running';
    }

    await saveTimerState(newState);
  };

  const handleReset = async () => {
    if (!canControl) return;

    const newState: TimerState = {
      status: 'stopped',
      blindLevel: 0,
      startedAt: null,
      pausedAt: null,
      pausedElapsedSeconds: 0,
      intervalStartedAt: null,
      intervalExtraMinutes: 0,
      lastBlindMode: false,
      lastBlindStartedAt: null,
    };

    await saveTimerState(newState);
  };

  // ============ AUTO-AVANÇO DE BLIND ============
  useEffect(() => {
    if (
      canControl &&
      timerState.status === 'running' &&
      !timerState.lastBlindMode &&
      remainingSeconds <= 0 &&
      autoAdvancedForLevelRef.current !== timerState.blindLevel
    ) {
      autoAdvancedForLevelRef.current = timerState.blindLevel;
      void handleNextBlind();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds, timerState.status, timerState.blindLevel, timerState.lastBlindMode, canControl]);

  // ============ FLASH AO MUDAR DE BLIND ============
  useEffect(() => {
    if (prevBlindLevelRef.current !== -1 && timerState.blindLevel !== prevBlindLevelRef.current && isMaximized) {
      setIsFlashing(true);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        setIsFlashing(false);
      }, 3000);
    }
    prevBlindLevelRef.current = timerState.blindLevel;
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [timerState.blindLevel, isMaximized]);

  // ============ RENDERIZAÇÃO ============
  const timerDisplay = formatTime(remainingSeconds);

  // Ocultar timer nas páginas públicas até iniciar
  if (!showTimer) {
    return null;
  }

  const timerContent = (
    <div className="grid gap-4">
      {/* Título e info de blind */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-slate-100">⏱️ Timer de Poker</h3>
          {currentBlind.showAnte && (
            <span className="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-bold text-red-200 uppercase">
              🎰 ANTE EM JOGO
            </span>
          )}
        </div>
        {canControl && !isMaximized && (
          <button
            type="button"
            onClick={() => setIsMaximized(true)}
            className="rounded-lg bg-[#ff5e00]/20 px-3 py-1 text-xs font-semibold text-[#ff8d4d] hover:bg-[#ff5e00]/30"
          >
            ⛶ Maximizar
          </button>
        )}
      </div>

      {/* Status do intervalo */}
      {timerState.status === 'interval' && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-center">
          <p className="text-sm font-semibold text-red-200">INTERVALO</p>
          {timerState.intervalExtraMinutes > 0 && (
            <p className="text-xs text-red-300 mt-1">+{timerState.intervalExtraMinutes} min(s) de acréscimo</p>
          )}
        </div>
      )}

      {/* Modo últimas 3 mãos */}
      {timerState.lastBlindMode && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-center animate-pulse">
          <p className="text-lg font-bold text-yellow-200">⚠️ ÚLTIMAS 3 MÃOS</p>
        </div>
      )}

      {/* Blinds */}
      <div className="flex items-center justify-between rounded-lg bg-[#1b3e52]/50 p-6">
        <div className="text-center">
          <p className="text-base text-slate-300 font-semibold">Small Blind</p>
          <p className="text-6xl font-bold text-emerald-400">{currentBlind.smallBlind}</p>
        </div>
        <div className="h-16 border-l-2 border-[#2d4659]" />
        <div className="text-center">
          <p className="text-base text-slate-300 font-semibold">Big Blind</p>
          <p className="text-6xl font-bold text-emerald-400">{currentBlind.bigBlind}</p>
        </div>
      </div>

      {/* Timer gigante */}
      <div className={[
        'rounded-lg p-8 text-center font-mono font-bold',
        timerState.status === 'interval'
          ? 'bg-red-500/20 border-2 border-red-500/40'
          : isLastMinute
            ? 'bg-yellow-500/20 border-2 border-yellow-500/40'
            : 'bg-[#1b3e52]/50 border-2 border-[#2d4659]',
      ].join(' ')}>
        <p className="text-6xl sm:text-7xl tabular-nums text-slate-100">{timerDisplay}</p>
      </div>

      {/* Status do timer */}
      {timerState.status !== 'stopped' && (
        <p className="text-center text-xs text-slate-400">
          Status: {timerState.status === 'running' ? '▶️ Rodando' : timerState.status === 'paused' ? '⏸️ Pausado' : timerState.status === 'interval' ? '🔴 Intervalo' : 'Parado'}
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-2 text-xs text-rose-200">{error}</p>
      )}

      {/* Controles (apenas para admin/mesário) */}
      {canControl && (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={handleStart}
              disabled={timerState.status === 'running'}
              className={[
                'rounded-lg px-4 py-2 text-sm font-semibold transition',
                timerState.status === 'running'
                  ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400',
              ].join(' ')}
            >
              ▶️ Iniciar
            </button>

            <button
              type="button"
              onClick={handlePause}
              disabled={timerState.status === 'stopped' || timerState.status === 'interval'}
              className={[
                'rounded-lg px-4 py-2 text-sm font-semibold transition',
                timerState.status === 'stopped' || timerState.status === 'interval'
                  ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                  : timerState.status === 'running'
                    ? 'bg-yellow-500 text-yellow-950 hover:bg-yellow-400'
                    : 'bg-blue-500 text-blue-950 hover:bg-blue-400',
              ].join(' ')}
            >
              {timerState.status === 'running' ? '⏸️ Pausar' : '▶️ Retomar'}
            </button>

            <button
              type="button"
              onClick={handleInterval}
              disabled={timerState.status !== 'running'}
              className={[
                'rounded-lg px-4 py-2 text-sm font-semibold transition',
                timerState.status !== 'running'
                  ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                  : 'bg-orange-500 text-orange-950 hover:bg-orange-400',
              ].join(' ')}
            >
              🔴 Intervalo
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={timerState.status === 'stopped'}
              className={[
                'rounded-lg px-4 py-2 text-sm font-semibold transition',
                timerState.status === 'stopped'
                  ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                  : 'bg-rose-500 text-rose-950 hover:bg-rose-400',
              ].join(' ')}
            >
              🔄 Reset
            </button>
          </div>

          {/* Controles secundários */}
          {timerState.status === 'interval' && (
            <button
              type="button"
              onClick={handleEndInterval}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:bg-blue-500"
            >
              ✓ Fim do Intervalo
            </button>
          )}

          {!timerState.lastBlindMode && timerState.blindLevel < blindLevels.length - 1 && timerState.status === 'running' && (
            <button
              type="button"
              onClick={handleNextBlind}
              className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-violet-50 transition hover:bg-violet-500"
            >
              ⏭️ Próximo Blind
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleAddSeconds(30)}
              className="rounded-lg px-4 py-2 text-sm font-semibold bg-violet-600 text-violet-50 hover:bg-violet-500 transition"
            >
              ⏱️ +30s
            </button>
            <button
              type="button"
              onClick={() => void handleAddSeconds(-30)}
              className="rounded-lg px-4 py-2 text-sm font-semibold bg-violet-600 text-violet-50 hover:bg-violet-500 transition"
            >
              ⏱️ -30s
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ============ MODO MAXIMIZADO ============
  if (isMaximized) {
    const timerDisplayMaximized = formatTime(remainingSeconds);
    const currentBlindMaximized = blindLevels[timerState.blindLevel] || blindLevels[0];
    
    return (
      <div className={['fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 p-8 transition-colors duration-500', timerState.status === 'running' ? 'bg-green-950' : timerState.status === 'interval' ? 'bg-red-950' : 'bg-black'].join(' ')}>
        <button
          type="button"
          onClick={() => setIsMaximized(false)}
          className="absolute top-6 right-6 rounded-lg bg-slate-700 px-6 py-3 text-lg font-semibold text-slate-100 transition hover:bg-slate-600"
        >
          {forcedPanelMode ? '⬇️ Minimizar' : '✕ Sair'}
        </button>

        <div className={['w-full h-full flex flex-col items-center justify-center gap-12', isFlashing ? 'animate-blind-flash' : ''].join(' ')}>
          {/* Aviso ANTE EM JOGO */}
          {currentBlindMaximized.showAnte && (
            <div className="animate-pulse rounded-3xl bg-gradient-to-r from-red-600 via-yellow-600 to-red-600 p-8 w-full max-w-5xl border-4 border-red-400 shadow-[0_0_50px_rgba(220,38,38,0.6)]">
              <p className="text-8xl font-black text-white drop-shadow-lg">⚠️ ANTE EM JOGO! ⚠️</p>
            </div>
          )}

          {/* Blinds Gigante */}
          <div className="flex items-center justify-between gap-16 rounded-2xl bg-[#1b3e52]/70 p-12 w-full max-w-5xl">
            <div className="text-center flex-1">
              <p className="text-4xl text-slate-300 font-semibold mb-4">Small Blind</p>
              <p className="text-[14rem] leading-none font-black text-emerald-400 drop-shadow-lg">{currentBlindMaximized.smallBlind}</p>
            </div>
            <div className="h-40 border-l-4 border-[#2d4659]" />
            <div className="text-center flex-1">
              <p className="text-4xl text-slate-300 font-semibold mb-4">Big Blind</p>
              <p className="text-[14rem] leading-none font-black text-emerald-400 drop-shadow-lg">{currentBlindMaximized.bigBlind}</p>
            </div>
          </div>

          {/* Timer Gigante */}
          <div className={[
            'rounded-3xl p-16 text-center font-mono font-bold w-full max-w-5xl',
            timerState.status === 'interval'
              ? 'bg-red-500/30 border-4 border-red-500/50'
              : isLastMinute
                ? 'bg-yellow-500/30 border-4 border-yellow-500/50'
                : 'bg-[#1b3e52]/70 border-4 border-[#2d4659]',
          ].join(' ')}>
            <p className="text-9xl tabular-nums text-slate-100">{timerDisplayMaximized}</p>
          </div>

          {/* Controles em modo maximizado */}
          {canControl && (
            <>
              <div className="grid grid-cols-4 gap-4 w-full max-w-5xl">
              <button
                type="button"
                onClick={handleStart}
                disabled={timerState.status === 'running'}
                className={[
                  'rounded-xl px-6 py-4 text-lg font-semibold transition',
                  timerState.status === 'running'
                    ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400',
                ].join(' ')}
              >
                ▶️ Iniciar
              </button>

              <button
                type="button"
                onClick={handlePause}
                disabled={timerState.status === 'stopped' || timerState.status === 'interval'}
                className={[
                  'rounded-xl px-6 py-4 text-lg font-semibold transition',
                  timerState.status === 'stopped' || timerState.status === 'interval'
                    ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                    : timerState.status === 'running'
                      ? 'bg-yellow-500 text-yellow-950 hover:bg-yellow-400'
                      : 'bg-blue-500 text-blue-950 hover:bg-blue-400',
                ].join(' ')}
              >
                {timerState.status === 'running' ? '⏸️ Pausar' : '▶️ Retomar'}
              </button>

              <button
                type="button"
                onClick={handleInterval}
                disabled={timerState.status !== 'running'}
                className={[
                  'rounded-xl px-6 py-4 text-lg font-semibold transition',
                  timerState.status !== 'running'
                    ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                    : 'bg-orange-500 text-orange-950 hover:bg-orange-400',
                ].join(' ')}
              >
                🔴 Intervalo
              </button>

              <button
                type="button"
                onClick={handleReset}
                disabled={timerState.status === 'stopped'}
                className={[
                  'rounded-xl px-6 py-4 text-lg font-semibold transition',
                  timerState.status === 'stopped'
                    ? 'bg-slate-600/40 text-slate-400 cursor-not-allowed'
                    : 'bg-rose-500 text-rose-950 hover:bg-rose-400',
                ].join(' ')}
              >
                🔄 Reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 w-full max-w-5xl">
              <button
                type="button"
                onClick={() => void handleAddSeconds(30)}
                className="rounded-xl px-6 py-4 text-lg font-semibold bg-violet-600 text-violet-50 hover:bg-violet-500 transition"
              >
                ⏱️ +30s
              </button>
              <button
                type="button"
                onClick={() => void handleAddSeconds(-30)}
                className="rounded-xl px-6 py-4 text-lg font-semibold bg-violet-600 text-violet-50 hover:bg-violet-500 transition"
              >
                ⏱️ -30s
              </button>
            </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ============ MODO NORMAL ============
  return (
    <div className="rounded-2xl border border-[#2d4659]/70 bg-[#0d2431]/80 p-5 shadow-[0_14px_34px_rgba(0,0,0,0.35)]">
      {timerContent}
    </div>
  );
}
