/**
 * DashboardGeoMap - mapa do Brasil com circles proporcionais por UF.
 *
 * Reusa MapContainer + TileLayer do react-leaflet (ja em uso em MapaFretes).
 * Toggle entre "Fretes ativos" e "Usuários ativos" decide o que e desenhado.
 * Toggle "Ver tabela" oferece alternativa acessivel ao mapa.
 */

import 'leaflet/dist/leaflet.css';
import { useState } from 'react';
import { MapContainer, TileLayer, Circle, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { UF_CENTROIDS, type DashboardGeoBucket, type UF } from '../../../services/admin/dashboard';

interface Props {
  fretesAtivos: DashboardGeoBucket[];
  usuariosAtivos: DashboardGeoBucket[];
}

const BR_CENTER: [number, number] = [-14.235, -51.9253];

export default function DashboardGeoMap({ fretesAtivos, usuariosAtivos }: Props) {
  const [mode, setMode] = useState<'fretes' | 'usuarios'>('fretes');
  const [showAsTable, setShowAsTable] = useState(false);

  const buckets = mode === 'fretes' ? fretesAtivos : usuariosAtivos;
  const isEmpty = buckets.length === 0;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-300">Distribuição geográfica</h3>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded border border-gray-700 overflow-hidden text-[10px]">
            <button
              type="button"
              onClick={() => setMode('fretes')}
              className={`px-2 py-0.5 ${
                mode === 'fretes'
                  ? 'bg-cyan-500/15 text-cyan-300'
                  : 'text-gray-400 hover:bg-gray-800/60'
              }`}
            >
              Fretes ativos
            </button>
            <button
              type="button"
              onClick={() => setMode('usuarios')}
              className={`px-2 py-0.5 border-l border-gray-700 ${
                mode === 'usuarios'
                  ? 'bg-cyan-500/15 text-cyan-300'
                  : 'text-gray-400 hover:bg-gray-800/60'
              }`}
            >
              Usuários ativos
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowAsTable((v) => !v)}
            className="text-[10px] text-gray-500 hover:text-cyan-400"
          >
            {showAsTable ? 'Ver mapa' : 'Ver tabela'}
          </button>
        </div>
      </div>

      {showAsTable ? (
        <div className="overflow-auto max-h-80">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Distribuição por UF — {mode === 'fretes' ? 'fretes ativos' : 'usuários ativos'}
            </caption>
            <thead className="bg-gray-800/60 text-gray-400 sticky top-0">
              <tr>
                <th scope="col" className="text-left px-2 py-1 font-medium">
                  UF
                </th>
                <th scope="col" className="text-right px-2 py-1 font-medium">
                  {mode === 'fretes' ? 'Fretes ativos' : 'Total'}
                </th>
                {mode === 'usuarios' && (
                  <>
                    <th scope="col" className="text-right px-2 py-1 font-medium">
                      Motoristas
                    </th>
                    <th scope="col" className="text-right px-2 py-1 font-medium">
                      Embarcadores
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {isEmpty ? (
                <tr>
                  <td
                    colSpan={mode === 'usuarios' ? 4 : 2}
                    className="text-center text-gray-500 py-4"
                  >
                    Sem dados geográficos no período.
                  </td>
                </tr>
              ) : (
                buckets.map((b) => (
                  <tr key={b.uf} className="border-t border-gray-800">
                    <td className="px-2 py-1 text-gray-200 font-medium">{b.uf}</td>
                    <td className="px-2 py-1 text-gray-200 text-right">
                      {mode === 'fretes' ? b.count : (b.total ?? 0)}
                    </td>
                    {mode === 'usuarios' && (
                      <>
                        <td className="px-2 py-1 text-gray-300 text-right">{b.motoristas ?? 0}</td>
                        <td className="px-2 py-1 text-gray-300 text-right">
                          {b.embarcadores ?? 0}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" style={{ zIndex: 0 }}>
          <MapContainer
            center={BR_CENTER}
            zoom={4}
            scrollWheelZoom={false}
            style={{ height: '320px', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {buckets.map((b) => {
              const center = UF_CENTROIDS[b.uf as UF];
              if (!center) return null;
              const value = mode === 'fretes' ? b.count : (b.total ?? 0);
              if (value === 0) return null;
              const radius = Math.sqrt(value) * 30000;
              return (
                <Circle
                  key={b.uf}
                  center={center}
                  radius={radius}
                  pathOptions={{ color: '#0891b2', fillColor: '#0891b2', fillOpacity: 0.4 }}
                >
                  <Popup>
                    <div className="text-sm">
                      <strong>{b.uf}</strong>
                      <br />
                      {mode === 'fretes' ? (
                        <>Fretes ativos: {b.count}</>
                      ) : (
                        <>
                          Motoristas: {b.motoristas ?? 0}
                          <br />
                          Embarcadores: {b.embarcadores ?? 0}
                          <br />
                          Total: {b.total ?? 0}
                        </>
                      )}
                      <br />
                      <Link
                        to={`/admin/${mode === 'fretes' ? 'fretes' : 'users'}?uf=${b.uf}`}
                        className="text-cyan-600 hover:underline"
                      >
                        Ver detalhes
                      </Link>
                    </div>
                  </Popup>
                </Circle>
              );
            })}
          </MapContainer>
          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-gray-900/40">
              <span className="text-xs text-gray-300 bg-gray-900/80 px-3 py-1.5 rounded">
                Sem dados geográficos no período.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
