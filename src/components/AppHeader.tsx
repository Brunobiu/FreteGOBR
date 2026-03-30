import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AppHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const profileLink = user?.userType === 'embarcador' ? '/perfil/embarcador' : '/perfil/motorista';

  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          {/* Logo */}
          <Link
            to={user?.userType === 'embarcador' ? '/embarcador' : '/'}
            className="text-2xl font-bold text-blue-500"
          >
            FreteGO
          </Link>

          {/* Right side */}
          <div className="flex items-center space-x-3">
            {isAuthenticated && user ? (
              <>
                {/* Nome */}
                <span className="text-sm text-gray-300 hidden sm:block">{user.name}</span>

                {/* Foto + link perfil */}
                <Link
                  to={profileLink}
                  className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
                >
                  <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border border-gray-700">
                    {user.profilePhotoUrl ? (
                      <img
                        src={user.profilePhotoUrl}
                        alt="Foto"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg
                        className="w-4 h-4 text-gray-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                </Link>

                {/* Perfil link texto */}
                <Link
                  to={profileLink}
                  className="text-sm text-gray-400 hover:text-white transition-colors hidden sm:block"
                >
                  Perfil
                </Link>

                {/* Sair */}
                <button
                  onClick={handleLogout}
                  className="text-sm text-gray-400 hover:text-white transition-colors ml-2"
                >
                  Sair
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  Entrar
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Cadastrar
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
