-- =====================================================
-- MASSA DE TESTE: CRIAR + REVERTER
-- =====================================================
-- Uso recomendado (Supabase SQL Editor):
-- 1) Rode o BLOCO A para criar a massa de teste.
-- 2) Teste o fluxo completo no app.
-- 3) Rode o BLOCO B para limpar todos os dados de teste.
--
-- Convenções usadas:
-- - Temporada: TST260714
-- - Etapa: TESTE-E01-20260714
-- - Jogadores: nomes com prefixo "TESTE - "

-- =====================================================
-- BLOCO A: CRIAR MASSA DE TESTE
-- =====================================================
    BEGIN;

    DO $$
    DECLARE
    v_temporada_codigo TEXT := 'TST260714';
    v_etapa_codigo TEXT := 'TESTE-E01-20260714';
    v_temporada_id INTEGER;
    v_has_status BOOLEAN;
    v_has_ativa BOOLEAN;
    BEGIN
    -- Cria/garante a temporada de teste.
    INSERT INTO temporadas (codigo_temporada, ativa)
    VALUES (v_temporada_codigo, TRUE)
    ON CONFLICT (codigo_temporada) DO UPDATE
        SET ativa = EXCLUDED.ativa;

    SELECT id INTO v_temporada_id
    FROM temporadas
    WHERE codigo_temporada = v_temporada_codigo
    LIMIT 1;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'etapas'
        AND column_name = 'status'
    ) INTO v_has_status;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'etapas'
        AND column_name = 'ativa'
    ) INTO v_has_ativa;

    -- Cria/atualiza etapa de teste.
    IF v_has_status AND v_has_ativa THEN
        EXECUTE '
        INSERT INTO etapas (temporada_id, codigo_etapa, data_etapa, ativa, status)
        VALUES ($1, $2, CURRENT_DATE, TRUE, ''pendente'')
        ON CONFLICT (codigo_etapa) DO UPDATE
        SET temporada_id = EXCLUDED.temporada_id,
            data_etapa = EXCLUDED.data_etapa,
            ativa = EXCLUDED.ativa,
            status = EXCLUDED.status
        '
        USING v_temporada_id, v_etapa_codigo;
    ELSIF v_has_status THEN
        EXECUTE '
        INSERT INTO etapas (temporada_id, codigo_etapa, data_etapa, status)
        VALUES ($1, $2, CURRENT_DATE, ''pendente'')
        ON CONFLICT (codigo_etapa) DO UPDATE
        SET temporada_id = EXCLUDED.temporada_id,
            data_etapa = EXCLUDED.data_etapa,
            status = EXCLUDED.status
        '
        USING v_temporada_id, v_etapa_codigo;
    ELSIF v_has_ativa THEN
        EXECUTE '
        INSERT INTO etapas (temporada_id, codigo_etapa, data_etapa, ativa)
        VALUES ($1, $2, CURRENT_DATE, TRUE)
        ON CONFLICT (codigo_etapa) DO UPDATE
        SET temporada_id = EXCLUDED.temporada_id,
            data_etapa = EXCLUDED.data_etapa,
            ativa = EXCLUDED.ativa
        '
        USING v_temporada_id, v_etapa_codigo;
    ELSE
        EXECUTE '
        INSERT INTO etapas (temporada_id, codigo_etapa, data_etapa)
        VALUES ($1, $2, CURRENT_DATE)
        ON CONFLICT (codigo_etapa) DO UPDATE
        SET temporada_id = EXCLUDED.temporada_id,
            data_etapa = EXCLUDED.data_etapa
        '
        USING v_temporada_id, v_etapa_codigo;
    END IF;

    -- Cria jogadores de teste sem duplicar.
    INSERT INTO jogadores (nome, ativo)
    VALUES
        ('TESTE - Ana', TRUE),
        ('TESTE - Bruno', TRUE),
        ('TESTE - Carla', TRUE),
        ('TESTE - Diego', TRUE),
        ('TESTE - Eduardo', TRUE),
        ('TESTE - Fernanda', TRUE),
        ('TESTE - Gustavo', TRUE),
        ('TESTE - Helena', TRUE),
        ('TESTE - Igor', TRUE),
        ('TESTE - Julia', TRUE),
        ('TESTE - Karen', TRUE),
        ('TESTE - Lucas', TRUE)
    ON CONFLICT (nome) DO UPDATE
        SET ativo = EXCLUDED.ativo;
    END $$;

    COMMIT;

    -- Verificacao rapida apos criar:
    SELECT id, codigo_temporada, ativa
    FROM temporadas
    WHERE codigo_temporada = 'TST260714';

    SELECT id, codigo_etapa, data_etapa
    FROM etapas
    WHERE codigo_etapa = 'TESTE-E01-20260714';

    SELECT id, nome, ativo
    FROM jogadores
    WHERE nome LIKE 'TESTE - %'
    ORDER BY nome;


-- =====================================================
-- BLOCO B: REVERTER (APAGAR MASSA DE TESTE)
-- =====================================================
-- Rode este bloco quando terminar seus testes.
-- A ordem importa para preservar dados reais:
-- 1) Apaga a temporada de teste (cascade em etapas e tabelas relacionadas).
-- 2) Apaga apenas jogadores com prefixo TESTE - .

BEGIN;

DELETE FROM temporadas
WHERE codigo_temporada = 'TST260714';

DELETE FROM jogadores
WHERE nome LIKE 'TESTE - %';

COMMIT;

-- Verificacao rapida apos limpar:
SELECT COUNT(*) AS temporadas_teste_restantes
FROM temporadas
WHERE codigo_temporada = 'TST260714';

SELECT COUNT(*) AS jogadores_teste_restantes
FROM jogadores
WHERE nome LIKE 'TESTE - %';
