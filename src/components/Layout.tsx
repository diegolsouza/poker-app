import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';
import { isAdminAuthenticated, logoutAdmin } from '../utils/adminAuth';

const publicNavItems = [
  { label: 'Pré-jogo', to: '/pre-jogo' },
  { label: 'Dia de Poker', to: '/dia-de-poker' },
  { label: 'Ranking', to: '/' },
  { label: 'Financeiro', to: '/financeiro' },
  { label: 'Premiação Final', to: '/premiacao-final' },
  { label: 'Regras', to: '/regras' },
];

const adminVisibleNavItems = [
  { label: 'Pré-jogo', to: '/pre-jogo' },
  { label: 'Dia de Poker', to: '/admin/dia-de-poker' },
  { label: 'Cadastro', to: '/admin/cadastro-basico' },
  { label: 'Resultados', to: '/admin/resultados' },
  { label: 'Regras', to: '/regras' },
  { label: 'Configurações', to: '/admin/configuracoes' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminLoggedIn = isAdminAuthenticated();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const visibleCommonNavItems = adminLoggedIn ? adminVisibleNavItems : publicNavItems;

  // Accessing pathname makes this component re-evaluate auth on route changes.
  void location.pathname;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logoutAdmin();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#07131d] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-[#2d4659]/70 bg-[#081722]/92 backdrop-blur-md shadow-[0_14px_40px_rgba(3,8,14,0.45)]">
        <div className="pointer-events-none absolute inset-0 opacity-80">
          <div className="h-full w-full bg-[radial-gradient(circle_at_15%_20%,rgba(255,94,0,0.16),transparent_28%),radial-gradient(circle_at_85%_0%,rgba(8,68,95,0.34),transparent_35%),linear-gradient(120deg,rgba(8,23,34,0.96),rgba(5,13,20,0.99))]" />
          <div className="h-full w-full bg-[linear-gradient(115deg,transparent_0%,transparent_37%,rgba(255,94,0,0.09)_50%,transparent_63%,transparent_100%)]" />
        </div>

        <div className="relative mx-auto w-full max-w-[1700px] px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <img
              src={logo}
              alt="Poker Uplife"
              className="h-11 w-auto drop-shadow-[0_6px_12px_rgba(255,94,0,0.18)]"
            />

            <button
              type="button"
              onClick={() => setMobileMenuOpen((current) => !current)}
              aria-expanded={mobileMenuOpen}
              aria-label="Alternar menu"
              className="rounded-full border border-[#2d4659]/70 bg-[#0d2431]/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200"
            >
              {mobileMenuOpen ? 'Fechar' : 'Menu'}
            </button>
          </div>

          <div className="mt-3 hidden items-center justify-between gap-6 lg:flex">
            <div className="flex items-center gap-4">
              <img
                src={logo}
                alt="Poker Uplife"
                className="h-14 w-auto drop-shadow-[0_6px_12px_rgba(255,94,0,0.18)] sm:h-16"
              />
              <div className="hidden sm:block">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#ff8d4d]">gerenciador de torneio</p>
                <p className="mt-1 text-sm text-slate-300">Controle de cadastro, ranking e financeiro</p>
              </div>
            </div>

            <a
              href="https://open.spotify.com/playlist/5wg2fqy0ZBF8PW1yemdLLN?si=8122474bdc5e4c48"
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir playlist no Spotify"
              className="inline-flex items-center gap-2 rounded-full border border-[#1db954]/45 bg-[#1db954]/10 px-3 py-2 text-sm font-semibold text-[#1ed760] transition hover:bg-[#1db954]/20"
            >
              <svg viewBox="0 0 168 168" aria-hidden="true" className="h-5 w-5 fill-current">
                <path d="M84,0C37.7,0,0,37.7,0,84c0,46.3,37.7,84,84,84s84-37.7,84-84C168,37.7,130.3,0,84,0z M122.3,121.1
                  c-1.5,2.4-4.7,3.2-7.1,1.7c-19.5-11.9-44.1-14.6-73.2-8.1c-2.7,0.6-5.4-1.1-6-3.8c-0.6-2.7,1.1-5.4,3.8-6
                  c31.8-7.1,58.9-4,80.6,9.2C123,115.5,123.8,118.7,122.3,121.1z M132.4,98.7c-1.9,3-5.8,4-8.8,2.1
                  c-22.4-13.8-56.5-17.8-83-9.8c-3.4,1-7-0.9-8-4.3c-1-3.4,0.9-7,4.3-8c30.2-9.2,67.8-4.7,93.5,11.1
                  C133.3,91.7,134.3,95.7,132.4,98.7z M133.3,75.4c-26.9-16-71.2-17.4-96.9-9.6c-4.1,1.2-8.5-1.1-9.7-5.2
                  c-1.2-4.1,1.1-8.5,5.2-9.7c29.4-8.9,78.3-7.2,109.4,11.2c3.7,2.2,4.9,7,2.7,10.7C141.8,76.5,137,77.7,133.3,75.4z"/>
              </svg>
              Spotify
            </a>

            <nav aria-label="Navegação principal" className="flex flex-wrap items-center gap-2 rounded-full border border-[#2d4659]/70 bg-[#0d2431]/82 p-1 shadow-[0_10px_28px_rgba(1,4,8,0.45)]">
              {visibleCommonNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      'rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 sm:px-4',
                      isActive
                        ? 'bg-[#ff5e00] text-white shadow-[0_8px_20px_rgba(255,94,0,0.32)]'
                        : 'text-slate-200 hover:bg-[#123042] hover:text-white',
                    ].join(' ')
                  }
                >
                  {item.label}
                </NavLink>
              ))}

              {adminLoggedIn ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sair Admin"
                  aria-label="Sair Admin"
                  className="rounded-full px-3 py-2 text-sm font-medium text-slate-200 transition-all duration-200 hover:bg-[#123042] hover:text-white"
                >
                  <span className="text-rose-400">➡️</span>
                </button>
              ) : (
                <NavLink
                  to="/admin/login"
                  className={({ isActive }) =>
                    [
                      'rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 sm:px-4',
                      isActive
                        ? 'bg-[#ff5e00] text-white shadow-[0_8px_20px_rgba(255,94,0,0.32)]'
                        : 'text-slate-200 hover:bg-[#123042] hover:text-white',
                    ].join(' ')
                  }
                >
                  Administração
                </NavLink>
              )}
            </nav>
          </div>

          {mobileMenuOpen ? (
            <nav
              aria-label="Navegação principal mobile"
              className="mt-3 grid gap-2 rounded-2xl border border-[#2d4659]/70 bg-[#0d2431]/90 p-2 lg:hidden"
            >
              {visibleCommonNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      'rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-[#ff5e00] text-white shadow-[0_8px_20px_rgba(255,94,0,0.32)]'
                        : 'text-slate-200 hover:bg-[#123042] hover:text-white',
                    ].join(' ')
                  }
                >
                  {item.label}
                </NavLink>
              ))}

              {adminLoggedIn ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sair Admin"
                  aria-label="Sair Admin"
                  className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-200 transition-all duration-200 hover:bg-[#123042] hover:text-white"
                >
                  <span className="text-rose-400">➡️</span> Sair Admin
                </button>
              ) : (
                <NavLink
                  to="/admin/login"
                  className={({ isActive }) =>
                    [
                      'rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-[#ff5e00] text-white shadow-[0_8px_20px_rgba(255,94,0,0.32)]'
                        : 'text-slate-200 hover:bg-[#123042] hover:text-white',
                    ].join(' ')
                  }
                >
                  Administração
                </NavLink>
              )}
            </nav>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1700px] px-4 py-6 sm:px-6 lg:px-10">
        <Outlet />
      </main>
    </div>
  );
}
