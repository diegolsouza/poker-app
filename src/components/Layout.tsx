import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';
import { isAdminAuthenticated, logoutAdmin } from '../utils/adminAuth';

const commonNavItems = [
  { label: 'Ranking', to: '/' },
  { label: 'Pré-jogo', to: '/pre-jogo' },
  { label: 'Financeiro', to: '/financeiro' },
  { label: 'Premiação Final', to: '/premiacao-final' },
  { label: 'Regras', to: '/regras' },
];

const adminNavItems = [
  { label: 'Cadastro', to: '/admin/cadastro-basico' },
  { label: 'Resultados', to: '/admin/resultados' },
  { label: 'Configurações', to: '/admin/configuracoes' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminLoggedIn = isAdminAuthenticated();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const visibleCommonNavItems = adminLoggedIn
    ? commonNavItems.filter((item) => item.to !== '/' && item.to !== '/financeiro' && item.to !== '/premiacao-final')
    : commonNavItems;

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

        <div className="relative mx-auto w-full max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
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
                <>
                  {adminNavItems.map((item) => (
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

                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Sair Admin"
                    aria-label="Sair Admin"
                    className="rounded-full px-3 py-2 text-sm font-medium text-slate-200 transition-all duration-200 hover:bg-[#123042] hover:text-white"
                  >
                    <span className="text-rose-400">➡️</span>
                  </button>
                </>
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
                <>
                  {adminNavItems.map((item) => (
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

                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Sair Admin"
                    aria-label="Sair Admin"
                    className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-200 transition-all duration-200 hover:bg-[#123042] hover:text-white"
                  >
                    <span className="text-rose-400">➡️</span> Sair Admin
                  </button>
                </>
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

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
