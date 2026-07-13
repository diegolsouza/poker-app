import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isAdminAuthenticated } from '../utils/adminAuth';

export default function RequireAdminAuth() {
  const location = useLocation();

  if (!isAdminAuthenticated()) {
    const redirect = encodeURIComponent(location.pathname);
    return <Navigate to={`/admin/login?redirect=${redirect}`} replace />;
  }

  return <Outlet />;
}
