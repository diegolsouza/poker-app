import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  authenticateAdmin,
  hasConfiguredAdminPassword,
  isAdminAuthenticated,
} from '../utils/adminAuth';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();

  const redirectPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('redirect') || '/admin/cadastro-basico';
  }, [location.search]);

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const hasPasswordConfigured = hasConfiguredAdminPassword();
  const adminLoggedIn = isAdminAuthenticated();

  useEffect(() => {
    if (adminLoggedIn) {
      navigate(redirectPath, { replace: true });
    }
  }, [adminLoggedIn, navigate, redirectPath]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const success = authenticateAdmin(password);

    if (!success) {
      setError(
        hasPasswordConfigured
          ? 'Senha inválida. Tente novamente.'
          : 'Senha administrativa não configurada no ambiente.'
      );
      return;
    }

    setError('');
    navigate(redirectPath, { replace: true });
  };

  return (
    <section className="mx-auto flex w-full max-w-md justify-center py-8 sm:py-12">
      <article className="w-full rounded-2xl border border-[#244357] bg-[#081723]/92 p-6 shadow-[0_18px_45px_rgba(3,8,14,0.42)] sm:p-8">
        <header className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff8d4d]">Área administrativa</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">Acesso por senha</h1>
          <p className="mt-2 text-sm text-slate-300">Entre com a senha para acessar Cadastro, Registro de Resultados e Configurações.</p>
        </header>

        {!hasPasswordConfigured ? (
          <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            Defina VITE_ADMIN_PASSWORD no arquivo .env.local e reinicie o app.
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="admin-password" className="text-sm font-medium text-slate-200">
              Senha
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[#2d4659] bg-[#0b1d29] px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#ff7a2f]"
              placeholder="Digite a senha da administração"
              autoComplete="current-password"
              disabled={!hasPasswordConfigured}
              required
            />
          </div>

          {error ? <p className="text-sm font-medium text-rose-400">{error}</p> : null}

          <button
            type="submit"
            disabled={!hasPasswordConfigured}
            className="w-full rounded-xl bg-[#ff5e00] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(255,94,0,0.32)] transition hover:brightness-110"
          >
            Entrar na área administrativa
          </button>
        </form>
      </article>
    </section>
  );
}
