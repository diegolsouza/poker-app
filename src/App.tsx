import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAdminAuth from './components/RequireAdminAuth';
import AdminLogin from './pages/AdminLogin';
import CadastroBasico from './pages/CadastroBasico';
import Configuracoes from './pages/Configuracoes';
import DiaDePoker from './pages/DiaDePoker';
import PremiacaoFinal from './pages/PremiacaoFinal';
import PreJogo from './pages/PreJogo';
import Regras from './pages/Regras';
import RankingGeral from './pages/RankingGeral';
import RegistroResultados from './pages/RegistroResultados';
import TelaPix from './pages/TelaPix';

function App() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<Routes>
				<Route path="/" element={<Layout />}>
					<Route index element={<RankingGeral />} />
					<Route path="admin/login" element={<AdminLogin />} />
					<Route path="pre-jogo" element={<PreJogo />} />
					<Route path="dia-de-poker" element={<DiaDePoker />} />
					<Route path="admin" element={<RequireAdminAuth />}>
						<Route path="cadastro-basico" element={<CadastroBasico />} />
						<Route path="resultados" element={<RegistroResultados />} />
						<Route path="configuracoes" element={<Configuracoes />} />
					</Route>
					<Route path="financeiro" element={<TelaPix />} />
					<Route path="premiacao-final" element={<PremiacaoFinal />} />
					<Route path="regras" element={<Regras />} />
				</Route>
			</Routes>
		</BrowserRouter>
	);
}

export default App;
