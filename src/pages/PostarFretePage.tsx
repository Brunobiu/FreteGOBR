import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import FreteForm from '../components/FreteForm';
import { createFrete, type CreateFreteData } from '../services/fretes';

export default function PostarFretePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (data: CreateFreteData) => {
    await createFrete(data);
    alert('Frete publicado com sucesso!');
    navigate('/embarcador/meus-fretes');
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Postar Novo Frete</h1>
          <p className="text-gray-400">
            Preencha os detalhes do frete para encontrar motoristas disponíveis
          </p>
        </div>

        <FreteForm
          embarcadorId={user.id}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/embarcador/dashboard')}
        />
      </div>
    </div>
  );
}
