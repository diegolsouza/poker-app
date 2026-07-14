-- =====================================================
-- SCHEMA DE BANCO DE DADOS - CAMPEONATO DE POKER
-- =====================================================

-- Tabela de Configurações Globais
CREATE TABLE IF NOT EXISTS configuracoes (
    id SERIAL PRIMARY KEY,
    buy_in NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    rebuy NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    add_on NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    custo_salao NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    pontuacao_json JSONB DEFAULT '{}' NOT NULL,
    premiacao_json JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de Jogadores
CREATE TABLE IF NOT EXISTS jogadores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ativo BOOLEAN DEFAULT TRUE,
    CONSTRAINT uk_jogador_nome UNIQUE(nome)
);

-- Tabela de Temporadas
CREATE TABLE IF NOT EXISTS temporadas (
    id SERIAL PRIMARY KEY,
    codigo_temporada VARCHAR(10) NOT NULL,
    ativa BOOLEAN DEFAULT TRUE,
    data_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_fim TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_temporada_codigo UNIQUE(codigo_temporada)
);

-- Tabela de Etapas
CREATE TABLE IF NOT EXISTS etapas (
    id SERIAL PRIMARY KEY,
    temporada_id INTEGER NOT NULL REFERENCES temporadas(id) ON DELETE CASCADE,
    codigo_etapa VARCHAR(20) NOT NULL,
    data_etapa DATE NOT NULL,
    ativa BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_etapa_codigo UNIQUE(codigo_etapa),
    CONSTRAINT fk_etapa_temporada FOREIGN KEY (temporada_id) REFERENCES temporadas(id) ON DELETE CASCADE
);

-- Tabela de Registros por Etapa
CREATE TABLE IF NOT EXISTS registros_etapa (
    id SERIAL PRIMARY KEY,
    etapa_id INTEGER NOT NULL,
    jogador_id INTEGER NOT NULL,
    tipo_participante VARCHAR(20) NOT NULL CHECK (tipo_participante IN ('jogador', 'visitante')),
    jantou BOOLEAN DEFAULT FALSE,
    cozinheiro BOOLEAN DEFAULT FALSE,
    melhor_mao BOOLEAN DEFAULT FALSE,
    colocacao INTEGER,
    rebuys INTEGER DEFAULT 0,
    fez_addon BOOLEAN DEFAULT FALSE,
    pagou_salao NUMERIC(10, 2) DEFAULT 0.00,
    pagou_janta NUMERIC(10, 2) DEFAULT 0.00,
    outros_custos NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_registros_etapa FOREIGN KEY (etapa_id) REFERENCES etapas(id) ON DELETE CASCADE,
    CONSTRAINT fk_registros_jogador FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE RESTRICT,
    CONSTRAINT uk_registro_etapa_jogador UNIQUE(etapa_id, jogador_id)
);

-- Tabela de Pré-jogo por Etapa (sorteio de mesas)
CREATE TABLE IF NOT EXISTS pre_jogo_etapa (
    etapa_id INTEGER PRIMARY KEY REFERENCES etapas(id) ON DELETE CASCADE,
    participant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    tables_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    drawn_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de PINs por Mesa/Etapa
CREATE TABLE IF NOT EXISTS etapa_mesa_pins (
    id SERIAL PRIMARY KEY,
    etapa_id INTEGER NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
    numero_mesa INTEGER NOT NULL CHECK (numero_mesa BETWEEN 1 AND 3),
    pin_codigo VARCHAR(4) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_etapa_mesa_pin UNIQUE(etapa_id, numero_mesa)
);

-- =====================================================
-- ÍNDICES PARA OTIMIZAÇÃO
-- =====================================================

CREATE INDEX idx_etapas_temporada_id ON etapas(temporada_id);
CREATE INDEX idx_etapas_data_etapa ON etapas(data_etapa);
CREATE INDEX idx_registros_etapa_id ON registros_etapa(etapa_id);
CREATE INDEX idx_registros_jogador_id ON registros_etapa(jogador_id);
CREATE INDEX idx_registros_colocacao ON registros_etapa(colocacao);
CREATE INDEX idx_jogadores_ativo ON jogadores(ativo);
CREATE INDEX idx_pre_jogo_updated_at ON pre_jogo_etapa(updated_at);
CREATE INDEX idx_etapa_mesa_pins_etapa_id ON etapa_mesa_pins(etapa_id);

-- =====================================================
-- FUNÇÕES AUXILIARES PARA AUDITORIA
-- =====================================================

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION atualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
CREATE TRIGGER trigger_configuracoes_updated_at
    BEFORE UPDATE ON configuracoes
    FOR EACH ROW
    EXECUTE FUNCTION atualizar_updated_at();

CREATE TRIGGER trigger_registros_etapa_updated_at
    BEFORE UPDATE ON registros_etapa
    FOR EACH ROW
    EXECUTE FUNCTION atualizar_updated_at();

CREATE TRIGGER trigger_pre_jogo_updated_at
    BEFORE UPDATE ON pre_jogo_etapa
    FOR EACH ROW
    EXECUTE FUNCTION atualizar_updated_at();

CREATE TRIGGER trigger_etapa_mesa_pins_updated_at
    BEFORE UPDATE ON etapa_mesa_pins
    FOR EACH ROW
    EXECUTE FUNCTION atualizar_updated_at();

-- =====================================================
-- DADOS INICIAIS DE EXEMPLO
-- =====================================================

-- Inserir configuração padrão
INSERT INTO configuracoes (buy_in, rebuy, add_on, custo_salao, pontuacao_json, premiacao_json)
VALUES (
    50.00,
    50.00,
    50.00,
    20.00,
    '{"1º": 100, "2º": 60, "3º": 40}'::jsonb,
    '{"melhor_mao": 10, "cozinheiro": 5}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Inserir temporada inicial
INSERT INTO temporadas (codigo_temporada, ativa)
VALUES ('2026-T1', TRUE)
ON CONFLICT DO NOTHING;
