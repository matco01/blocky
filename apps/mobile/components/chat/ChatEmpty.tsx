import { STARTER_CAPABILITIES, type Capability } from '../../lib/capabilities';
import { CapabilityChips } from './CapabilityChips';

export type { Capability };

export function ChatEmpty({ onPick }: { onPick: (capability: Capability) => void }) {
  return <CapabilityChips capabilities={STARTER_CAPABILITIES} onPick={onPick} />;
}
