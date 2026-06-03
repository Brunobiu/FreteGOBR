import { BODY_TYPES } from '../data/bodyTypes';
import OptionPicker from './OptionPicker';

interface BodyTypePickerProps {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onChange: (next: string[]) => void;
  mode: 'single' | 'multi';
  title?: string;
}

/**
 * Adapter fino do OptionPicker para Tipos de Carroceria.
 *
 * Motorista usa `mode="single"` (tem 1 carroceria).
 * Embarcador usa `mode="multi"` (frete pode aceitar varias).
 */
export default function BodyTypePicker(props: BodyTypePickerProps) {
  return (
    <OptionPicker
      open={props.open}
      onClose={props.onClose}
      options={BODY_TYPES}
      selected={props.selected}
      onChange={props.onChange}
      mode={props.mode}
      title={props.title ?? 'Carrocerias'}
      searchPlaceholder="Buscar carroceria..."
    />
  );
}
