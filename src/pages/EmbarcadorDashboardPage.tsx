import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getUserData, getEmbarcadorProfile } from '../services/embarcador';
import { getSignedUrl, getDocumentByType } from '../services/documents';

export default function EmbarcadorDashboardPage() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    if (!user) return;

    const loadUserData = async () => {
      try {
        await getUserData(user.id);

        const profilePhotoDoc = await getDocumentByType(user.id, 'profile_photo');
        if (profilePhotoDoc) {
          const signedUrl = await getSignedUrl(profilePhotoDoc.id);
          setProfilePhotoUrl(signedUrl);
        }

        // Load company name
        const embarcadorProfile = await getEmbarcadorProfile(user.id);
        if (embarcadorProfile) {
          setCompanyName(embarcadorProfile.companyName);
        }
      } catch (error) {
        console.error('Erro ao carregar dados do usuário:', error);
      }
    };

    loadUserData();
  }, [user]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <Link to="/embarcador/dashboard" className="text-2xl font-bold text-blue-500">
                FreteGO
              </Link>
            </div>

            {/* Navigation */}
            <nav className="hidden md:flex space-x-8">
              <Link
                to="/embarcador/dashboard"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/embarcador/dashboard')
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                Dashboard
              </Link>
              <Link
                to="/embarcador/meus-fretes"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/embarcador/meus-fretes')
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                Meus Fretes
              </Link>
              <Link
                to="/embarcador/postar-frete"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/embarcador/postar-frete')
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                Postar Frete
              </Link>
            </nav>

            {/* User Menu */}
            <div className="flex items-center space-x-4">
              <Link
                to="/embarcador/perfil"
                className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
              >
                <span className="text-sm text-gray-300 hidden sm:block">{companyName}</span>
                <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border-2 border-gray-700">
                  {profilePhotoUrl ? (
                    <img
                      src={profilePhotoUrl}
                      alt="Foto de perfil"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg className="w-6 h-6 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
              </Link>

              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden border-t border-gray-800">
          <div className="px-2 pt-2 pb-3 space-y-1">
            <Link
              to="/embarcador/dashboard"
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/embarcador/dashboard')
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              Dashboard
            </Link>
            <Link
              to="/embarcador/meus-fretes"
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/embarcador/meus-fretes')
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              Meus Fretes
            </Link>
            <Link
              to="/embarcador/postar-frete"
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/embarcador/postar-frete')
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              Postar Frete
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
