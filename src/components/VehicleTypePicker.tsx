import { VEHICLE_TYPES } from '../data/vehicleTypes';
import OptionPicker from './OptionPicker';

interface VehicleTypePickerProps {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onChange: (next: string[]) => void;
  mode: 'single' | 'multi';
  title?: string;
}

/**
 * Adapter fino do OptionPicker para Tipos de Caminhao.
 *
 * Mantido para evitar quebrar imports existentes (FreteForm,
 * MotoristaPerfilPage). A logica viva no OptionPicker.
 */
export default function VehicleTypePicker(props: VehicleTypePickerProps) {
  return (
    <OptionPicker
      open={props.open}
      onClose={props.onClose}
      options={VEHICLE_TYPES}
      selected={props.selected}
      onChange={props.onChange}
      mode={props.mode}
      title={props.title ?? 'Tipos de Caminhão'}
      searchPlaceholder="Buscar caminhão..."
    />
  );
}
